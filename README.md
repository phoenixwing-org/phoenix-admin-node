# Phoenix Admin Node

Phoenix Admin Host 的 Node.js 后端宿主。仓库以 Cool Admin `8.x` 为固定上游兼容基线，运行于 Midway `4.2.1`，承载统一登录、用户、部门、系统角色、菜单、系统能力与审计。

Phoenix Admin Node 采用独立产品版本线，当前版本为 `0.3.0`；Cool Admin `8.x` 仅表示上游代码兼容基线，不作为 Phoenix 产品版本。当前发布范围见 [0.3.0 发布说明](docs/releases/0.3.0.md)。

> 本仓库是 PhoenixWing 维护的 MIT 分叉，不是 Cool Admin 官方发行物。原 Cool Admin 版权、MIT 许可和 Git 历史完整保留。

## 当前阶段

- 保留上游 API、模块和权限行为，先建立可重复的 classic 基线。
- Host 负责身份、组织、系统授权、菜单和统一审计。
- 已建立通用 `Pah` 业务插件 manifest 注册表，可验证登记、安装、启停、迁移台账与默认保留数据的卸载流程。
- 业务扩展按独立计划推进；本阶段不实现在线上传、运行时源码执行、热加载或插件市场。

工作台继续复用现有 `base_sys_menu` 层级，并通过 `pah_` sidecar 表保存跨模块分组、插件菜单贡献、角色授权快照和迁移台账。

## 仓库关系

| 项目            | 地址/版本                                                |
| --------------- | -------------------------------------------------------- |
| Phoenix 仓库    | <https://gitee.com/phoenixwing/phoenix-admin-node>       |
| Cool Admin 上游 | <https://gitee.com/cool-team-official/cool-admin-midway> |
| 固定基线        | `8.x` / `e545ef6f3b0c08581e34bd3207ca57d851ccc3ae`       |
| 配套前端        | <https://gitee.com/phoenixwing/phoenix-admin-vue>        |

详细同步规则见 [UPSTREAM.md](UPSTREAM.md)。

## 分支

- `master`：稳定发行线和默认克隆分支。
- `develop`：日常集成分支。
- `upstream-sync/*`：固定 SHA 的上游同步分支。

## 本地开发

要求 Node.js 20 或更高版本。本地开发默认使用 PostgreSQL `127.0.0.1:5432`，数据库名
`phoenix_admin`，账号默认取当前系统用户。首次运行先创建数据库：

```shell
createdb phoenix_admin
```

需要覆盖连接信息时使用 `PAH_DB_HOST`、`PAH_DB_PORT`、`PAH_DB_USERNAME`、
`PAH_DB_PASSWORD`、`PAH_DB_DATABASE`；后端端口默认 `8101`，可用 `PAH_SERVER_PORT`
覆盖。生产部署还必须设置 `PAH_APP_KEYS`、`PAH_ADMIN_JWT_SECRET` 和
`PAH_APP_JWT_SECRET`。启动：

```shell
pnpm install
pnpm dev
```

后端欢迎页为 <http://localhost:8101/>，前端工作台默认位于 <http://localhost:9000/>。
本地业务插件管理页为 <http://localhost:9000/phoenix/plugins>，原型边界与接口见
[Pah业务插件契约.md](docs/Pah业务插件契约.md)，生产 DDL、dry-run、台账和恢复门禁见
[Pah插件数据库迁移契约.md](docs/Pah插件数据库迁移契约.md)。Windows 本地可信备份所需
PostgreSQL CLI、配置入口与复检步骤见
[Windows可信备份工具链.md](docs/Windows可信备份工具链.md)。统一登录、飞书 Provider、
外部身份绑定和登录策略见 [Pah统一身份契约.md](docs/Pah统一身份契约.md)，分阶段部署与
回滚边界见 [Pah统一身份迁移清单.md](docs/Pah统一身份迁移清单.md)。

隔离发布验收空库不得启用 `synchronize`、`initDB` 或 `initMenu`。Host-only 的版本化
schema、只读 plan、事务 apply 与一次性验收管理员初始化见
[Admin Host空库基线契约.md](docs/Admin Host空库基线契约.md)。

构建与测试：

```shell
pnpm lint
pnpm test
pnpm build
```

## 命名与许可

Phoenix Admin Host 新增的源码、实体和类型统一使用 `Pah*` 前缀；新增数据库表、配置键等持久化标识使用 `pah_` 前缀。

本仓库及仓内新增 `Pah*` 代码统一采用 MIT。根 [LICENSE](LICENSE) 保留上游原始版权和许可文本，Phoenix 分叉关系及第三方依赖边界见 [LICENSING.md](LICENSING.md) 与 [NOTICE](NOTICE)。

Copyright © 2024–2026 凤凰之翼（PhoenixWing）贡献者。本产品的正式源码仓库为
[phoenix-admin-node](https://gitee.com/phoenixwing/phoenix-admin-node)。
