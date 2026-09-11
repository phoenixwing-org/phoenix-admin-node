# Phoenix Admin 维护中心契约

## 目的

`/phoenix/maintenance` 是 Phoenix Admin Host 统一的检测与等幂维护入口。它用于处理已经存在
于数据库或运行配置中的旧状态，例如菜单路径迁移、历史配置修正和插件升级后的可重复修复。

维护中心不是 SQL 控制台，也不执行浏览器、插件包或管理员提交的任意脚本。

## 固定流程

每个维护项必须服从同一流程：

1. `GET /admin/phoenix/maintenance/read` 读取全部已登记维护项的当前状态；
2. `POST /admin/phoenix/maintenance/plan` 按 `operationId` 重新检测并生成计划指纹；
3. 管理员查看影响记录并显式确认；
4. `POST /admin/phoenix/maintenance/apply` 携带 `operationId` 和 `expectedFingerprint`；
5. Host 在 `SERIALIZABLE` 事务中重新检测，指纹不一致时拒绝执行；
6. 执行完成后立即复检，结果必须为 `healthy`，否则回滚整个事务。

已经是 `healthy` 的维护项可重复执行，返回 `applied=false`，不得产生额外写入。

## 安全边界

- 只有 Host 根管理员可以读取计划或执行维护；
- Controller 只接受已编译进 Host 的受控 `operationId`；
- API 不接收 SQL、脚本、文件路径、模块目录或任意回调；
- 一个维护项失败只影响自身，不阻断登录、工作台或其他健康插件；
- 启动健康检查以后可以只读取状态并输出 `healthy`、`action-required` 或 `blocked`，不得在
  启动阶段自动修改数据库；
- 维护项不得替代插件 DDL migration、备份、恢复或产品业务流程。

## 首个金样本：字典菜单入口

`phoenix-dictionary-menu-route-v1` 检测 `base_sys_menu` 中仍使用以下旧值的记录：

- `/pah/dictionary-maintenance`；
- `modules/pah/views/dictionary-maintenance.vue`。

维护操作只把命中的字段分别改为：

- `/phoenix/dictionary-maintenance`；
- `modules/phoenix/views/dictionary-maintenance.vue`。

同一变更也作为 Host schema v4 的
`schema/0004-dictionary-menu-route.sql` 发布。干净安装直接使用新菜单基线；现有环境可以走受控
schema 升级或维护中心，二者都可重复运行且最终状态一致。Vue 不再保留字典旧深链或旧
`viewPath` 的运行时改写。

## 扩展中心菜单名称

`phoenix-extension-center-menu-name-v1` 检测 `/helper/plugins` 菜单是否仍使用旧名称“插件列表”。
命中后只把菜单名称等幂改为“扩展中心”，不改变路由、View、权限或子菜单。

“扩展中心”是统一管理入口，Primary 内按职责拆为：

- 插件：Cool 插件、Phoenix 插件；
- Host 管理：导航分组、字典治理、系统维护。

干净安装的 `menu.json` 直接使用“扩展中心”；旧数据库通过维护中心显式检测和升级，前端不以
临时显示覆盖数据库真值。

## 消费者扩展边界

后续业务插件可以在受控 manifest 版本中声明维护项的展示元数据和 Host adapter 标识，但不得
向维护中心注入运行时代码或任意 SQL。Host 负责：

- 校验插件安装/启用状态和 adapter allowlist；
- 统一权限、计划指纹、事务、复检与审计摘要；
- 统一 Wing 页面、状态标签、确认框和错误呈现。

消费者负责：

- 提供只读检测和等幂修复算法的受控适配；
- 只修改本插件拥有的数据或已声明的 Host contribution；
- 提供 `healthy → action-required → healthy`、重复执行和失败回滚测试；
- 不再复制第二套维护页面、执行器、Header 或进度动画。

插件贡献协议尚未冻结前，只登记 Host 内置维护项。历史独立插件的专用维护页面先保留，待统一
adapter 契约完成后逐项迁入，不在 Host 中硬编码产品名。
