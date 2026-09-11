# Midway 4 前后端升级调查与实施方案

状态：阶段 A 已完成纯 Cool Admin 前后端与 PostgreSQL 基础联调，等待跨平台和扩展门禁

调查与实施日期：2026-08-11 至 2026-08-12

实施分支：`codex/cool-admin-8x-midway4`

Node 基线：`8.x@e545ef6f3b0c08581e34bd3207ca57d851ccc3ae`

Vue 基线：`8.x@a2d4ee9bbfd6bfce880382f0bf6f8dd8f3397a2d`

## 结论

升级前的 Cool Admin 8.x 使用 Midway 3：

- 14 个直接 `@midwayjs/*` 组件声明 `^3.20.3`；
- 原锁定结果为 Midway `3.20.24`；
- Cool Admin `8.x` 是应用版本线，不是 Midway 版本；
- Midway 4 从 Node.js 20 开始支持。

截至 2026-08-12，Midway `4.2.1` 同时是官网 changelog 和 npm 上的最新正式版本，
Midway 4 整条版本线处于 Active LTS。它不是 beta 或 RC，可以作为当前稳定框架基线。

推荐路线是先在精确的 Cool Admin 8.x 上游提交上完成 Midway 4 兼容，再决定是否向上游
提交或进入其他产品的独立合并流程。纯兼容分支不应加入业务插件、外部身份或下游产品代码。

## 版本策略

本分支不是 Cool Admin 上游发布线，因此：

- `package.json` 保持上游应用版本 `8.0.0`；
- 不自行发布 `8.1.0` 或 `8.0.0-midway4.1`；
- 不使用不符合 SemVer 的 `8.x-midway4.xxx`；
- 候选身份只通过分支名、40 位提交和本文档记录；
- 最终应用版本由 Cool Admin 上游维护者决定。

Midway 依赖则明确锁到经过验证的 4.x 组件矩阵，当前 Core 为 `4.2.1`。

## 为什么升级到 Midway 4

### 进入新的长期维护主线

Midway 4 已进入 Active LTS；Midway 3 已进入 Maintenance LTS，官方计划维护至
2027-04。现在启动兼容验证，可以在旧主线仍受维护时逐项迁移，避免临近 EOL 才一次性处理
框架、Node.js、构建和组件生态变化。

### 与 Node.js LTS 方向一致

Midway 4 最低要求 Node.js 20，并推荐 LTS。当前主要门禁使用 Node.js `22.23.1`，与框架
方向一致。仓库 `engines` 已从 `>=18` 提升为 `>=20`，后续仍需补齐最低 Node 20 门禁。

### 启动与扫描边界更明确

Midway 4 移除了旧的隐式入口扫描，应用必须配置显式 detector。其收益包括：

- Controller、Service、Entity 与任务扫描闭包可审计；
- 重复注册、漏注册和意外目录扫描能更早失败；
- 开发、测试和 production build 的发现结果更容易保持一致；
- 框架启动行为不再依赖难以观察的隐式约定。

### 依赖注入问题更早暴露

Midway 4 会严格报告容器循环依赖。本轮真实登录与菜单联调发现并修复了多条在 Midway 3 下
未提前暴露的构造期依赖环。将依赖改为实际调用时解析后，普通请求不再实例化无关服务链，
也降低了长期排障成本。

### 新文档和组件生态以 4.x 为主

Midway 当前文档、功能和修复以 4.x 为主要目标。完成升级后可以直接使用新的官方维护成果，
包括新的 validation 体系和更明确的组件边界，而不必为旧主线继续维护额外兼容层。

## 阶段 A 已完成

### Node 兼容实现

- 所有直接 `@midwayjs/*` 运行与测试组件统一到 4.x；
- Node engine 提升到 `>=20.0.0`；
- pnpm 9 锁文件中不存在运行时 `@midwayjs/*@3`；
- 应用入口使用 `CommonJSFileDetector` 并启用冲突检查；
- 21 处空参数 `@App()` 迁移为 `@MainApp()`；
- 全配置注入迁移为 `@AllConfig()`；
- 为 `@cool-midway/core@8.0.8` 与 `@cool-midway/rpc@8.0.2` 增加版本锁定、可审计的
  pnpm patch；
- 修复任务、菜单、部门、角色、插件中心和插件类型服务的构造期循环依赖；
- 新增 Midway 4 开发启动器、依赖锁测试和完整应用启动门禁；
- `dev:midway4` 不执行会改写源码密钥的 `cool check`，仅在 loopback 监听并使用进程内随机
  临时密钥；普通上游 `pnpm dev` 行为保持不变；
- production build 与完整启动门禁得到 Midway `4.2.1`、179 条路由和登录路由证据。

### Vue 8.x 联调客户端

纯 Vue worktree 位于联调目录：

```text
<workspace>/worktrees/cool-admin-midway4/vue
```

它严格来自 `8.x@a2d4ee9bbfd6bfce880382f0bf6f8dd8f3397a2d`，只补充 pnpm 根工作区
声明，不修改页面或业务源码。验证结果：

- ESLint 通过；
- `vue-tsc --build --force` 通过；
- Vite production build 通过，3342 modules transformed；
- `/dev` 代理访问 8001；
- 人工打开 9200 并切换多个页面均可正常访问。

build 报告 `caniuse-lite is 14 months old`。这是 Browserslist 兼容数据陈旧提醒，不影响
本轮 dev/build 成功，也不是 Midway 失败。为避免混入无关依赖更新，本轮不执行联网的
`update-browserslist-db@latest`；应由独立依赖维护提交刷新锁文件并重跑浏览器矩阵。

### PostgreSQL 联调

专用联调配置只允许：

```text
host: 127.0.0.1 / localhost / ::1
database: cool_admin_midway4_validation
driver: PostgreSQL
```

本次使用 PostgreSQL `16.10`，当前纯 Cool 开发基线为：

- public tables：22；
- `base_sys_user`：1；
- `base_sys_menu`：76；
- `plugin_info`：0。

该配置的 `synchronize/initDB/initMenu=true` 仅用于精确命名、loopback 的阶段 A 开发库，
并由代码拒绝其他主机、库名和非法端口。它不能作为发布或生产迁移方式；正式环境必须使用
版本化 SQL、`synchronize=false` 和显式初始化关闭。

### 前后端真实闭环

通过 Vue `/dev` 代理得到以下证据：

- 验证码：HTTP 200 / `code=1000`；
- 默认开发管理员登录：HTTP 200 / `code=1000`；
- 菜单：76；
- 权限：86；
- 上传模式读取：HTTP 200 / `code=1000`；
- 退出：HTTP 200 / `code=1000`；
- 匿名菜单：HTTP 401。

测试脚本没有输出验证码、口令或 Token。

### Hub 联调入口

Hub 增加独立“Cool Admin Midway 4”组：

Hub 源码：[phoenix-hub](https://gitee.com/phoenixwing/phoenix-hub)

| 服务 | 端口 | worktree | 用途 |
| --- | ---: | --- | --- |
| Cool Admin 8.x / Midway 4 API | 8001 | `cool-admin-midway4/node` | API、静态状态页、PostgreSQL |
| Cool Admin 8.x Vue | 9200 | `cool-admin-midway4/vue` | 纯 8.x 前端联调 |

Properties 面板显示源码基线、数据库和联调帮助。浏览器点检确认两项服务均可由 Hub 管理并
达到 ready，页面 console 无 error/warn。历史启动错误通过日志 generation 清理，不会继续
冒充当前状态。

## 运行与验证命令

Node 完整门禁必须使用 Node.js 22：

```bash
nvm use 22
pnpm verify:midway4
```

该命令依次运行 lint、typecheck、Jest、production build 和完整应用启动测试。

Vue 门禁：

```bash
pnpm exec eslint .
pnpm type-check
pnpm build
```

本机 PostgreSQL 只读核对：

```bash
psql --version
psql -h 127.0.0.1 -p 5432 -U <数据库用户> \
  -d cool_admin_midway4_validation -X
```

Hub 中先启动 API，再启动 Web；打开 9200 测登录和页面，打开 8001 查看运行基线。

## 首轮失败与归因

以下均在阶段 A 中发现并修复，不属于最终门禁失败：

1. watch 启动器引用不存在的 `dist/index`：改为加载 `dist/configuration`；
2. 自定义环境未映射配置，报 `must set options.dataSource`：补入 `midway4` 配置映射；
3. 登录后菜单请求暴露 Role/Department/PluginTypes 循环：改为调用时解析；
4. `pg` 报 client query 并发弃用提醒：当前不阻断，但在 pg 9 前必须定位上游初始化并发；
5. Browserslist 数据陈旧：记录为独立依赖维护项；
6. 沙箱内测试随机 loopback 端口超时：在允许本机回环的受控范围重跑后通过。

## 尚未完成的门禁

阶段 A 只完成 macOS、Node 22、PostgreSQL 16 和基础前后端闭环，尚不能声明可发布：

- Node.js 20 最低版本门禁；
- Windows 与 Linux 的 lint/typecheck/test/build/start/stop；
- MySQL 主要路径；
- 上传真实文件、静态文件缓存和跨域/Cookie 组合；
- Cron、RPC、队列与任务进程；
- `@midwayjs/validation` 正式迁移；
- pkg 的 Node 20/22、Windows/Linux 产物；
- Cool 组件 patch 向上游提交或替换为正式兼容版本；
- 浏览器兼容数据刷新和目标浏览器矩阵；
- `synchronize=false` 的空库/既有库启动与版本化基线。

## 放行条件

以下条件全部满足，才能宣告 Midway 4 升级完成：

1. 运行依赖中不存在 Midway 3 Core 或 3/4 双 Core；
2. 所有 Cool 组件有明确的 Midway 4 支持证据；
3. Node 20/22、Windows/Linux 完整门禁通过；
4. PostgreSQL/MySQL 主要路径通过且没有隐式生产 DDL；
5. 登录、权限、菜单、上传、静态文件、Cron、RPC 和任务回归通过；
6. production build、start、stop 与 pkg 通过；
7. Node 与 Vue 的精确上游基线、lockfile、patch 和提交可追溯；
8. 上游应用版本号由上游维护者决定，不由兼容验证分支擅自发布。

## 官方资料

- [Midway 4.0 发布说明](https://midwayjs.org/en/blog/release/4.0.0)
- [Midway 3.x 升级到 4.x 指南](https://midwayjs.org/en/docs/upgrade_v4)
- [Midway 维护计划](https://midwayjs.org/en/docs/release_schedule)
- [Midway 变更日志](https://midwayjs.org/en/changelog)
- [Midway 源码](https://github.com/midwayjs/midway)
- [Cool Admin Midway 上游仓库](https://gitee.com/cool-team-official/cool-admin-midway)
