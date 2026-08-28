# Phoenix Host Pah 路径审计

审计日期：2026-08-28。

## 审计范围

本次只检查 Phoenix Admin Vue 与 Phoenix Admin Node：

- Git 跟踪文件名和实际磁盘目录；
- 页面路由、API prefix、动态 `viewPath` 与 TypeScript alias；
- 文档中描述当前状态或历史冻结状态的路径；
- `.runtime`、schema、数据库表、插件制品和浏览器状态中的稳定标识。

`Pah*` 文件名、类型名、组件名和函数名允许保留。它们表示 Phoenix Admin Host 的稳定内部
ABI，不属于物理目录回退。

## 当前物理目录

两仓当前都不存在以下源码目录：

- `src/pah/`；
- `src/modules/pah/`；
- `test/modules/pah/`。

Host 实现已经位于：

- Vue：`src/phoenix/`、`src/modules/phoenix/`；
- Node：`src/modules/phoenix/`、`test/modules/phoenix/`。

Node 工作区可能存在 ignored 的 `.runtime/pah-public-login-branding/`。这是登录首帧的原子快照
目录，不参与模块发现，也不是产品源码。

## 仍然执行的兼容入口

以下兼容面暂时保留：

| 范围 | 兼容入口 | 权威入口 | 原因 |
| --- | --- | --- | --- |
| Vue 编译 alias | `/@/pah/*`、`/$/pah/*` | `/@/phoenix/*`、`/$/phoenix/*` | 已发布插件编译兼容 |
| Vue 页面 | `/pah/identity`、`/pah/navigation` | `/phoenix/identity`、`/phoenix/navigation` | 已发布 Host 深链兼容 |
| Node API | `/admin/pah/identity/*`、`/admin/pah/navigation/*` | `/admin/phoenix/identity/*`、`/admin/phoenix/navigation/*` | 旧调用方兼容 Controller |

新代码、文档示例和菜单数据不得继续写入这些旧入口。

## 已退出兼容面的入口

- `/pah/plugins`；
- `/admin/pah/plugin/*`；
- `/pah/dictionary-maintenance`；
- `modules/pah/views/dictionary-maintenance.vue`。

字典旧路径由 Host schema v4 和维护中心 operation
`phoenix-dictionary-menu-route-v1` 等幂升级。Vue 不再运行时 redirect 或改写旧 `viewPath`。

## 永久或长期保留的稳定标识

以下标识不是物理目录，不能机械替换：

- `Pah*`、`PAH_*`、`VITE_PAH_*`；
- `pah_*` 数据库表、索引和 ledger；
- `pah-business-module`；
- `pah-plugin.artifacts.json`；
- `pah-group-*` assignment key 和既有权限 key；
- `__PAH_PUBLIC_LOGIN_BRANDING__` 与已发布浏览器 storage key；
- schema 中的 `schemaId=pah-host` 和已经发布的 migration ID。

这些标识连接旧插件包、数据库、备份恢复、环境配置或浏览器状态。若要改名，必须进入独立 major
兼容计划，不能混入目录或页面清理。

## 历史冻结路径

`src/modules/phoenix/host-baseline/host-baseline.json` 的 `sourceFiles` 仍包含旧
`src/modules/pah/...`。该清单校验历史冻结 commit 的源文件 SHA，不能改成当前路径；修改会破坏
证据而不是完成迁移。

迁移前评估文档也可以保留旧路径，但必须在开头明确标记为历史证据，并链接当前实施说明。

## 后续退出兼容窗口

Identity 与 Navigation 的旧页面/API 兼容不能与本次字典迁移一起机械删除。后续独立窗口需要：

1. 扫描 Admin、Dev Hub 与所有已发布插件包，不再存在旧调用；
2. 对旧入口增加调用计数或弃用日志，观察稳定测试和生产日志；
3. 提供菜单/配置等幂迁移 operation；
4. 先删除消费者调用，再删除 Vue redirect 和 Node 兼容 Controller；
5. 验证旧入口明确 404、新入口权限与业务结果不变。
