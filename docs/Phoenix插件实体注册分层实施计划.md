# Phoenix 插件实体注册分层实施计划

状态：阶段 A/B/C 已实现，等待真实 Branding/Open Issue 联合复验

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
固定入口解析 Host import 集合做差集；不保存任何产品 moduleId 特例。

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

- Hub `mount/unmount` 成功前，在 staging 中生成并验证；
- 挂载完成后不再要求管理员手工执行 `cool entity`；
- 只用 Open Issue 与 Branding 证明单插件、双插件、卸载一个、全部卸载和重新挂载。

### 阶段 C：受控安装器接入（已完成代码与聚焦测试）

- 与包收据、payload 原子切换、Host restart/rollback 合并为一项事务；
- 增加故障注入：生成失败、typecheck 失败、重启失败、回滚竞争和进程中断；
- 已决定保留 tracked 的 `src/entities.ts` 兼容入口，由它统一导出 Host 与插件实体；TypeORM
  不直接读取 ignored 生成文件。

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
- 生产环境保持 `synchronize=false`，实体发现不得触发或替代 DDL。

## 暂不执行

- 不在本计划阶段改 Cool CLI 或 TypeORM；
- 不把插件实体复制进 Host tracked 文件；
- 不通过管理员运行 `pnpm add` 或手工修改生成物解决依赖；
- 不把 Function/BOM 纳入首轮原型矩阵，先用 Open Issue 与 Branding 证明通用边界。
