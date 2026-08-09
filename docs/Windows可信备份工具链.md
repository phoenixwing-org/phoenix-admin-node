# Windows 可信备份工具链

## 适用范围

Pah 在本地或隔离发布验证环境执行带数据库迁移的插件安装前，必须先创建 PostgreSQL
自定义格式备份，并把备份真实恢复到一次性数据库。该流程依赖以下五个同版本客户端：

| 工具         | 用途                         |
| ------------ | ---------------------------- |
| `psql`       | 读取真实服务端主版本         |
| `pg_dump`    | 创建自定义格式备份           |
| `pg_restore` | 校验备份目录并执行恢复演练   |
| `createdb`   | 创建一次性恢复数据库         |
| `dropdb`     | 清理一次性恢复数据库         |

Host 会在运行 `pg_dump` 前依次执行五个工具的 `--version`，并要求它们的主版本全部与
实际 PostgreSQL 服务端一致。任何工具缺失、版本无法识别或主版本不一致都会安全失败，
不会开始备份或迁移。

## Windows 配置

推荐把 PostgreSQL 安装目录下的完整 `bin` 目录配置给 Admin API 进程。路径必须是
绝对路径，允许包含空格；Host 使用参数数组启动 `.exe`，不会经过 shell。

PowerShell 示例：

```powershell
$env:PAH_POSTGRES_BIN = 'C:\Program Files\PostgreSQL\16\bin'
$env:PAH_POSTGRES_SERVER_MAJOR = '16'
pnpm dev
```

`PAH_POSTGRES_SERVER_MAJOR` 是可选的期望值，不会绕过真实服务端探测；期望值与
`SHOW server_version_num` 不一致时会拒绝执行。

如果五个工具不在同一目录，可分别指定绝对可执行文件：

```powershell
$env:PAH_PSQL_BIN = 'C:\PostgreSQL\16\bin\psql.exe'
$env:PAH_PG_DUMP_BIN = 'C:\PostgreSQL\16\bin\pg_dump.exe'
$env:PAH_PG_RESTORE_BIN = 'C:\PostgreSQL\16\bin\pg_restore.exe'
$env:PAH_CREATEDB_BIN = 'C:\PostgreSQL\16\bin\createdb.exe'
$env:PAH_DROPDB_BIN = 'C:\PostgreSQL\16\bin\dropdb.exe'
```

修改环境变量后必须重启 Admin API。不要把数据库密码写入命令、配置文件或日志；
`PAH_DB_PASSWORD` 只应由受控进程环境注入。

## 手工预检

可在启动 Admin API 的同一个 PowerShell 会话确认安装目录：

```powershell
& (Join-Path $env:PAH_POSTGRES_BIN 'psql.exe') --version
& (Join-Path $env:PAH_POSTGRES_BIN 'pg_dump.exe') --version
& (Join-Path $env:PAH_POSTGRES_BIN 'pg_restore.exe') --version
& (Join-Path $env:PAH_POSTGRES_BIN 'createdb.exe') --version
& (Join-Path $env:PAH_POSTGRES_BIN 'dropdb.exe') --version
```

五条命令的主版本必须相同，并与目标 PostgreSQL 服务端主版本一致。仅把 `psql`
加入 `PATH` 不足以通过可信备份门禁。

## 安全失败与复检

- 缺失工具时，接口只返回缺失的工具名和对应配置键，不返回安装目录、数据库口令、
  `ENOENT` 堆栈或完整子进程命令。
- `pg_dump`、备份目录校验、临时库创建、真实恢复或临时库清理失败时，只返回失败阶段
  和通用排查方向；无效备份会被删除。
- API 成功结果只报告 PostgreSQL 主版本和工具来源类型，不返回本机绝对路径。
- R14：移除或故意错配任一工具，确认在 `pg_dump` 前拒绝且错误脱敏；恢复配置后五件套
  均通过预检。
- R15：只对明确命名、可清理的隔离数据库执行可信备份，确认 `pg_dump --format=custom`、
  `pg_restore --list`、一次性数据库创建、真实恢复和清理全部成功。
- R07：空库初始化/启动属于 Host 基线验收，不得通过开启 `synchronize`、`initDB` 或
  `initMenu` 来绕过。可信备份环境继续要求 `PAH_DB_SYNCHRONIZE=false` 和
  `PAH_DB_INITIALIZE=false`。

生产环境禁止使用本地插件备份编排；正式发布仍需使用等价数据集、受控凭据、留存的
备份哈希和明确的恢复责任人。
