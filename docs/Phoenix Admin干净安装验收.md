# Phoenix Admin 干净安装验收

## 目标

此流程验证一个不包含 Open Issue、Function、BOM 或其他业务插件的 Phoenix Admin Host。
它保留 Cool Admin 原有运行命令和初始化资产：

- Node 仍以 `pnpm start` 运行；
- Vue 仍以 `pnpm dev` 运行；
- 首次启动显式开启 `PAH_DB_SYNCHRONIZE=true` 和 `PAH_DB_INITIALIZE=true`，由 Cool
  读取各 Host 模块的 `db.json` 与 `menu.json`；
- 初始化完成后立即以两个开关均为 `false` 重启 API，证明日常运行不依赖自动建表；
- 默认管理员为 `admin / 123456`，仅用于本机隔离验收；
- `pah_plugin_installation`、插件 migration 和菜单 contribution 必须全部为 0。

正式环境也可使用相同开关完成第一次初始化，但应由部署平台创建并 allowlist 精确数据库、
记录备份/回滚边界，并在首次登录后立即修改默认密码。不得在已有业务数据的数据库上开启
`PAH_DB_SYNCHRONIZE`。

## 建立两个测试 worktree

以下路径与分支专用于干净安装验证，不复用带本机业务插件 symlink 的开发目录：

```shell
mkdir -p /Users/kathy/phoenix/.worktrees/phoenix-admin-clean-validation

git -C /Users/kathy/phoenix/phoenix-admin-node worktree add \
  /Users/kathy/phoenix/.worktrees/phoenix-admin-clean-validation/node \
  codex/admin-clean-install-node

git -C /Users/kathy/phoenix/phoenix-admin-vue worktree add \
  /Users/kathy/phoenix/.worktrees/phoenix-admin-clean-validation/vue \
  codex/admin-clean-install-vue
```

两个 worktree 都必须满足 `git status --short` 为空，且 `src/modules` 下没有
`phoenix-*` 产品 symlink。

## 一键安装并启动

首次安装依赖：

```shell
pnpm --dir /Users/kathy/phoenix/.worktrees/phoenix-admin-clean-validation/node install --frozen-lockfile
pnpm --dir /Users/kathy/phoenix/.worktrees/phoenix-admin-clean-validation/vue install --frozen-lockfile
```

随后只需一条命令：

```shell
pnpm --dir /Users/kathy/phoenix/.worktrees/phoenix-admin-clean-validation/node \
  admin:clean-validation -- \
  --vue-root /Users/kathy/phoenix/.worktrees/phoenix-admin-clean-validation/vue \
  --database phoenix_admin_clean_validation_20260805 \
  --api-port 8201 \
  --web-port 9100
```

脚本只接受本机 PostgreSQL，拒绝 `postgres/template*/phoenix_admin` 等保留数据库；目标必须是
空库或已经通过该脚本验证的干净基线。它不会删除、覆盖或恢复已有数据库。

空库先使用 Cool 原生 `db.json` / `menu.json` 初始化默认管理员、角色和菜单，随后按
`pah-host-schema.json` 校验 SHA-256 并等幂应用 Host schema。后者补齐字典
`enabled`、`tags`、`core`、`ownerModuleId` 字段、治理索引和其他 Host 自有表；重复运行只做
兼容性校验和幂等补齐。正式服务启动时仍关闭 `synchronize`、`initDB` 与 `initMenu`，不会在
普通运行阶段隐式执行 DDL。

如果 Node/Vue 已完成 build，可加 `--skip-build`。数据库账户默认取 `PAH_DB_USERNAME` 或当前
系统用户；需要密码时只通过 `PAH_DB_PASSWORD` 传入，脚本不会打印密码。

## 分目录运行（与 Cool 命令完全相同）

如果不使用一键脚本，先确保目标为空库，然后在 Node worktree 执行第一次初始化：

```shell
PAH_SERVER_PORT=8201 \
PAH_DB_DATABASE=phoenix_admin_clean_validation_20260805 \
PAH_DB_SYNCHRONIZE=true \
PAH_DB_INITIALIZE=true \
pnpm start
```

确认日志出现 Cool module database/menu import complete 后停止，再以正常配置启动：

```shell
PAH_SERVER_PORT=8201 \
PAH_DB_DATABASE=phoenix_admin_clean_validation_20260805 \
PAH_DB_SYNCHRONIZE=false \
PAH_DB_INITIALIZE=false \
pnpm start
```

在 Vue worktree 启动：

```shell
PAH_API_TARGET=http://127.0.0.1:8201 \
VITE_PAH_API_TARGET=http://127.0.0.1:8201 \
pnpm dev -- --host 127.0.0.1 --strictPort --port 9100
```

## 用户点检

1. 打开 `http://127.0.0.1:9100/`，使用 `admin / 123456` 登录。
2. 登录完成后地址保持 `/`，显示 Cool 首页，不得跳转 `/404`。
3. 系统管理中的用户、角色、菜单、参数、任务、日志等 Host 功能可见。
4. 字典、文件、回收站和 Pah Host 治理入口可见。
5. 不出现 Open Issue、Function、BOM 等业务 Ribbon/菜单。
6. 数据库中 `pah_plugin_installation`、`pah_plugin_migration_record`、
   `pah_plugin_menu_contribution` 均为 0。
7. 刷新 `/`、退出后重新登录仍进入首页；未知路径才进入 `/404`。

按 `Ctrl+C` 会同时停止本次脚本启动的 Web/API，数据库会保留。删除数据库属于独立的受控
回收操作，不由启动脚本自动执行。
