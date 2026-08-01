# Phoenix Admin Host 业务插件原型

## 当前结论

Phoenix Admin Host 已建立独立于 Cool `.cool` Hook 插件的业务插件注册表。它面向同时包含前端、后端、路由、权限、数据和任务贡献的业务模块，用于验证通用宿主契约。

首版只处理 manifest 与生命周期状态，不读取或执行 manifest 的入口文件，不使用 `eval`，也不表示已经支持生产在线安装。插件入口统一声明为 `restart`，真正加载必须经过后续受控构建或受控重启流程。

## 持久化与接口

- 安装记录表：`pah_plugin_installation`。
- 控制器前缀：`/admin/pah/plugin`。
- 查询：`list`、`page`、`info`、`enabled`。
- 操作：`register`、`install`、`enable`、`disable`、`uninstall`。

生命周期为：

```text
uploaded → verified → staged → migrated → installed → enabled
                                               ↕
                                            disabled → uninstalled
```

本地原型从已验证 manifest 开始登记；`install` 顺序经过 `staged`、`migrated`、`installed`，不允许跳步。启用状态不能直接卸载，必须先停用。

## 安全边界

- `moduleId`、路由、API 和能力码必须留在插件自己的命名空间。
- `routePrefix` 可为技术模块声明单段短路由前缀；省略时使用 `/{moduleId}`，并拒绝多段或畸形路径。
- Web/Node 入口必须是包内相对路径，拒绝绝对路径、父目录和反斜杠路径。
- 首版只接受受控重启激活，不接受动态执行模式。
- 卸载必须提供备份标识，并固定 `dataRetained=true`；当前没有永久清除接口。
- 畸形 HTTP JSON 只形成校验错误，不应导致校验器运行时异常。
- `hostReuse` 只能声明 Host 公开的身份、用户、部门、角色、菜单、字典、文件、任务、审计、参数和备份能力。
- Host 只登记插件声明，不把任一产品的业务实现写死到后端。

## 导航、授权与迁移台账

- Host 内置“管理”“开发”“业务”三个导航大分组。插件建议组不存在时，导航模块回退到稳定键 `pah-group-business`。
- 启用插件时，Host 把导航模块、页面和能力码物化为系统菜单，并记录稳定贡献键。
- 停用前按稳定贡献键保存角色授权，删除插件菜单并刷新权限缓存；再次启用时恢复授权。
- manifest 只声明迁移；实际执行成功后由编译期业务模块写入 `pah_plugin_migration_record`，并以导入批次记录应用或回滚状态。

## 本地验收

1. 启动 PostgreSQL 和 `phoenix-admin-node`，本地配置会用 TypeORM `synchronize` 创建注册表。
2. 启动 `phoenix-admin-vue`，访问 <http://localhost:9000/pah/plugins>。
3. 依次执行登记、安装、启用、停用、卸载。
4. 验证最终状态为 `uninstalled`、`dataRetained=true`，页面列出保留表和备份标识。

生产环境禁用 `synchronize`，后续进入生产试用前必须补正式数据库迁移、签名包校验、原子升级/回滚和入口物理隔离。
