# Pah 命名规范

`Pah` 表示 Phoenix Admin Host。新增宿主代码统一使用这一前缀，不再引入 `Pan` 或 `Pav`；`Pnw` 只属于 Phoenix Wing 的公开 API。

## 源码

- TypeScript 类、实体、服务、控制器和类型文件保留相同大小写的 `Pah`，例如 `PahModuleManifest.ts`、`PahAuditService.ts`、`PahCapability`。
- Host 专属模块集中在 `src/modules/phoenix/`；`Pah*` 类型名和稳定 ABI 不随目录迁移改名。
- 标准仓库治理文件仍使用生态约定名称：`README.md`、`LICENSE`、`NOTICE`、`UPSTREAM.md`、`LICENSING.md`，不加 `Pah` 前缀。
- 上游文件和第三方符号不做机械重命名。

## 持久化标识

- 新增数据库表使用 `pah_` 前缀，例如 `pah_shell_preference`。
- 数据库列、索引、迁移标识和配置键不得使用连字符形式 `pnw-`。
- Ribbon 首期复用 `base_sys_menu` 的层级与排序，不新建分组表。
- 只有真实存在跨模块持久化、用户定制或独立生命周期需求时才增加 `pah_` sidecar 表。
