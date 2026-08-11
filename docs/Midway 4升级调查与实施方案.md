# Midway 4 升级调查与实施方案

状态：阶段 A 已完成 macOS/Node 22 兼容实现，等待跨平台和 Phoenix 合并验证

调查日期：2026-08-11

实施分支：`codex/cool-admin-8x-midway4`

实施基线：`8.x@e545ef6f3b0c08581e34bd3207ca57d851ccc3ae`

## 结论

升级前的 Cool Admin 8.x 基线确实使用 Midway 3，而不是 Midway 4：

- `package.json` 中 14 个 `@midwayjs/*` 组件仍声明 `^3.20.3`；
- `pnpm-lock.yaml` 当前实际解析为 `3.20.24`；
- Cool Admin 的产品基线是 `8.x`，这是 Cool Admin 自己的版本线，不代表 Midway 8；
- Phoenix Admin 的 `0.2.2` 又是第三条独立的产品版本线。

Midway 4 已正式发布，官网变更日志在本次调查时已列出 `4.2.1`。Midway 4 处于
Active LTS，Midway 3 处于 Maintenance LTS，官方计划维护 Midway 3 至 2027-04。
因此升级应进入验证阶段，但不应在未经跨平台和 Phoenix 联合验证时直接替换当前生产基线。

推荐采用“**先升级纯 Cool Admin 8.x，再合并到 Phoenix**”的路线：

1. 从官方 `cool-admin-midway 8.x` 的精确提交建立独立兼容分支；
2. 在不含 Pah、飞书登录和业务插件的纯上游树中完成 Midway 4 与 Cool 组件适配；
3. 纯上游门禁全部通过后，以真实 merge 合入 Phoenix 的 Midway 4 升级分支；
4. 在 Phoenix 分支中单独处理 Pah 显式扫描、插件装配和 Host 回归；
5. 两阶段均通过后才允许合入 `develop`。

这比直接在 Phoenix `develop` 修改依赖更安全，也更容易区分“Cool/Midway 兼容问题”和
“Phoenix/Pah 扩展问题”。

## 阶段 A 实施结果

已在独立 worktree `<workspace>/.worktrees/cool-admin-midway4/node` 中，从
`8.x@e545ef6f3b0c08581e34bd3207ca57d851ccc3ae` 完成第一阶段兼容实现；主 Phoenix
`develop` 未参与改动。

本阶段完成项：

- 所有直接 `@midwayjs/*` 运行与测试组件统一到 4.x；当前 Core 为 `4.2.1`，Logger 为
  `4.1.0`；
- Node engine 从 `>=18` 提升到 `>=20`，门禁使用 Node `22.23.1`；
- 新增并跟踪 pnpm 9 锁文件，运行依赖树中未发现 `@midwayjs/*@3`；
- 应用入口增加 `CommonJSFileDetector` 和冲突检测，21 处空参数 `@App()` 已迁移为
  `@MainApp()`，全配置注入改为 `@AllConfig()`；
- 按 Midway 4 的显式作用域与循环依赖规则，拆除了任务、菜单和插件服务中的三组构造期
  循环依赖，并为可降级的请求作用域插件服务增加显式声明；
- 新增 Midway 4 开发启动器、依赖锁测试和完整应用启动门禁；
- 临时应用使用随机端口与 SQLite 内存库，不连接现有开发/生产数据库，也不执行持久 DDL；
- 真实启动结果为 Midway `4.2.1`、179 条路由，`/admin/base/open/login` 已注册；
- lint、typecheck、Jest、production build 和完整应用启动门禁均已通过。

阶段 A 暂未声明“可发布完成”。仍需补齐 Node 20、Windows/Linux、MySQL/PostgreSQL、
上传/Cron/RPC/任务队列和打包产物门禁，并在阶段 B 合入 Phoenix 后验证 Pah、身份和插件。

## 版本线不要混淆

| 名称 | 当前版本/基线 | 含义 |
| --- | --- | --- |
| Phoenix Admin Node | `0.2.2` | Phoenix 产品版本 |
| Cool Admin Midway | `8.x` / `e545ef6f3b0c08581e34bd3207ca57d851ccc3ae` | 上游应用基线 |
| Midway | 声明 `^3.20.3`，锁定 `3.20.24` | 底层 Node.js 框架 |
| Node.js | 仓库声明 `>=18`，当前主要验证使用 Node 22 | 运行时基线 |

本次升级的目标是 Midway `3.20.x → 4.x`。它不等于 Cool Admin `8.x → 9.x`，也不要求
Phoenix 产品版本直接跟随为 `4.x`。

## 为什么要升级到 Midway 4

### 进入新的长期维护主线

Midway 4 已进入 Active LTS，Midway 3 已进入 Maintenance LTS，官方计划在 2027-04
结束 Midway 3 生命周期。继续长期停留在 3.x，意味着后续获得的新能力、兼容修复、文档
和组件生态支持会越来越少。现在开始兼容验证，可以在 3.x 尚有维护窗口时完成迁移，而不是
临近停止维护时被迫一次性切换。

这不是说 Midway 3 当前不能使用。现有 3.20.24 仍可作为稳定发布线继续维护；升级的目的
是提前建立下一条可验证、可回滚的框架基线。

### 与 Phoenix 的 Node.js 运行时方向一致

Midway 4 的最低运行时是 Node.js 20。Phoenix 当前主要开发与联合验证环境已经使用
Node.js 22，因此运行时前提基本具备。把框架基线提升到 Node 20+ 可以减少旧 Node 兼容层，
并让开发、CI、Windows 验证和正式部署使用同一代 LTS 能力。

升级时仍需要把仓库 `engines`、部署镜像、打包目标和 CI 矩阵一起调整，不能只依赖开发机
恰好安装了 Node 22。

### 显式扫描更适合 Pah 插件边界

Midway 4 把入口发现从隐式扫描改为显式 detector。对普通小型应用，这主要是配置方式变化；
对 Phoenix Admin Host，这是值得升级的核心原因之一：

- Host 可以明确声明哪些目录属于框架扫描闭包；
- 本地开发挂载、正式插件制品与未登记目录可以形成可审计边界；
- 冲突检测和忽略规则可以在入口处集中配置；
- 插件漏注册、重复注册和意外扫描产品源码更容易被测试发现；
- 启动、构建和 clean-validation 的发现结果更容易保持一致。

这与 Pah 当前强调的 manifest、descriptor、runtime artifacts、迁移制品和 Host Git 隔离方向
一致。但显式扫描本身不会自动解决插件装配问题，仍需由 Phoenix 在第二阶段定义白名单并
补齐通用测试。

### 框架行为更明确，更适合长期维护

Midway 4 对容器、元数据、装饰器继承、生命周期和框架 hook 做了整理，并默认启用
`asyncLocalStorage`。官方还加强了循环依赖提示，并为生命周期增加超时边界。这些变化有助于：

- 减少依赖注入、装饰器继承和组件加载中的隐式行为；
- 让启动失败、循环依赖和生命周期卡住更早暴露；
- 改善请求上下文、日志关联和异步调用链的可预测性；
- 降低 Host 与多个业务插件共同运行时的排障成本。

这些收益需要通过 Cool Admin 和 Pah 的真实回归来证明，不能仅凭依赖安装成功就宣告获得。

### 验证体系和组件生态继续向 4.x 演进

Midway 4 新增统一的 `@midwayjs/validation` 体系，可适配 Joi、Zod 和 class-validator；原
`@midwayjs/validate` 不再继续演进。迁移到新体系可以减少对旧单一验证实现的绑定，并为
后续 DTO、公开登录、插件管理 API 和外部身份输入提供更一致的验证扩展点。

同时，Midway 的当前文档、新组件和后续修复已经以 4.x 为主要目标。完成升级后，Phoenix
可以直接消费新的官方维护成果，避免每次引入组件时都先确认是否仍兼容旧主线。

### 降低未来一次性迁移风险

Phoenix 仍在持续增加 Pah、统一身份、字典、插件运行时和 clean-validation 能力。功能越多，
未来一次性跨越框架大版本的回归面就越大。现在采用“纯 Cool 8.x 先升级、Phoenix 后合并”
的方式，可以把基础框架兼容与 Phoenix 扩展适配拆成两个可审计阶段，降低未来集中迁移风险。

因此推荐升级，但不推荐直接在当前 `develop` 上改版本号，也不推荐把升级与业务插件功能、
数据库迁移或产品发布混在同一个变更窗口中。

## 已核实的上游状态

### Cool Admin 8.x

只读执行 `git ls-remote upstream refs/heads/8.x` 的结果仍为：

```text
e545ef6f3b0c08581e34bd3207ca57d851ccc3ae refs/heads/8.x
```

该提交的 `package.json` 同样使用 `@midwayjs/* ^3.20.3`，因此截至调查时，官方
Cool Admin 8.x 并没有替项目完成 Midway 4 升级。

### Midway 4

Midway 官方资料确认了以下事实：

- Midway 4.0 于 2026 年正式发布，最低 Node.js 版本改为 20；
- 所有适用的核心与组件包需要统一升级到 4.x，不能只升级单个包；
- 隐式入口扫描被移除，应用必须显式配置文件检测器；
- 空参数 `@App()` 改为 `@MainApp()`；
- `@midwayjs/validate` 不再继续演进，官方推荐迁移到 `@midwayjs/validation`；
- `@midwayjs/mock` 的 `createApp` 参数发生变化，并提供 legacy 测试入口作为过渡；
- 日志上下文格式、容器部分 API、数据源管理配置等存在不兼容变更。

官方资料：

- [Midway 4.0 发布说明](https://midwayjs.org/en/blog/release/4.0.0)
- [Midway 3.x 升级到 4.x 指南](https://midwayjs.org/en/docs/upgrade_v4)
- [Midway 维护计划](https://midwayjs.org/en/docs/release_schedule)
- [Midway 变更日志](https://midwayjs.org/en/changelog)
- [Cool Admin Midway 官方仓库](https://gitee.com/cool-team-official/cool-admin-midway)

## 为什么不能直接在 Phoenix 中改版本号

### Cool 组件仍绑定 Midway 3

当前安装的 `@cool-midway/core@8.0.8` 直接依赖：

```text
@midwayjs/cache-manager ^3.20.0
```

`@cool-midway/core`、`@cool-midway/rpc` 和 `@cool-midway/task` 的编译产物还直接使用
`@midwayjs/core`、`@midwayjs/koa`、`@midwayjs/typeorm` 以及 Midway 容器 API。

如果只把 Host 的顶层依赖改成 4.x，pnpm 很可能同时安装 Midway 3 和 Midway 4。
同一进程出现两套容器、装饰器元数据或组件实例不能视为兼容成功，必须 fail-closed。

因此第一项真正的阻断不是 Phoenix 业务源码，而是 `@cool-midway/*` 是否已有正式的
Midway 4 兼容版本。调查时未发现官方兼容候选；阶段 A 使用仓内锁定、可审计的 pnpm patch
验证了技术可行性，并覆盖了以下实际不兼容点：

- `@cool-midway/core` 对 cache-manager 3.x 的传递依赖；
- Cool 组件在 Midway 4 下缺少显式 detector，导致内部 Provider 未登记；
- Cool 标签元数据读取依赖旧容器行为；
- `@cool-midway/rpc` 导入 Midway Core 的私有 `dist` 路径；
- Cool 内部空参数 `@App()`、全配置注入和关闭期容器访问。

这些 patch 是可复现的候选验证制品，不是最终上游发布物。正式发布前应优先将修改提交给
`@cool-midway/*` 上游并换成正式兼容版本；若 Phoenix 决定临时携带 patch，则必须把 patch
哈希、目标包版本和完整门禁纳入发布审计，不能依赖手工修改 `node_modules`。

### Phoenix 会放大显式扫描变化

Midway 4 不再进行隐式入口扫描。本仓当前 `src/configuration.ts` 只有
`@Configuration({ imports, importConfigs })`，尚未声明 `CommonJSFileDetector`。

纯 Cool Admin 只需证明 Host 自己的 Controller、Service、Entity、任务等能够被完整发现；
Phoenix 合并阶段还必须额外证明：

- Pah Host 模块完整注册；
- 开发挂载和正式安装的插件闭包按声明被扫描；
- 未登记目录、路径逃逸和产品源码不会被 Host 意外扫描；
- `src/entities.ts` 仍是构建期生成物，产品实体不会进入 Host Git 历史；
- 插件停用、卸载和重启后的路由/任务边界仍符合 Pah 契约。

这些是 Phoenix 专属问题，不应混入第一阶段的纯上游升级。

## 当前源码受影响面

静态调查得到以下直接命中：

| 项目 | 当前命中 | 初步处理 |
| --- | ---: | --- |
| `@midwayjs/*` 直接依赖 | 14 个包 | 已统一为 4.x 并生成锁文件 |
| `@App()` | 21 处/21 个文件 | 已改为 `@MainApp()` |
| `@Configuration` | 1 个入口 | 已增加显式 detector 和冲突检查 |
| `@midwayjs/validate` | 3 个文件 | 第一阶段可验证兼容，正式方案迁移到 `validation` |
| `@midwayjs/decorator` | 0 | 无直接迁移工作 |
| 旧 `createApp` 测试调用 | 0 | 已增加 v4 启动器与完整应用运行门禁 |
| `contextLoggerFormat` | 0 | 无直接迁移工作 |
| `validateConnection/cacheInstance` | 0 | 无直接迁移工作 |
| Midway 内部 `dist/*` 导入 | Host 0、Cool RPC 1 | Host 无命中；Cool RPC 已用公开 lodash API 替换 |

此外还必须检查：

- `cool check`、`cool entity`、`bundle`、`mwtsc` 是否支持 Midway 4；
- `@cool-midway/typeorm` 与 `@midwayjs/typeorm@4` 的组合；
- `bootstrap.js`、production build、`@yao-pkg/pkg` 的 Node 20/22 产物；
- Koa Context、生命周期、装饰器继承、异常过滤器和中间件顺序；
- Windows 下 CLI、构建、可信备份和路径处理。

## 推荐的分支与合并策略

### 阶段 A：纯 Cool Admin 8.x 兼容分支

从精确上游提交创建独立分支，不从 Phoenix `develop` 创建：

```bash
git switch --detach e545ef6f3b0c08581e34bd3207ca57d851ccc3ae
git switch -c codex/cool-admin-8x-midway4
```

该分支只能包含 Cool Admin/Midway 兼容改动：

1. 确认或提供兼容 Midway 4 的 `@cool-midway/*` 候选；
2. 将全部适用的 `@midwayjs/*` 统一提升到同一套 4.x 矩阵；
3. 将 Node engine 提升为 `>=20`，以 Node 22 为主要验证版本、Node 20 为最低门禁；
4. 增加显式 detector；
5. 迁移 `@App()`、验证组件、日志和受影响 API；
6. 重建 lockfile，证明运行时不存在 Midway 3 残留或重复 Core；
7. 完成纯上游测试、构建、启动和数据库回归。

不要在该分支加入 Pah、飞书、Phoenix 实体、插件 manifest 或产品配置。

### 阶段 B：合入 Phoenix 升级分支

纯上游分支门禁通过后，从当前 Phoenix `develop` 创建升级分支，再使用真实 merge：

```bash
git switch develop
git switch -c codex/phoenix-admin-midway4
git merge --no-ff codex/cool-admin-8x-midway4
```

这一步需要保留 merge commit，以清楚记录“上游兼容层”和“Phoenix 适配层”的父提交。
不得把纯上游升级 squash 成无法追溯来源的大提交。

随后只在 Phoenix 升级分支处理：

- Pah 显式扫描与插件装配；
- 统一身份、飞书登录、字典与导航；
- runtime artifacts、迁移制品和安装器；
- clean-validation 与真实插件联合验收；
- Phoenix 文档、Node engine 和发布说明。

### 阶段 C：进入 develop

只有阶段 A、B 的门禁全部通过，才允许把
`codex/phoenix-admin-midway4` 合入 `develop`。当前 Midway 3 发布线在此之前继续维护，
不修改现有生产数据库，也不在现有 8101/8201 服务上做依赖试装。

## 实施顺序

### 0. 冻结证据

- 记录 Cool Admin `8.x` 精确提交与 tree SHA；
- 记录当前 Phoenix `develop` 精确提交与 tree SHA；
- 保存 `package.json`、lockfile 和 `pnpm list @midwayjs/core` 结果；
- 建立 Node 20、Node 22、macOS/Linux/Windows 验证矩阵；
- 禁止使用带产品挂载或 dirty `src/entities.ts` 的工作树生成依赖基线。

### 1. 解决 Cool 组件兼容性

- 查询 `@cool-midway/core/rpc/task/typeorm` 的正式支持矩阵；
- 若没有 Midway 4 版本，先在其源码仓完成兼容和独立发布候选；
- 验证所有 Cool 组件解析到同一个 Midway 4 Core；
- 任一传递依赖仍引入 `@midwayjs/*@3` 时停止升级。

### 2. 升级纯上游应用

- 使用 Midway 官方版本检查工具生成完整组件矩阵；
- 统一修改所有适用的 `@midwayjs/*`，不单独升级某个组件；
- 增加 `CommonJSFileDetector`；
- 迁移 21 处 `@App()`；
- 先保持行为等价，再单独迁移新的 validation 体系；
- 重建 lockfile，并对每个直接/传递 Midway 包做单版本断言。

### 3. 纯上游门禁

- lint、typecheck、unit/integration tests、production build；
- local/prod bootstrap 与正常关闭；
- 登录、权限、菜单、CRUD、上传、静态文件、Cron、Swagger；
- PostgreSQL 与 Cool 官方主要数据库路径；
- Node 20/22，至少 Windows 与 Linux 两个平台；
- `synchronize=false` 下启动，升级本身不得隐式执行 DDL。

### 4. 合并并适配 Phoenix

- 合入 Phoenix 升级分支；
- 用显式扫描白名单覆盖 Host 和已验证插件闭包；
- 验证 Pah manifest、descriptor、runtime artifacts、SQL checksum；
- 验证插件安装、升级、停用、启用、卸载保留数据；
- 验证公开登录、飞书回调、身份绑定与日志脱敏；
- 验证 clean-validation 8201/9100 的端口独占与成对根路径；
- 验证纯 Host Git 树不含任何产品实体或产品路径。

### 5. 发布与回滚

- Midway 4 升级应作为 Phoenix 的独立特性版本发布，不与业务插件功能混发；
- 保留最后一个 Midway 3 发布分支和可复现 lockfile；
- 数据库保持 `synchronize=false`、`initialize=false`，框架升级不得自动改变 schema；
- 回滚以应用版本和 lockfile 为单位，不对数据库做推测性回滚；
- 若插件或 Cool 组件存在双 Core、扫描缺失、路由差异或构建差异，继续留在升级分支。

## 必须满足的放行条件

以下条件全部满足，才可宣告 Midway 4 升级完成：

1. `pnpm list` 中不存在运行时 Midway 3 Core，也不存在 3/4 双 Core；
2. 所有 `@cool-midway/*` 组件有明确的 Midway 4 支持证据；
3. 纯 Cool Admin 8.x 在 Node 20/22 和 Windows/Linux 上通过完整门禁；
4. Phoenix Host 与 Pah 插件在显式 detector 下无漏注册、无越界扫描；
5. production build、启动、停止、打包和 clean-validation 全通过；
6. 数据库未因框架升级隐式建表、改表或重放插件迁移；
7. `src/entities.ts` 与产品挂载仍保持本地生成、Host Git 零归档；
8. 升级提交可清楚追溯到上游 `8.x@e545ef6` 和 Phoenix 合并点；
9. 文档、Node engine、部署镜像和 Windows 工具链均已更新；
10. 保留 Midway 3 发布线的可操作回滚方案。

## 当前决策

采用用户提出的方案：**先在纯 Cool Admin 8.x 基线上升级 Midway 4，验证后再合并到
Phoenix**。阶段 A 已在独立 worktree 中启动；依赖、lockfile、框架入口和测试修复只允许
进入该兼容分支，不改变现有 Phoenix 数据库或运行服务。

阶段 A 开发期间保持上游 `cool-admin@8.0.0` 版本，使用分支与提交 SHA 标识验证候选；如需
发布临时兼容包，使用合法的 SemVer 预发布版本（例如 `8.0.1-midway4.1`），不使用
`8.x-midway4.xxx`。合入 Phoenix 后另按 Phoenix 产品版本线评估 `0.3.0-alpha.1`。
