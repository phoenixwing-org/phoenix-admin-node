# Phoenix Admin 业务插件安装阶段验收

## 归档范围

本记录归档 2026-08-05 在 Phoenix Admin 干净验证环境中完成的首轮业务插件安装、启停与
卸载闭环。它是阶段证据，不代表生产发布完成，也不替代正式部署编排。

基础环境与启动方式分别见：

- `docs/Phoenix Admin干净安装验收.md`
- `docs/Phoenix Admin本地双终端启动.md`
- `docs/Phoenix Admin动态插件热加载TODO.md`

## 冻结输入

| 项目 | 冻结值 |
| --- | --- |
| Node worktree | `/Users/kathy/phoenix/.worktrees/phoenix-admin-clean-validation/node` |
| Node 分支 | `codex/admin-clean-install-node` |
| Node 阶段提交 | `241bc53230efbc2288d843f2f40c65e435651150` |
| Vue worktree | `/Users/kathy/phoenix/.worktrees/phoenix-admin-clean-validation/vue` |
| Vue 分支 | `codex/admin-clean-install-vue` |
| Vue 阶段提交 | `bf6795fe207029b189ad0910361a184375e4cb10` |
| 数据库 | `phoenix_admin_clean_validation_20260805` |
| Admin API | `http://127.0.0.1:8201` |
| Admin Web | `http://127.0.0.1:9100` |
| 插件制品 | `phoenix-open-issue-0.6.2-admin.0.phoenix.cool` |
| 制品 SHA-256 | `82234976e7b4c54db6b2ec1ceb5e916fb9bb3d574b947a04ab406908de031744` |

制品后缀和管理入口以当前开发契约为准：

- 只接受 `.phoenix.cool`，不兼容旧 `.pah.cool`；
- 管理页为 `/phoenix/plugins`，不保留 `/pah/plugins`；
- 后端接口前缀为 `/admin/phoenix/plugin`，不保留 `/admin/pah/plugin`。

## 用户初步跑通结果

用户已在干净环境手工完成一轮插件安装、停用和卸载流程，并确认基础功能可以继续测试。
本轮覆盖的顺序为：

1. 选择不可变 `.phoenix.cool` 制品；
2. 校验 manifest、Node/Vue payload、migration checksum 并登记；
3. 重启 Admin API，检查 Node 运行制品已经加载；
4. 生成短时、一次性的 migration dry-run 计划；
5. 创建 PostgreSQL 备份并完成临时数据库真实恢复演练；
6. 执行受控事务安装；
7. 生成并确认产品字典计划；
8. 启用插件并物化菜单、权限、字典与运行贡献；
9. 停用插件并撤销运行贡献；
10. 再次创建可信备份后卸载，保留声明的业务数据。

Open Issue 启用后，业务 Ribbon、菜单和页面已可访问。卸载流程按 Host 契约保留业务表，
不把“卸载成功”解释为删除业务数据。

## 本轮自动化与运行证据

### Node

- 插件包本地装配定向测试：`6/6`；
- TypeScript `tsc --noEmit`：通过；
- API watch 在代码更新后输出 `Found 0 errors`，并完成新进程重启；
- 真实备份使用与 PostgreSQL 16 服务端匹配的客户端工具链；
- 真实备份及恢复演练制品：
  - backup ID：`pah-local-phoenix-open-issue-1785901580319-9e15fe7e-53d3-43d7-b370-f94753679292`
  - size：`229244` bytes
  - SHA-256：`55bef33faa5374323146f3f11f1a85c51dbe0e68a499f2b369307a737afa9dec`

### Vue

- 插件安装入口定向测试：`3/3`；
- `vue-tsc --noEmit`：通过；
- 浏览器已显示固定的第三至第十步；
- 当前插件处于已启用状态时，各禁用按钮给出明确原因：
  - 第三步：API 重启检查已经完成，无需重复执行；
  - 第四步：安装流程已经完成，无需重复生成计划；
  - 第五步：安装前可信备份已经完成，无需重复执行；
  - 第六步：受控安装已经完成，无需重复执行；
  - 第十步：先完成第九步停用插件。

最新的“已验证插件 → 第三步运行时检查 → 第四步解锁”已由单元测试和类型检查覆盖；仍应在
下一次全新制品安装时再做一次真实点击回归。

## 当前 Git 边界

Node worktree 仅保留运行装配生成的 `src/entities.ts` 未提交。该文件不是本轮人工源码提交，
不得混入功能或文档归档。Vue 阶段提交后工作树为 clean。

两个阶段分支均为本地分支，未 push。主开发 worktree 中其他任务的未提交文件不属于本轮，
未暂存、未 stash、未 restore、未格式化。

## 已知问题与后续工作

1. **仍是受控重启模式**：新 Controller、Service、Entity 和任务贡献不能在当前 Midway
   容器中真正热插拔。后续研究见动态插件热加载 TODO。
2. **重启尚需用户操作 Terminal**：第三步已经成为正式流程并有运行时检查，但还没有由
   Host supervisor 自动排空请求、重启和失败回滚。
3. **运行装配会更新生成文件**：本地开发装配会使 `src/entities.ts` 变脏。正式发布应在
   一次性 assembly 中生成和构建，不应污染长期源码 worktree。
4. **存在既有 `cl-svg` Vue warning**：浏览器新会话仍可看到 Host 的 `cl-svg` component
   resolve 警告。它与本轮插件安装步骤无直接关系，但不能把当前控制台记录宣称为 warn=0。
5. **最新增量未重跑完整 production build**：为保持 8201/9100 供用户继续测试，本轮第三步
   增量只执行定向测试、Node/Vue 类型检查和浏览器检查；完整 build 需要在停止 watch 服务后
   独立执行，避免 build 清理输出目录导致开发 API 中断。
6. **卸载后的完整恢复矩阵仍需加强**：后续应补齐“卸载后数据保留 → 同版本重装 → ledger
   不重复执行 → 菜单/权限恢复”的自动化回归，并覆盖失败恢复与过期计划。
7. **生产安装器仍需编排层**：当前本机安装模式用于干净环境验证。生产环境必须提供制品
   签名、可信备份证明、审批、不可变 assembly、滚动重启和自动回滚，不能直接复用本机开关。

## 下一轮最小复验

下一轮不需要重做全部页面功能，先完成以下安装器闭环：

1. 使用全新的干净数据库或已受控回收的验证数据库；
2. 选择同一 `.phoenix.cool`，完成第二步后确认第三步为唯一可继续动作；
3. 未重启 API 时第三步失败且第四步保持灰色；
4. 按双终端文档重启 API 后，第三步显示运行时版本和 pending migration 数；
5. 第四步解锁，后续按 4–10 顺序完成；
6. 卸载后核对业务表和 migration ledger 保留，再执行同版本重装；
7. 在停止 watch 服务后运行 Node/Vue production build；
8. 单独归档 `cl-svg` warning 和动态热加载研究结果。

