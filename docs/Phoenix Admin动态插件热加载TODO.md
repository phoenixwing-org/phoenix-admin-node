# Phoenix Admin 动态插件热加载 TODO

## 当前决定

Phoenix 业务插件当前采用 `activationMode: restart`。`.phoenix.cool` 可以在管理页完成校验、装配、DDL dry-run、可信备份、安装、启停和保留数据卸载；新 Node Controller、Service、Entity 与任务贡献仍需由受控进程重启加载。

这不是最终的热插拔方案。当前阶段不在生产进程中执行 `npm install`，也不宣称卸载后已从 Node 运行时释放模块。

## 需要研究的 Cool 机制

- Cool 所谓“动态安装插件”是否真正向正在运行的 Midway 容器注册新 Controller、Service、Entity、定时任务和事件监听，还是通过进程管理器完成无感重启。
- Cool 插件在安装前是否已经把运行依赖放入 Host，或是否只动态加载固定 Hook/配置等受限扩展面。
- 插件路由、依赖注入、ORM metadata、EPS、权限缓存和前端动态模块分别在什么时点刷新。
- 停用/卸载时如何注销路由、容器对象、定时器、消息订阅和数据库连接，是否存在内存泄漏或旧代码继续执行的风险。

## Phoenix 候选方向

1. **受控滚动重启**：继续把插件装配为不可变制品，由 supervisor 排空请求后重启；优先保证可审计、可回滚。
2. **受限动态扩展点**：Host 预装并维护稳定 npm 依赖白名单，插件只提供声明式配置或在固定 dispatcher 后运行的纯业务 handler。
3. **隔离运行时**：将插件放入 child process/worker，通过版本化 RPC 契约调用；Host 不直接加载插件依赖。

不接受把任意插件依赖直接写入共享 `node_modules` 后在生产进程内 `import()` 的方案，除非补齐签名、SBOM、依赖冲突、native addon、进程回收和回滚证明。

## TODO：薄插件包与管理员受控安装依赖

当前自包含制品会把 Node/Vue 运行依赖一并打入 `.phoenix.cool`。优点是制品不可变、离线可装、
版本边界清楚；缺点是 Excel、图表、编辑器等大型库会明显增加单个插件包体积，不同插件还可能
重复携带相同依赖。

候选方案是让插件包只声明精确依赖，由 Host 展示待安装清单，管理员在后台执行受控安装后再继续
插件点检。此方案暂不执行，需先讨论并验证以下边界：

### 候选流程

1. 插件 manifest 只声明生产运行依赖、精确版本、registry、integrity 和用途，不接受版本范围。
2. Host 在安装前生成依赖计划，显示新增、复用、升级、冲突、体积、许可证和 native addon 风险。
3. 管理员明确确认后，由 Host-owned 安装任务在隔离目录执行；不允许插件上传任意命令或脚本。
4. 安装完成后核对 lockfile、tarball integrity、SBOM、漏洞策略和运行闭包，再允许插件安装。
5. 插件版本与依赖快照绑定；升级、回滚和卸载均引用同一不可变依赖快照，不直接修改共享根目录。

### 可能收益

- 插件包更小，共用库只缓存一次；
- 安装页面可以提前解释缺少哪些依赖及占用空间；
- Host 可统一执行许可证、来源、漏洞和完整性检查；
- 适合内部 Registry、离线镜像和预批准依赖目录。

### 主要风险

- 多插件可能要求同一库的不同版本，直接安装到 Host `node_modules` 会产生依赖漂移和隐式耦合；
- Registry 不可用、包被撤回或 integrity 改变时，插件制品无法独立重现；
- install/postinstall 脚本、native addon 和供应链攻击会扩大 Host 权限面；
- 升级一项共享依赖可能使已启用插件同时失效，回滚也不再只是恢复一个插件包；
- Node 与浏览器依赖的解析、external/bundle 规则不同，开发成功不能代表 production 闭包成立；
- 管理员手工运行 `pnpm add` 难以审计、自动恢复，也容易污染 Host 的 package/lock 与 Git 工作树。

### 优先研究的安全实现

- 不让管理员直接修改 Host 根 `node_modules`，优先采用内容寻址的只读依赖仓或每插件隔离运行目录；
- Host 只提供固定参数的受控安装任务，不提供自由 Terminal、包名输入或任意 registry URL；
- 默认禁止 lifecycle scripts；确需启用时采用签名白名单、沙箱和独立审批；
- 提供“导出安装命令/计划供运维执行”只能作为部署模式之一，执行后仍必须把可验证回执导回 Host；
- 同时比较三种模式：完全自包含、Host 预装依赖白名单、每插件隔离依赖快照；至少用两个插件实测
  包体积、安装时间、冷启动、版本冲突、离线恢复和回滚。

### 决策条件

只有在依赖隔离、精确复现、可信来源、无任意脚本执行、原子启用和可恢复回滚均有证据后，才考虑
放宽“插件必须自包含运行制品”的当前规则。在此之前，安装页不应提示管理员临时执行 `pnpm add`。

## 已完成：Host 与插件实体清单分层

2026-08-12 的无插件开发环境复现了一个真实故障：管理员卸载全部业务插件后，产品模块目录已经移除，
但当时 ignored 的 `src/entities.ts` 仍保留 Open Issue、Function 和 BOM 的实体 import，导致下一次 Node
编译出现 20 条 `TS2307`，API 无法启动。手工执行 `cool entity` 可以恢复，但管理员不应承担这一步。

当前实现已按以下边界收口：

- tracked 的 `src/entities.ts` 是稳定 Host 入口，只列 Host 实体并追加 `entities.plugin.ts`；
- ignored 的 `src/entities.plugin.ts` 由 `scripts/pah-sync-runtime-entities.cjs` 原子生成，只列当前实际
  挂载/装配的插件实体；
- `dev`、`dev:midway4`、typecheck 和 build 在编译前由 Host 同步插件实体与隔离 tsconfig；
- Dev Hub 的 mount、unmount 和 repoint 只维护链接与 Git exclude；Host 启动门禁自行发现实际目录，
  不读取 Hub marker，也不把初始化、健康或实体生成下放给 Hub；
- 本地插件包选择、放弃和卸载同样同步插件实体；
- 任一步失败时同时回滚挂载和实体清单，不能留下“目录已删除、旧 import 仍存在”的中间状态；
- TypeORM 实体元数据在进程启动时固定，因此涉及实体增减仍通过 Host 受控重启生效，不宣称同进程热插拔；
- Host 无业务插件时，`entities.plugin.ts` 必须是空数组，固定入口及 Host tracked tree 不含业务插件路径。

生成器不硬编码 Open Issue、Branding 等产品 ID；它从固定入口读取 Host import 集合，再对实际模块扫描
结果做差集。开发 symlink 还必须通过 clean Git、manifest、Node/Vue 双端入口和逐插件 Host TypeScript
兼容检查；任一失败均 fail-closed，仅输出可复制的 `[phoenix-plugin-health]` 诊断。manifest、descriptor、
migration、版本与包 SHA 的权威安装验证仍由 Phoenix Host 装配器负责。

## 预期验收

- 用户点击启用后不需要手工操作 Terminal；若底层需要重启，由 Host 编排并显示阶段、日志和失败恢复。
- 重启前排空进行中请求，重启失败自动恢复上一不可变装配。
- 新旧版本的 Controller、任务与事件监听不能并存。
- 启停与卸载不会删除插件声明的业务数据；DDL 仍受计划、可信备份和恢复演练约束。
- 前后端路由、权限、菜单、EPS 和运行依赖在同一版本边界内生效。
- 至少用两个不同业务插件证明通用性，不能写产品路径或 moduleId 特例。

## 后续输出

- Cool 动态插件机制的源码审计记录。
- Phoenix 动态运行时 ADR 与安全威胁模型。
- supervisor/worker 原型及两插件集成测试。
- 从 `restart` 升级到新 activation mode 的兼容与回滚计划。
