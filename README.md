# Phoenix Admin Node

Phoenix Admin Host 的 Node.js 后端宿主。仓库以 Cool Admin Midway `8.x` 为固定基线，逐步承载统一登录、用户、部门、系统角色、菜单、系统能力与审计。

> 本仓库是 PhoenixWing 维护的 MIT 分叉，不是 Cool Admin 官方发行物。原 Cool Admin 版权、MIT 许可和 Git 历史完整保留。

## 当前阶段

- 保留上游 API、模块和权限行为，先建立可重复的 classic 基线。
- Host 负责身份、组织、系统授权、菜单和统一审计。
- Open Issue 与 Function 未来以编译期业务模块接入，并继续保留各自资源级授权。
- 首期不实现运行时热插件、在线安装、热卸载或插件市场。

首个 Ribbon 版本复用现有 `base_sys_menu` 层级，不创建分组表。只有出现跨模块持久化布局、用户定制或独立生命周期需求后，才评审 `pah_` 前缀的 sidecar 表。

## 仓库关系

| 项目 | 地址/版本 |
|---|---|
| Phoenix 仓库 | <https://gitee.com/phoenixwing/phoenix-admin-node> |
| Cool Admin 上游 | <https://gitee.com/cool-team-official/cool-admin-midway> |
| 固定基线 | `8.x` / `e545ef6f3b0c08581e34bd3207ca57d851ccc3ae` |
| 配套前端 | <https://gitee.com/phoenixwing/phoenix-admin-vue> |

详细同步规则见 [UPSTREAM.md](UPSTREAM.md)。

## 分支

- `master`：稳定发行线和默认克隆分支。
- `develop`：日常集成分支。
- `upstream-sync/*`：固定 SHA 的上游同步分支。

## 本地开发

要求 Node.js 18 或更高版本。本地开发默认使用 PostgreSQL `127.0.0.1:5432`，数据库名
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

构建与测试：

```shell
pnpm lint
pnpm test
pnpm build
```

## 命名与许可

Phoenix Admin Host 新增的源码、实体和类型统一使用 `Pah*` 前缀；新增数据库表、配置键等持久化标识使用 `pah_` 前缀。

本仓库及仓内新增 `Pah*` 代码统一采用 MIT。根 [LICENSE](LICENSE) 保留上游原始版权和许可文本，Phoenix 分叉关系及第三方依赖边界见 [LICENSING.md](LICENSING.md) 与 [NOTICE](NOTICE)。
