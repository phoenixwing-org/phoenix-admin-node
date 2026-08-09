# Admin Host 空库基线契约

## 用途与冻结输入

`src/modules/pah/host-baseline/host-baseline.json` 是 Admin Host 空库基线的唯一清单。
v1 绑定 Node Host `0d94cbfd3179ab327ffb35ec653cbf1869d13c1d`，包含该提交 tracked
`src/entities.ts` 的 29 个 Host relation，以及同一提交的 Pah Host schema v2 字典治理。
它不包含之后新增的外部身份四表，也不执行 Pah Host identity 0003。

运行时只读取清单内三份已版本化 SQL。TypeORM metadata 只用于一次性生成
`0001-host-entities.sql` 候选，不参与 plan 或 apply，也不会调用 `synchronize`、`initDB`
或 `initMenu`。清单逐文件锁定 size/SHA-256，并通过现有 Git 仓内的冻结 commit object
和 `git show <commit>:<path>` 复核来源；不要求额外 checkout 或 worktree。

## 安全边界

- `PAH_HOST_BASELINE_ENVIRONMENT` 必须精确为 `release-validation`。
- PostgreSQL 必须是 16.x，地址必须是 loopback。
- `PAH_HOST_BASELINE_DB_DATABASE` 必须与
  `PAH_HOST_BASELINE_ALLOWED_DATABASE` 完全相同，且不能是 maintenance 数据库。
- 首次 apply 只接受 public schema 精确空库；三份 SQL 在同一 serializable transaction
  与 advisory lock 下执行，提交前核对 29 表、列、索引、约束和序列的完整结构指纹。
- 已精确匹配的 baseline 重复 apply 是只读 noop；partial、额外 relation 或结构指纹不匹配
  都 fail-closed。
- 空库没有需要备份的业务数据，因此 schema apply 的 `backupRequired=false`。数据库整体
  是回滚边界；验收结束后的删除由 Dev Hub 受控回收流程和本机操作者负责。
- baseline 不安装 COOL/Pah 业务插件，不写插件 migration、菜单、角色、导航或字典 reconcile
  台账。`verify` 会报告这些计数以及 29 表逐表行数。

## 正式 plan、apply 与 verify

先在当前 Node Git 仓设置目标。数据库用户名必须显式提供，不回退到 `USER`：

```shell
export PAH_HOST_BASELINE_ENVIRONMENT=release-validation
export PAH_HOST_BASELINE_DB_HOST=127.0.0.1
export PAH_HOST_BASELINE_DB_PORT=5432
export PAH_HOST_BASELINE_DB_USERNAME='<local-postgres-user>'
export PAH_HOST_BASELINE_DB_PASSWORD='<local-postgres-password-if-required>'
export PAH_HOST_BASELINE_DB_DATABASE='<exact-release-validation-database>'
export PAH_HOST_BASELINE_ALLOWED_DATABASE='<exact-release-validation-database>'
export PAH_HOST_BASELINE_SOURCE_REPOSITORY='/absolute/path/to/phoenix-admin-node'
```

只读预检：

```shell
pnpm run host:baseline -- plan
```

只有输出 `action=apply` 和 `databaseState=empty` 时，复制输出中的 confirmation 到专用环境变量：

```shell
export PAH_HOST_BASELINE_CONFIRMATION='<confirmation-from-plan>'
pnpm run host:baseline -- apply
pnpm run host:baseline -- verify
```

不要把 confirmation 当作备份证明；它只绑定数据库、baseline 版本和结构指纹。

## 一次性验收管理员

schema 与登录 seed 分开。没有默认用户名、默认口令或固定 hash；manifest、SQL、输出和日志
都不保存明文或密码 hash。用户名和一次性密码都不得超过登录页的 20 字符上限，密码至少
12 字符。只有刚完成 baseline 且所有 29 表仍为空时才允许 seed：

```shell
export PAH_HOST_BASELINE_ADMIN_USERNAME='<one-time-local-admin>'
export PAH_HOST_BASELINE_ADMIN_PASSWORD='<one-time-password-at-least-12-chars>'
pnpm run host:baseline -- seed-admin-plan
export PAH_HOST_BASELINE_CONFIRMATION='<confirmation-from-seed-admin-plan>'
pnpm run host:baseline -- seed-admin
```

seed 使用冻结 Host `login.ts` 相同的 MD5 密码比较算法，只在进程内计算 hash；安全输出仅含
`userId=1`、用户名 SHA-256 摘要和 `created=true`。已存在任何 Host 行、缺少显式环境变量、
非本机、非 release-validation 或来源不匹配都会拒绝。

## 受控重置验收管理员

如果一次性凭据不满足登录 UI 契约，只能在尚未安装插件、仍为精确 baseline-ready 的本机
release-validation 数据库内执行一次性“改用户名并换密码”。当前用户名允许逐字匹配旧版
seed 曾接受的 1 至 100 个字符，新用户名必须为 1 至 20 个字符且与当前值不同，新密码为
12 至 20 个字符；没有任何默认值：

```shell
export PAH_HOST_BASELINE_ADMIN_CURRENT_USERNAME='<current-local-admin>'
export PAH_HOST_BASELINE_ADMIN_NEW_USERNAME='<new-local-admin>'
export PAH_HOST_BASELINE_ADMIN_NEW_PASSWORD='<new-one-time-password>'
pnpm run host:baseline -- reset-admin-plan
export PAH_HOST_BASELINE_CONFIRMATION='<confirmation-from-reset-admin-plan>'
pnpm run host:baseline -- reset-admin
```

plan 只读核对 29 表结构、`id=1` 唯一用户、当前用户名逐字匹配、部门/角色/用户/用户角色四项
关系各一行、目标用户名无冲突且插件/Pah 台账全零。confirmation 绑定数据库、baseline 版本、
当前用户名、新用户名和新密码的 SHA-256 摘要；不会单独输出新密码或数据库保存的 MD5。
apply 在 serializable transaction、advisory lock 和 `SELECT ... FOR UPDATE` 下再次核对，只更新
`base_sys_user.id=1` 的 `username`、`password`、`passwordV+1` 与 `updateTime`。提交前复核新值、
四项关系与台账；重复使用旧当前用户名会 fail-closed。

## Hub 交接

Hub 的 `requiredRelations` 应逐字取自 manifest，不再维护手写子集。Hub 只负责建库、调用
本工具、启动/停止和最终受控回收；不能恢复共享 dump，也不能用服务启动动作隐式执行 DDL。
schema `verify` 通过后，`pah_plugin_installation=0`、`pah_plugin_migration_record=0` 和
`pah_plugin_menu_contribution=0` 共同证明尚未安装业务插件。
