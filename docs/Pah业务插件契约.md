# Phoenix Admin Host 业务插件契约

## 当前结论

Phoenix Admin Host 已建立独立于 Cool `.cool` Hook 插件的业务插件注册表。它面向同时包含前端、后端、路由、权限、数据和任务贡献的业务模块，用于验证通用宿主契约。

首版不读取或执行 manifest 的入口文件，不使用 `eval`，也不支持生产在线上传。插件入口统一声明为 `restart`，真正加载必须经过受控构建和受控重启流程。manifest format v2 的数据库迁移只接受编译期插件随包发布的受控 SQL，完整门禁见 [Pah插件数据库迁移契约.md](Pah插件数据库迁移契约.md)。

## 持久化与接口

- 安装记录表：`pah_plugin_installation`。
- 控制器前缀：`/admin/phoenix/plugin`。
- 查询：`list`、`page`、`info`、`enabled`。
- 操作：`register`、`migration-plan`、`install`、`enable`、`disable`、`uninstall`。

生命周期为：

```text
uploaded → verified → staged → migrated → installed → enabled
                                               ↕
                                            disabled → uninstalled
```

本地原型从已验证 manifest 开始登记。无 DDL 的插件可由普通 `install` 完成安装；包含 DDL 的插件必须先 dry-run 和可信备份，再由不暴露给 HTTP 的编译期发布编排依次完成 `staged`、`migrated`、`installed`。启用状态不能直接卸载，必须先停用。

## 安全边界

- `moduleId`、路由、API 和能力码必须留在插件自己的命名空间。
- `routePrefix` 可为技术模块声明单段短路由前缀；省略时使用 `/{moduleId}`，并拒绝多段或畸形路径。
- Web/Node 入口必须是包内相对路径，拒绝绝对路径、父目录和反斜杠路径。
- 首版只接受受控重启激活，不接受动态执行模式。
- 卸载必须提供备份标识，并固定 `dataRetained=true`；当前没有永久清除接口。
- 畸形 HTTP JSON 只形成校验错误，不应导致校验器运行时异常。
- `hostReuse` 只能声明 Host 公开的身份、用户、部门、角色、菜单、字典、文件、任务、审计、参数和备份能力；`identity` 的公开契约与迁移状态见 [Pah统一身份契约.md](Pah统一身份契约.md)。`files` 已具备 v1 描述符、认证内容与通用绑定契约，见 [Phoenix Host Files v1契约.md](Phoenix%20Host%20Files%20v1契约.md)；其他声明仍不自动代表运行能力已经实现。
- Host 只登记插件声明，不把任一产品的业务实现写死到后端。

## 导航、授权与迁移台账

- Host 内置“管理”“开发”“业务”三个导航大分组。管理员可在 Host 全局配置中修改显示名，但稳定键始终保持 `pah-group-management`、`pah-group-development`、`pah-group-business`。所有插件导航模块首次物化时统一进入稳定键 `pah-group-business`；manifest 不创建顶层分组、不覆盖共享分组显示名，也不覆盖管理员分配。
- 独立产品大分组只能由 Host 管理员通过 `save-group` 创建，再从 `navigation/read` 取得稳定 group ID 并用 `navigation/assign` 移动模块。Host 不维护产品 ID 或分组映射。
- 稳定 targetKey 已有 assignment 时，插件升级、重新登记、停用和再次启用一律保留。删除非内置组仍需管理员显式调用 `remove-group`；Host 不随插件生命周期自动删除分组。
- 启用插件时，Host 把导航模块、页面和能力码物化为系统菜单，并记录稳定贡献键。
- 停用前按稳定贡献键保存角色授权，删除插件菜单并刷新权限缓存；再次启用时恢复授权。
- manifest 声明有序 SQL 制品；Host 执行器校验 checksum，在同一数据库事务内执行待办 DDL 并写入 `pah_plugin_migration_record`。客户端不能提交批次或伪造 `applied`。
- 开发 `synchronize`、fixture、seed/reset 与生产 migration 严格分离；生产执行必须具备 dry-run、可信备份及已演练恢复路径。

## 字典治理与补全

- `dict_info.enabled` 是启用/停用二态的唯一真源；不再并列增加含义重复的 `status`。业务字典读取默认只返回启用项，管理列表仍可查看全部。
- `tags` 是规范化的简单字符串数组，不建立标签关联表；`core` 表示 Host 必须保护的协议值，`ownerModuleId` 表示插件管理边界。
- 普通 Cool 字典 CRUD 不能设置或接管 `core`、`ownerModuleId`。核心项仅允许调整显示名称和备注；插件受管项不能修改稳定 value、类型、核心标识或所有者，也不能通过普通 CRUD 删除。
- Pah manifest 可为字典项声明 `tags`、`enabled` 和可定制字段。`GET /admin/phoenix/plugin/dictionary-plan` 只生成计划；Host 管理员以计划指纹确认后，`POST /admin/phoenix/plugin/dictionary-reconcile` 在 `SERIALIZABLE` 事务中补齐缺失项和治理元数据，并写审计台账。
- 系统“数据管理 → 字典维护”只执行幂等 reconcile，不执行 DDL，不覆盖管理员自定义名称、排序、额外标签或未知字典项。再次 dry-run 应为零变更；编辑和停用仍回到 Cool 字典管理页。
- Host schema `0002-dictionary-governance.sql` 负责新增治理列和索引；必须先完成 dry-run、可信备份与隔离 PostgreSQL 恢复演练，再在受控发布窗口执行。普通页面按钮不得执行 `ALTER TABLE`。

## Host Files v1

- 插件声明 `hostReuse: ["files"]` 后，仍须按 `<moduleId>:files:read|write|admin` 分别声明 Host 固定 endpoint；不能通过 Files capability 借用其他 Host API。
- 每次请求都重新校验插件处于 enabled、目标 owner、manifest capability 和当前角色。URL 中的 `ownerModuleId` 不能单独作为授权依据。
- 插件只能保存 Host `fileId` / `bindingId`；不得读取 storage key、拼接 `/upload` URL或把 `space_info` 当作 Files 描述符。
- 内容读取始终经过认证 API、完整性复检和 no-sniff 响应；删除、解绑和后续 retention/GC 是不同动作。

## 本地验收

1. 启动 PostgreSQL 和 `phoenix-admin-node`，本地配置会用 TypeORM `synchronize` 创建注册表。
2. 启动 `phoenix-admin-vue`，访问 <http://localhost:9000/phoenix/plugins>。
3. 对包含 DDL 的插件先查看只读迁移计划；本地验证不得把 `synchronize` 自动建表当成 applied migration。
4. 无 DDL 插件可依次执行登记、安装、启用、停用、卸载；DDL 插件使用受控发布编排。
5. 验证最终状态为 `uninstalled`、`dataRetained=true`，页面列出保留表和备份标识。

生产环境禁用 `synchronize`。进入生产试用前还必须为具体插件完成签名包校验、备份恢复演练、权限/数据核对和入口物理隔离；通用 Host 契约通过不能替代插件自己的生产验收。
