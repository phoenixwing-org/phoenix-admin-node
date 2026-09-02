# Phoenix Admin 合入 Midway 4 计划

状态：阶段 A、阶段 B 已完成；等待远端归档与后续跨平台发布门禁

日期：2026-08-12

## 边界

Midway 4 的基础兼容在独立纯上游分支 `codex/cool-admin-8x-midway4` 中完成。该分支只处理
Cool Admin Node、纯 Vue 8.x、Midway、PostgreSQL、Hub 和跨平台验证，不包含 Pah、
统一身份或业务插件。

本文件只描述基础候选通过后，如何把它作为可追溯输入应用到 Phoenix Admin。基础调查与门禁
结果以纯分支的《Midway 4 前后端升级调查与实施方案》为准，不在本文件重复维护。

## 合入策略

1. 冻结纯分支的 40 位 commit、tree、Node/Vue 基线、lockfile 和 patch SHA；
2. 以已发布的 `origin/develop` 为不可改写基线，按天归档本地 Host 修复；
3. 不 merge 纯候选分支，只把已验证的通用兼容补丁逐项等价应用到当前 `develop`；
4. 依赖锁由 Phoenix 自己的 Node 22 / pnpm 10 工具链重新生成，不复制候选的包身份或 pnpm 9 lockfile；
5. 在同一提交中完成 Host-owned 适配和回归验证，保留升级前归档 ref 作为回滚真源。

该策略避免把纯 Cool 验证分支的历史、版本号、欢迎页或临时环境设置混入 Phoenix，同时仍可用
冻结 commit 和 patch 文件追溯每一项框架兼容修改。

## Host-owned 适配范围

- Pah Host 与已登记插件的显式 detector 扫描白名单；
- manifest、descriptor、runtime artifacts 和 SQL 制品装配；
- 插件安装、升级、停用、启用、卸载保留数据；
- 统一身份、公开登录与飞书回调；
- 字典、导航、菜单、角色和迁移台账；
- clean-validation 成对 Node/Vue worktree；
- `synchronize=false`、`initialize=false` 与版本化 Host schema；
- Windows PostgreSQL 工具链、production build 和 package assembly。

不得把任何产品模块路径、产品实体或产品 ID 特例写入 Host tracked tree。

## 联合验证

1. Node 20/22、macOS/Windows/Linux 完整门禁；
2. 纯 Host 与带 example-plugin 的 production build；
3. PostgreSQL 空库、既有库和 schema migration；
4. Pah 安装/升级/卸载数据保留与 ledger 幂等；
5. 登录、飞书、身份绑定、菜单、权限 401/403/200；
6. clean-validation 端口独占、Hub ownership 与正常 stop/start；
7. Node/Vue 浏览器冷启动、刷新、深链与 console 门禁；
8. `src/entities.ts` 和产品挂载路径不进入提交。

## 阶段 B 实施结果

2026-08-12 已在当前 `develop` 上完成等价补丁叠加，没有 merge 纯候选分支：

- 当时 Phoenix 包名与 `0.2.2` 产品版本保持不变；后续 Host 能力归档已独立提升为
  `0.3.0`，Cool `8.x` 仍只是上游兼容基线；
- 直接 Midway 依赖统一为 `4.2.1`，Node 最低版本提升到 20，pnpm 仍为 10；
- 显式启用 CommonJS detector，并完成 `@MainApp`、延迟容器解析、请求作用域和 type-only
  metadata 适配；
- Cool core/rpc 兼容补丁纳入版本化 patch，并由 lockfile 锁定；
- 本地专用 PostgreSQL 门禁固定到 loopback `cool_admin_midway4_validation`；完整容器验证使用
  `synchronize=false`、`initDB=false`、`initMenu=false`，不执行 DDL；
- 无产品挂载的 Node `22.23.1` 门禁通过：lint、typecheck、16 个测试套件（136 passed、
  1 skipped）、production build，以及 Midway `4.2.1` 完整容器 220 条 Host 路由；
- 主开发工作树的产品 symlink 继续只作为本机装配输入，没有进入 Host Git。2026-08-12
  进一步把 `src/entities.ts` 恢复为 tracked 的 Host 固定入口；插件实体只写入 ignored 的
  `src/entities.plugin.ts`，避免卸载后旧产品 import 阻断下一次编译。

前端不运行 Midway，本阶段只要求其维持 Cool Admin 8.x 路由/API 契约并完成既有页面联调；
框架升级本身不要求修改 Vue 产品版本。

## 版本与发布

纯 Cool 候选保持上游 `8.0.0`，不代替上游维护者发布新 Cool 版本。Phoenix 的最终产品
版本由合入范围和兼容性评估后独立决定；不得直接沿用 Midway 或 Cool Admin 的版本号。

发布前必须保留最后一个 Midway 3 commit、lockfile、Host schema 与可操作回滚说明。框架回滚
以应用版本为单位，不对生产数据库做推测性回滚。
