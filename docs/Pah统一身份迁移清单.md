# Phoenix Admin 统一登录能力迁移清单

- 状态：首期 Node 最小飞书登录已实现；尚未执行生产 DDL 或 Admin Vue/真实飞书点检
- 设计真源：[Pah 统一身份契约.md](Pah统一身份契约.md)
- Legacy 金样本：`phoenix-open-issue@bca79cc62a9989b7e7544ab96b6291271722fd64`

迁移实施遵循仓库 `phoenix-ai-workspaces` 中的
`plugin-migration/skills/migrate-phoenix-admin-plugin/SKILL.md`；本文只保存 Host
公开契约和本能力清单，不复制公共迁移方法。

## 已完成调查

- [x] 冻结 legacy 飞书二期实现基线
      `a7c7b6d8db9d519c0564fdc2bc436b7bd533d180`。
- [x] 冻结 2026-07-21 用户 TC-01 ～ TC-10 全通过证据
      `6bf0804ce3adcd4cf09662f9edbcb0e81fa71868`。
- [x] 只读确认当前 Admin Node/Vue 没有飞书 provider、OAuth 接口、外部身份表或设置页。
- [x] 确认 Cool App 端微信/手机号接口使用 `user_info`，不能冒充 Admin Console
      `base_sys_user` 登录能力。
- [x] 冻结所有权：Host/Cool/Pah 拥有身份和会话，插件只消费 actor，Wing 不参与。

## P0：安全与产品决策

- [x] 冻结首发方式为 `password + feishu`；微信和手机号延期。
- [x] 首期只读策略固定 password 始终启用/default，不提供关闭密码 API。
- [ ] 确认飞书应用、租户白名单和回调 URL 的开发、测试、生产配置责任人。
- [x] 首期 secret 只来自环境变量；App Secret 不进入数据库、前端、日志、备份或 Git。
- [x] 冻结 OAuth、待审查、绑定/拒绝/解绑和固定错误码命名空间。

完成门禁：形成产品决策记录，且安全负责人确认不会把所有管理员锁在系统外。

## P1：Host Identity 领域与 DDL

- [x] 新建通用外部身份模型和首个飞书 adapter，无产品 ID 特例。
- [x] 新建 `pah_external_identity`、`pah_external_bind_request`、
      `pah_oauth_login_attempt`、`pah_oauth_login_ticket` 实体与 `0003` migration。
- [x] OAuth attempt/ticket 只保存 SHA-256、短 TTL，并以 PostgreSQL 行锁单次消费。
- [x] 数据外键统一指向 `base_sys_user.id`，不复用 `user_info`。
- [x] 添加唯一约束、状态约束、敏感字段排除和 user disabled/role 检查。
- [x] PostgreSQL 16 隔离库完成部分失败恢复、连续两次重放、约束验证和 schema-only
      恢复演练；权威开发库保持只读且新表为 0。
- [ ] 生产发布窗口完成完整可信备份、实际恢复演练、受控执行和 ledger 证明。
- [ ] production `synchronize=false`；页面和普通 API 不执行 DDL。

完成门禁：表、索引、约束、回滚和恢复证据全部可重复，生产包不含 secret。

## P2：飞书首个 Provider

- [x] 从 legacy 金样本迁移授权 URL、换票、用户信息、租户白名单和错误语义。
- [x] 实现只读 login-policy、飞书 OAuth start/callback 和一次性 ticket exchange。
- [x] 未绑定身份进入待审查；禁止自动按用户名、姓名、邮箱认领。
- [x] 实现管理员绑定已有用户、拒绝和解除绑定；自动建用户延期。
- [x] access/refresh token 只在一次调用链内存活，不持久化。
- [ ] 恢复 legacy TC-01 ～ TC-10 自动化与真实飞书点检。

完成门禁：真实飞书登录通过，同一 subject 不能绑定两个用户，解绑后重新待审查。

## P3：手机号与微信 Adapter

首期明确延期，不计入飞书登录交付门禁。

- [ ] 手机号 challenge 使用独立 service，复用 Host 限流/审计，不直接调用 App 登录接口。
- [ ] 手机号必须显式绑定 `base_sys_user`；禁止验证码成功后自动认领同号用户。
- [ ] 微信 provider 按 P0 冻结的具体场景实现，不混用小程序/公众号/App 身份字段。
- [ ] 微信身份同样进入外部身份和待审查，不单独签发 JWT。
- [ ] 三种 provider 与一般登录最终统一走角色、部门、禁用状态和 Host JWT 签发。

完成门禁：四种 method 的身份主体、错误语义、审计和会话结果一致。

## P4：登录策略 API 与 Admin Vue

- [x] 保持 `POST /admin/base/open/login` 兼容且始终可用。
- [x] 实现公开 `GET /admin/base/open/login-policy`，响应不含 secret。
- [x] 实现飞书 OAuth、ticket 公开接口、单进程限流和固定错误码。
- [x] Base 请求日志精确脱敏密码、验证码、OAuth state/code、ticket 和 refresh token。
- [ ] 多实例部署前把限流窗口接到共享缓存；当前固定窗口适用于单实例 Host。
- [ ] 登录页按策略动态渲染一般、手机号、微信、飞书入口。
- [ ] “管理 → 系统设置 → 登录方式”实现多选启用与默认方式。
- [ ] 用户/组织管理实现待审查、绑定、拒绝、解绑。
- [ ] 提供“我的登录方式”只读/解绑入口，不恢复 legacy 自助绑定。

完成门禁：所有策略组合有浏览器证据；无 provider 故障会破坏其他登录方式。

## P5：Legacy 身份映射（独立可选阶段）

- [ ] 只读导出 legacy external identities，不导出授权码或 OAuth Token。
- [ ] 生成 legacy user → `base_sys_user.id` 显式映射计划和 fingerprint。
- [ ] 管理员逐项确认；缺失、冲突、重复 subject、租户变化全部阻断。
- [ ] 受控导入前完成 Host 可信备份和恢复演练。
- [ ] 单事务导入身份与审计 ledger；重放同 fingerprint 为 no-op。
- [ ] 不导入 users、密码、角色、权限、JWT、attempt 或 ticket。

完成门禁：迁移前后黄金身份可登录，未映射身份进入待审查，旧系统可回退。

## P6：统一验收与发布

- [ ] 实际 Host Node 的公开接口与管理权限 200/401/403 全部通过。
- [x] Node 22 隔离 Host 的类型、lint、10 suites/77 tests、production build 和 dist SHA 通过。
- [x] PostgreSQL 真实服务链通过 pending→ 绑定 →ticket→Admin 会话 → 解绑，并清理为 0。
- [ ] 解决/确认正式 Host bootstrap 的中间件装配后，完成实际 HTTP 200/401/403 链。
- [ ] Admin Vue 类型、单测、生产 build 与 1440/720、light/dark 浏览器矩阵通过。
- [ ] 密码 + 飞书的启用、配置不全、Provider 故障和故障回退全部通过。
- [ ] 日志、Output、响应、数据库、备份和 production pack 敏感信息扫描为零。
- [ ] 先在隔离 Host/数据库验证，再进入开发环境；不得覆盖当前 Issue/Function 任务现场。
- [ ] 更新 Open Issue 帮助文本：只有 Host 能力真实接通后才显示飞书/登录方式说明。
- [ ] 形成中文本地阶段提交；未获授权不 push、不发布、不打 tag。

## 明确不做

- 不把 legacy 登录代码放回 Open Issue 插件。
- 不从 Issue maintenance 复用权限执行 Host 身份管理。
- 不把 Cool App 的微信、手机号用户静默转换为 Admin 用户。
- 不自动按用户名、姓名、邮箱或手机号绑定旧身份。
- 不保存 OAuth access/refresh token。
- 不在 Phoenix Wing 增加登录 provider 或会话逻辑。
