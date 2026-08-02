# Pah 通用插件数据库迁移契约

## 结论与边界

Pah manifest format v2 的生产迁移只接受受信任、编译期挂载插件随包发布的 `SQL v1` 制品。Host 不从 HTTP 接收 SQL、文件路径、导入批次或迁移成功状态，也不动态加载上传的 TypeORM migration 类。业务表及其 DDL 始终属于业务插件；Host 只拥有 `pah_` 生命周期和迁移台账。format v1 不具备制品路径语义，必须显式升级，不能被静默解释为 v2。

开发环境的 TypeORM `synchronize=true` 只用于本地实体发现，不是生产迁移，也不能产生 `applied` 台账。生产配置保持 `synchronize=false`。

需要在本地复现生产迁移时，必须使用明确命名且可清理的专用数据库，并显式设置 `PAH_DB_SYNCHRONIZE=false`、`PAH_DB_INITIALIZE=false`。这两个开关只关闭本地自动建表和 seed/menu 初始化，默认值仍保持既有开发行为；它们不能替代 dry-run、备份、恢复演练或迁移台账。

本阶段不提供跨版本显式 downgrade。数据库事务负责提交前失败回滚；提交后的恢复依赖执行前已经验证的备份及其恢复流程。旧版本制品、应用激活快照和补偿迁移尚未形成通用契约时，Host 不伪造“已回滚”状态。

## 制品布局与 manifest

每个编译期插件使用如下通用布局：

```text
src/modules/<moduleId>/
├── pah-plugin.artifacts.json
├── entity/
└── migrations/
    ├── 0001-bootstrap.sql
    └── 0002-add-index.sql
```

manifest 的每条迁移声明唯一 SQL 路径：

```json
{
  "id": "example-plugin-bootstrap",
  "version": 1,
  "checksum": "sha256:<64 lowercase hex>",
  "description": "初始化示例数据",
  "artifact": {
    "format": "sql",
    "path": "migrations/0001-bootstrap.sql"
  }
}
```

约束如下：

- `id` 属于插件命名空间，`version` 在单个 manifest 内唯一且为正整数。
- 路径只能是 `migrations/` 下的小写安全相对 `.sql` 路径；绝对路径、父目录、反斜杠和符号链接均拒绝。
- checksum 是 SQL 文件原始字节的精确 SHA-256，可用 `checksumPahSqlArtifact` 生成。
- Host 会递归枚举插件包的 `migrations/**/*.sql`，声明与文件集合必须一一对应，不能漏报或夹带 SQL。
- 单个 SQL 制品上限为 1 MiB。全部迁移按 `version` 升序执行。
- SQL 必须能在一个 PostgreSQL 事务内执行；需要事务外执行的 DDL 不属于 `SQL v1`。

## 挂载与构建

插件在自己的模块根提供稳定的编译制品描述符，不相对导入 Host `src/modules/pah`，也不在 Host 源码登记产品 ID：

```json
{
  "formatVersion": 1,
  "moduleId": "example-plugin",
  "version": "0.1.0"
}
```

`PahCompiledPluginRegistry` 在 dry-run 时按安全 `moduleId` 惰性查找 `pah-plugin.artifacts.json`，核对 descriptor、manifest 与目录名的模块/版本一致性后自动登记绝对包根。生产只查编译输出目录；非生产环境额外允许同一工作区的 `src/modules/<moduleId>`。登记和路径均没有 HTTP 接口。

消费侧固定采用“通用构建装配器自动发现”，不采用插件主动调用 Host service 或 IoC token：

1. 插件仓维护 manifest v2、descriptor、实体和 `migrations/`；manifest 与 descriptor 的 `moduleId`/版本必须一致，`moduleId` 还必须与模块目录名一致；
2. 插件源码不得通过相对路径导入 Host 的 `src/modules/pah`，也不得调用 `PahCompiledPluginRegistry.register()`；该方法只供 Host 内部装配和测试使用；
3. 受控构建把插件模块挂载到通用 `src/modules/<moduleId>` 槽位，装配器自动校验并复制制品；
4. 运行时只以已登记 manifest 的 `moduleId` 查找同名编译输出，不扫描或执行插件提供的注册代码。

这样无需发布一个与 Host 源码结构耦合的 TypeScript 包，也不要求 Host tracked 源码维护插件清单；新增插件只增加自己的制品。若未来提供独立、版本化的公共 SDK，再评估用稳定 token 替代 descriptor，但不得退回相对导入 Host 源码。

本地开发可把根目录指向插件源码挂载目录，以便读取 `migrations/`。本地实体由 `**/modules/*/entity` 通用规则发现；`synchronize` 创建的结构仅供开发。

正式构建在插件源码被受控挂载到 `src/modules/<moduleId>` 后执行 `pnpm build`：

1. `cool entity` 通用扫描 `src/modules/*/entity/**/*.ts` 并生成生产实体清单；
2. TypeScript 编译业务模块；
3. `scripts/copy-pah-plugin-artifacts.mjs` 校验通用 descriptor，并将 descriptor 与所有 `src/modules/*/migrations` 原样复制到 `dist/modules/*`；存在迁移目录但缺少/错配 descriptor 时构建失败；
4. 打包配置把 descriptor 和 SQL 作为资产包含。

Host 仓不提交业务插件目录或产品路径。构建流水线挂载的业务源码、生成的产品实体导入和 SQL 只存在于受控构建工作区/产物；业务插件仓仍是源码真源。

## dry-run、安装与升级

`GET /admin/pah/plugin/migration-plan?moduleId=...` 是只读 dry-run。它验证注册版本、目录边界、声明/制品一一对应、checksum、排序和既有台账，返回每项 `pending` 或 `applied`，但不执行 SQL。成功计划带有绑定模块/版本的 15 分钟一次性 `planId`；过期、重复使用、绑定不符或执行前台账发生变化都会拒绝。

包含 DDL 的插件不能通过普通 HTTP `install` 直接安装。受控发布编排必须依次完成：

1. 登记并验证 manifest；版本升级只允许从 `disabled`、`uninstalled` 或 `failed` 等安全状态重新进入 `verified`。
2. 注册同版本编译制品，运行 dry-run 并保存计划证据。
3. 由可信备份模块创建备份、验证可恢复性，并在进程内向 `PahMigrationBackupGate` 登记验证器。
4. 编排调用不暴露给控制器的 `installCompiled(moduleId, planId, backupProof)`。
5. Host 重新校验制品，把生命周期推进到 `staged`，再在单一事务内锁定插件记录、执行待办 SQL、写 `pah_plugin_migration_record`，并完成 `migrated → installed`。
6. 受控重启后再启用路由、菜单、controller 和 capability 贡献。

默认没有可信备份验证器，因此 DDL 执行安全失败。客户端填写的任意字符串不能充当备份证明；验证器必须核对备份 ID、插件、`default` 数据源、时间、完整性及恢复流程。

## 幂等、台账、失败与恢复

- Host 为每次执行生成批次 UUID；客户端不能指定批次或写 `applied`。
- 同一事务中的执行器在 SQL 成功后写入声明版本、checksum、制品路径、插件版本和已验证备份 ID。
- 重试时，已有且版本/checksum 完全一致的 `applied` 项会跳过；重复有效记录、删除历史声明或修改已应用 checksum 会阻断。
- 任一 SQL、台账或状态提交失败都会回滚整个事务；安装记录随后进入 `failed` 并保留错误信息。
- 事务提交后的恢复使用执行前备份。正式发布前，具体插件必须在等价数据集演练备份恢复、核对行数/约束/黄金查询，并记录责任人和观察窗口。

## 发布门禁

通用 Host 契约通过并不等于某个业务插件可生产发布。每个插件仍必须提供：

- 固定 legacy/目标 commit、数据范围和唯一命名空间；
- 幂等 SQL、dry-run 输出、可信备份证明和已演练恢复步骤；
- 行数、主外键、唯一约束、历史 ID 映射和黄金查询核对；
- `synchronize=false` 的生产构建验证、权限拒绝路径和真实浏览器旅程；
- 中文本地提交、审计记录及明确的切换/回滚责任人。

缺少上述任一生产 DDL 恢复门禁时，只能继续开发验证，不能宣称迁移完成或允许生产切换。
