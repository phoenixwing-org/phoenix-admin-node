# Phoenix Admin Node H1 基线

日期：2026-07-24

## 固定输入

- Cool Admin Midway：`8.x` / `e545ef6f3b0c08581e34bd3207ca57d851ccc3ae`
- LICENSE SHA-256：`b4714a1ae13a8f448c4805a027f590ceb34946b1e6b3a381883ca4c720a56d51`
- Node.js：`v23.7.0`（后续 CI 还需覆盖目标 LTS Node 20）
- pnpm：`10.15.1`

## 结果

- 上游未提交锁文件；Phoenix H1 首次生成并跟踪 `pnpm-lock.yaml`。
- `pnpm run build`：通过。
- 上游没有 Jest 测试文件；`pnpm run test:ci` 使用 `--passWithNoTests` 明确记录这一事实。
- 首次 lint 发现 3 个格式问题和 1 个无效自赋值；H1 仅做等价整理后纳入 `verify`。

运行 `pnpm run verify` 可重复执行 lint、Jest 基线和生产构建。
