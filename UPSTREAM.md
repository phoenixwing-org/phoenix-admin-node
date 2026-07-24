# Phoenix Admin Node 上游维护

本仓库是 PhoenixWing 维护的 Cool Admin Midway 分叉，不是 Cool Admin 官方发行物。

## 远端与固定基线

- `origin`: `https://gitee.com/phoenixwing/phoenix-admin-node.git`
- `upstream`: `https://gitee.com/cool-team-official/cool-admin-midway.git`
- 上游分支：`8.x`
- 固定基线：`e545ef6f3b0c08581e34bd3207ca57d851ccc3ae`
- 基线标签：`vendor/cool-admin-midway/8.x-e545ef6`
- 上游旧 `master` 备份：`vendor/cool-admin-midway/master-b89eb06`

`upstream` 只允许拉取，不允许推送。

## Phoenix 分支

- `master`：稳定发行线及 Gitee 默认分支。
- `develop`：日常集成分支。
- `upstream-sync/YYYYMMDD-<sha>`：单次上游同步分支。
- `feature/*`：有边界的功能分支。

上游同步必须固定目标 SHA，在独立同步分支中保留合并历史，并与配套前端做精确版本兼容验证。不得使用网页同步功能直接覆盖 `master` 或 `develop`。
