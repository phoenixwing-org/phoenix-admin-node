# Phoenix 插件实体注册分层实施计划

状态：阶段 A/B/C/D 已实现，等待真实 Branding/Open Issue 联合复验

日期：2026-08-12

## 背景与真实故障

Phoenix Admin 曾沿用 Cool 的 `cool entity`：扫描 `src/modules/*/entity/**/*.ts`，生成单一
运行时文件 `src/entities.ts`。2026-08-12 在管理员卸载全部业务插件后，插件目录已经删除，但旧生成文件
仍引用 Open Issue、Function 和 BOM 的 20 个实体模块，导致 Node 编译出现 `TS2307`、API 无法启动。

执行一次 `cool entity` 即可恢复纯 Host，说明实体扫描本身可用，真正缺口是安装/卸载生命周期没有把
“挂载变更、实体清单重建、校验、切换、重启”作为同一事务。

## 目标

- Host tracked 源码不保存任何业务插件实体路径或产品 ID 特例；
- `src/entities.ts` 固定保存 Host 实体，插件增减不再改它；
- `src/entities.plugin.ts` 只消费当前实际装配的插件实体；
- 安装、升级、启用、停用、卸载失败时不会留下目录与实体清单不一致的中间态；
- TypeORM 实体增减通过受控重启生效，不宣称同进程热插拔。

## 已冻结目录与生成物

```text
src/entities.ts          # tracked：Host 固定实体 + pluginEntities
src/entities.plugin.ts   # ignored：当前插件实体，自动生成
scripts/pah-sync-runtime-entities.cjs
```

固定入口只追加生成层：

```ts
import { pluginEntities } from './entities.plugin';
// ...Host 固定实体 imports
export const entities = [/* Host */ ...pluginEntities];
```

生成层在有插件时形如：

```ts
import * as pluginEntity0 from './modules/example/entity/item';
export const pluginEntities = [
  ...Object.values(pluginEntity0),
];
```

纯 Host 时该文件稳定为 `export const pluginEntities = [];`。唯一导出名也避免 Cool 生成的
`src/index.ts` 同时 re-export 固定入口与插件清单时发生名称冲突。生成器扫描实际模块目录，并从 tracked
固定入口解析 Host import 集合做差集；不保存任何产品 moduleId 特例。编译前还会生成 ignored 的
`.runtime/tsconfig.phoenix.json`：dirty、身份不明、品牌、无可信激活收据或 Host TypeScript 不兼容的
模块均从实体、bundle 与 TypeScript 编译中同时隔离。

### 有效插件映射与静态生成

可以把 Host 启动前检查结果理解为一个 `validMap`，但当前真实收据使用信息更完整的
`inspections[]`：每项包含 `moduleId`、`eligible`、`state` 和安全诊断 `detail`。两者的语义对应如下：

```ts
const validMap = Object.fromEntries(
  inspections.map(item => [item.moduleId, item.eligible]),
);
```

| 检查结果 | 是否写入 `entities.plugin.ts` | 后续行为 |
| --- | --- | --- |
| 业务插件 `eligible=true` | 是 | 为该插件的每个实体生成静态 `import`，再加入 `pluginEntities` |
| Branding `state=ready, policy=no-entities` | 否 | 品牌声明由 Host 安全服务消费，不进入 Node ORM |
| dirty、身份不明、双端入口缺失或 TypeScript 不兼容 | 否 | 标为 `quarantined`，同时从实体、编译和 bundle 闭包排除 |
| 插件目录不存在或已卸载 | 否 | 下一次 Host 启动重新生成；纯 Host 回到空数组 |

概念上等价于：

```ts
for (const plugin of discoveredPlugins) {
  if (!validMap[plugin.moduleId]) continue;
  if (plugin.policy === 'no-entities') continue;
  collectEntityImports(plugin);
}
```

这个判断必须发生在**生成 TypeScript 之前**，不能把运行时 `if (validMap[moduleId])` 写入
`entities.plugin.ts`。ES module 的静态 `import` 会先于 `if` 被 TypeScript/Node 解析；如果插件目录已经
卸载，即使条件为 `false`，残留路径仍会产生 `TS2307` 并拖垮纯 Host。

例如只有 Open Issue 通过检查时，生成物形如：

```ts
// 自动生成的插件实体清单，请勿手动修改
import * as pluginEntity0 from './modules/phoenix-open-issue/entity/checkpoint';
import * as pluginEntity1 from './modules/phoenix-open-issue/entity/issue';

export const pluginEntities = [
  ...Object.values(pluginEntity0),
  ...Object.values(pluginEntity1),
];
```

实际文件会包含该插件声明的全部有效实体并保持稳定排序；示例仅省略其余项。若 Open Issue 无效而
Function 有效，则生成物只出现 Function 路径；若两者都无效，则不出现任何产品路径。

## 生命周期事务

1. 在 staging 目录装配候选 Node/Vue payload；
2. 校验 manifest、descriptor、package SHA、实体路径与 moduleId 边界；
3. 在临时文件中重建 `entities.plugin.ts`；
4. 运行 TypeScript、实体闭包、重复类名/表名及禁止跨插件 import 检查；
5. 原子切换 payload 与生成文件；
6. 由 Host supervisor 受控重启 Node；
7. 健康检查失败时原子恢复上一组 payload、收据和聚合文件并再次启动；
8. DB migration/ledger 仍遵守独立的版本化迁移契约，不由实体发现代替。

停用与卸载同样先在 staging 中移除目标插件，再重建并校验；不得先删除目录、后异步尝试清单更新。

## 分步试水

### 阶段 A：纯生成器（已完成）

- 先以纯生成器冻结固定入口与动态清单契约；
- 对 Host + Open Issue + Branding 三种目录组合生成逐插件收据和聚合文件；
- 验证重复生成字节一致、目录含空格、移除单插件、全部移除和非法跨模块 import；
- 与当前 `cool entity` 输出的实体集合做语义等价比较。

### 阶段 B：开发挂载接入（已完成代码与故障注入）

- Hub 只机械创建/移除 symlink 与 Git exclude，不生成实体、不判断插件健康；
- Host 每次 dev/typecheck/build 前从实际 `src/modules` 执行身份、Git clean、双端入口和 TypeScript
  兼容点检，再原子生成实体与编译隔离清单；
- 挂载变化后不再要求管理员手工执行 `cool entity`；
- 只用 Open Issue 与 Branding 证明单插件、双插件、卸载一个、全部卸载和重新挂载。

### 阶段 C：受控安装器接入（已完成代码与聚焦测试）

- 与包收据、payload 原子切换、Host restart/rollback 合并为一项事务；
- 增加故障注入：生成失败、typecheck 失败、重启失败、回滚竞争和进程中断；
- 已决定保留 tracked 的 `src/entities.ts` 兼容入口，由它统一导出 Host 与插件实体；TypeORM
  不直接读取 ignored 生成文件。

### 阶段 D：坏插件编译隔离（已完成代码与聚焦测试）

- 纯 Host 基线先在排除全部外部模块的临时 tsconfig 上通过；
- 每个身份合格的业务插件再单独加入 Host TypeScript 闭包点检，失败仅隔离该插件；
- `mwtsc`、`tsc` 与 bundle-helper 消费同一隔离收据，不能出现 detector 忽略但编译器仍加载的分叉；
- 品牌插件永不参与 Node 实体或 Node runtime 编译，只由 Host 权威服务读取声明式快照；
- `.runtime/pah-plugin-compile.json` 只记录 moduleId、状态与安全首条诊断，不记录请求体、凭据或产品源码。

### Cool 运行时旧制品隔离

只隔离 TypeScript 并不足够。`mwtsc --cleanOutDir` 后，插件迁移描述符或 SQL 等非 TypeScript 制品仍可能
残留在 `dist/modules/<moduleId>`；Cool 的模块发现会把这个残留目录识别成模块，并在缺少已隔离的
`config.js` 时以“缺少 config.ts 配置文件”终止整个 Host。

因此开发启动和 production 制品复制必须消费同一份编译隔离收据：

1. `scripts/pah-prune-ignored-runtime-modules.cjs` 严格校验 `ignoredModuleIds`；
2. Midway 创建应用前只清理对应的 `dist/modules/<moduleId>` 旧目录；
3. `copy-pah-plugin-artifacts.mjs` 不复制被隔离模块的 descriptor、migration 或 runtime artifact；
4. 有效模块的 dist 目录保持不变，dist symlink 只删除链接本身，不跟随到外部目录；
5. 收据缺失、格式无效、moduleId 非法或重复时启动/构建直接失败，不回退为全量加载。

该步骤只处理可重建的编译输出，不删除 `src/modules` 开发挂载、不执行插件代码、不触碰数据库。

## 外部框架调研项

实现前另做只读源码/官方文档调查，不凭印象复制模式：

- TypeORM/NestJS/Midway 的实体 metadata 固定时点与动态 module 边界；
- Spring Boot/JPA 的 classpath entity discovery 与重启模型；
- Django app registry 与 migration graph 的加载时点；
- VS Code/OSGi 等插件系统如何把代码激活与持久化 schema 生命周期分离；
- 支持运行时模块的框架如何处理 classloader/module cache、依赖隔离和失败回滚。

调查结论必须回答：哪些框架真正支持同进程增加 ORM 实体，哪些只是启动时发现；Phoenix 不因“插件”
名称而假设数据库实体可以安全热插拔。

## 硬门禁

- 纯 Host 聚合结果不含任何业务插件路径；
- 每个 generated 收据只能引用自身 `src/modules/<moduleId>`；
- 生成文件排序稳定、重复生成字节一致；
- 安装/卸载后 `git status` 不出现 Host tracked 产品路径；
- Open Issue + Branding 双挂载启动正常，卸载任一后剩余插件正常；
- 全部卸载后 Node 冷启动、登录、EPS、字典和验证码正常；
- 任一失败点都能恢复到上一可启动状态；
- 被隔离插件即使曾留下 dist descriptor/SQL，也不会被 Cool 再识别为可启动模块；
- 生产环境保持 `synchronize=false`，实体发现不得触发或替代 DDL。

## 暂不执行

- 不在本计划阶段改 Cool CLI 或 TypeORM；
- 不把插件实体复制进 Host tracked 文件；
- 不通过管理员运行 `pnpm add` 或手工修改生成物解决依赖；
- 不把 Function/BOM 纳入首轮原型矩阵，先用 Open Issue 与 Branding 证明通用边界。
