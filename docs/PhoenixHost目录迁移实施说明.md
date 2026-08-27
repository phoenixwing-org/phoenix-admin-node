# Phoenix Host 目录迁移实施说明

## 目的与边界

本次迁移只把 Phoenix Admin Host 的**物理目录与新的内部调用路径**从 `pah` 统一为
`phoenix`。它不改变已发布插件包、数据库和运维配置的稳定标识。

- Node：`src/modules/pah` → `src/modules/phoenix`
- Vue：`src/pah` → `src/phoenix`，`src/modules/pah` → `src/modules/phoenix`
- 新内部调用统一使用 `/@/phoenix`、`/$/phoenix`、`/phoenix/*` 与
  `/admin/phoenix/*`。

本迁移不会重命名 `Pah*` 类型、`PAH_*` 环境变量、`pah_*` 表、`pah.*` 浏览器偏好、
`pah-business-module`、`pah-plugin.artifacts.json`、`pah-group-*` 或既有权限 key。
这些都是持久化或插件 ABI，不是目录重命名的目标。

## 对外兼容

| 类别 | 新规范入口 | 旧入口处理 |
| --- | --- | --- |
| Vue Host adapter import | `/@/phoenix/*`、`/$/phoenix/*` | `/@/pah/*`、`/$/pah/*` 保持 Vite alias 兼容 |
| 身份审查 API | `/admin/phoenix/identity/*` | `/admin/pah/identity/*` 转发到同一 service |
| 导航 API | `/admin/phoenix/navigation/*` | `/admin/pah/navigation/*` 转发到同一 service |
| Host 页面 | `/phoenix/identity`、`/phoenix/navigation`、`/phoenix/dictionary-maintenance` | 对应 `/pah/*` 深链在 Router 中 redirect；`/pah/plugins` 不重新开放 |
| 插件管理 | `/phoenix/plugins`、`/admin/phoenix/plugin/*` | 没有 `/pah/plugins` 或 `/admin/pah/plugin/*` 兼容入口 |

兼容层只用于已发布 Host 页面和插件；新开发不得继续新增 `pah` 路径调用。

## Node 路由约束

Cool 会受物理目录影响推导控制器路由。因此 Phoenix Host 的 Identity 与 Navigation
控制器必须始终写明 `/admin/phoenix/...` prefix；旧 `pah` 控制器仅为轻量转发层，不能复制
业务状态、实体或权限判断。

Host baseline 的 `sourceFiles` 中保留旧 `src/modules/pah/...` 路径，是因为它校验的是一个
历史冻结 Git commit，而不是当前工作树路径。当前 baseline loader 和构建 assets 则使用新的
`src/modules/phoenix/...` 目录。

## 业务插件适配清单

Open Issue、Function、Branding 等业务插件只需在下一个各自维护窗口内完成：

1. 将新的 Host 内部 import 改为 `/@/phoenix/*` 或 `/$/phoenix/*`。
2. 将新的 Identity/Navigation 调用改到 `/admin/phoenix/identity/*`、
   `/admin/phoenix/navigation/*`，页面深链改为 `/phoenix/*`。
3. 用旧已发布插件包验证兼容 alias；不要只因为本次目录迁移重新打包。

业务插件不得改变其 `moduleId`、API 前缀、表名、migration、权限、`pah-business-module`、
`pah-plugin.artifacts.json` 或 `pah-group-*`。这些不属于 Host 目录迁移。

## 验收与回滚

- Node：类型检查、Host baseline 来源校验、production build、新旧 Identity 权限门禁。
- Vue：类型检查、production build、`/@/pah` 与 `/$/pah` alias、旧页面深链 redirect。
- 跨产品：至少以 Branding 和带实体/DDL 的业务插件分别验证挂载、停用、卸载与纯 Host 回退。

目录迁移不写数据库、不变更插件包格式。若出现模块发现、路由或构建资产异常，回滚这次目录迁移
提交即可；不要删除稳定 `pah` ABI。
