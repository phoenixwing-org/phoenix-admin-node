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
