# Phoenix Admin 统一登录与外部身份契约

- 状态：首期 Node 最小飞书登录已实现；生产 DDL、Admin Vue 与真实飞书点检待统一窗口
- 更新：2026-08-04

## 0. 首期实施决定

本轮只交付 Admin Console 的 `password + feishu`：保留现有账号密码登录，新增飞书
OAuth、通用外部身份映射、管理员待审查绑定和一次性登录票据。手机号、微信、登录方式
设置页、自助绑定、自动建用户和 legacy 身份导入全部延期，不阻塞飞书首期。

首期固定边界：

- 飞书身份只映射 `base_sys_user.id`，最后仍由现有 Admin 登录服务校验用户状态、角色、
  部门和权限并签发 JWT。
- 未绑定飞书身份只进入待审查，不按姓名、邮箱、手机号或用户名自动认领。
- `state` 和 ticket 只保存 SHA-256，数据库、响应和日志都不保存飞书 access/refresh
  token；access token 只在换票和读取身份的单次调用链内存活。
- 飞书未启用、配置不全、回调地址不合法、租户不在白名单时 fail-closed；密码登录始终
  保持启用和默认，首期没有关闭密码的 API。
- Host 只提供通用身份表和接口，不写 Open Issue、Function、BOM 等产品 ID 特例。

首期运行配置：

| 环境变量                         | 必填条件 | 含义                                           |
| -------------------------------- | -------- | ---------------------------------------------- |
| `PAH_FEISHU_LOGIN_ENABLED`       | 是       | 只有逐字 `true` 才尝试启用飞书                 |
| `PAH_FEISHU_APP_ID`              | 启用时   | 飞书应用 App ID                                |
| `PAH_FEISHU_APP_SECRET`          | 启用时   | 飞书应用 App Secret，仅服务端环境变量          |
| `PAH_FEISHU_REDIRECT_URI`        | 启用时   | 必须精确指向 Host 的飞书 callback              |
| `PAH_FEISHU_ALLOWED_TENANT_KEYS` | 启用时   | 逗号分隔的允许租户，首期不允许空白名单         |
| `PAH_FEISHU_SCOPES`              | 否       | 逗号分隔的额外 scope                           |
| `PAH_ADMIN_WEB_ORIGIN`           | 是       | Admin Vue origin，例如 `http://127.0.0.1:9000` |
| `PAH_OAUTH_STATE_TTL_SECONDS`    | 否       | state 有效期，默认 600 秒                      |
| `PAH_OAUTH_TICKET_TTL_SECONDS`   | 否       | 一次性票据有效期，默认 120 秒                  |

生产启用前，飞书开放平台登记的重定向地址必须与
`PAH_FEISHU_REDIRECT_URI` 逐字一致，路径固定为
`/admin/base/open/oauth/feishu/callback`。官方 authorization/token/user-info URL 已有安全
默认值；只有隔离测试环境才应使用对应的 override 环境变量。

所有 URL 只允许 HTTPS；本机开发例外允许 `localhost`、`127.0.0.1` 或 `::1` 的 HTTP。
redirect URI 不允许 query、fragment 或 URL 内嵌用户名密码；Admin Web origin 必须是纯 origin，
不能包含 path、query、fragment 或 URL 内嵌用户名密码。

## 1. 结论与文档归属

统一登录、外部身份、登录方式策略和待审查绑定属于 Phoenix Admin Host 的
`identity` 公共能力，不属于 Open Issue、Function、BOM 等业务插件，也不属于
Phoenix Wing。本文作为 Node 端权威契约放在 `phoenix-admin-node/docs`；Admin Vue
只消费本文定义的公开接口和状态，不另建一份不同的协议真源。

Open Issue 插件可以在 manifest 中声明 `hostReuse: ["identity"]`，但声明不等于
Host 已实现能力。Host 接口、数据模型、权限和审计未通过本文门禁前，插件不得继续
签发独立 JWT，也不得把旧版飞书表复制进插件数据库。

## 2. 已验证金样本与当前差距

### 2.1 Legacy 金样本

旧版仓库 `phoenix-open-issue` 的飞书登录已经过真实用户点检，可作为行为金样本：

| 类型                 | 精确 commit                                | 证据                                         |
| -------------------- | ------------------------------------------ | -------------------------------------------- |
| 当前 legacy 冻结源码 | `bca79cc62a9989b7e7544ab96b6291271722fd64` | 包含飞书 OAuth、管理员绑定、待审查和登录策略 |
| 飞书二期发布基线     | `a7c7b6d8db9d519c0564fdc2bc436b7bd533d180` | 版本 `0.5.0`，收录管理员绑定与待审查         |
| 用户点检证据         | `6bf0804ce3adcd4cf09662f9edbcb0e81fa71868` | 2026-07-21，TC-01 ～ TC-10 全部通过          |

需要迁移的已验证语义：

- 登录页按服务端策略显示或隐藏飞书入口。
- OAuth 使用单次 `state`；授权码只在服务端换票。
- 以 `provider + providerSubject` 精确识别身份；飞书 subject 为
  `tenant_key:open_id`。
- 未绑定身份进入待审查，不自动按姓名或邮箱认领本地用户。
- 仅管理员可绑定已有用户、创建用户并绑定、拒绝申请或解除绑定。
- 不保存飞书 access token / refresh token。
- 租户白名单、取消授权、提供方故障和解绑后再登录均 fail-closed。
- 本地登录与第三方登录可同时开启，且不能把所有登录方式全部关闭。

Legacy 的接口、SQLite 表名和自有 JWT 只作行为参考，不直接复制到 Host。

### 2.2 当前 Phoenix Admin

实施前 Node 基线 `958d98321d0d96c3e5dd3fc9b7c2bfdae5f2c064` 只有 Admin
用户名、密码、图片验证码和刷新 Token：

- `POST /admin/base/open/login`
- `GET /admin/base/open/captcha`
- `GET /admin/base/open/refreshToken`

Cool `user` App 模块另有手机号、微信小程序、公众号和微信 App 登录，但它们面向
`user_info` / `user_wx`，不是 Admin Console 的 `base_sys_user`。不得把这些接口存在
误报为后台已经支持微信或手机号登录；可以复用 provider 思路，不能复用错误的用户域。

该基线没有飞书 provider、OAuth 路由、外部身份表或登录方式管理界面。首期 Node
实现以本文第 0 节为准；Admin Vue 仍待独立任务接入。

## 3. 所有权与边界

| 层               | 所有能力                                                        | 禁止                                      |
| ---------------- | --------------------------------------------------------------- | ----------------------------------------- |
| Cool Base        | `base_sys_user`、角色、部门、现有密码登录和 JWT 基座            | 让业务插件直接写系统用户、角色或会话      |
| Pah Identity     | 登录策略、provider 编排、外部身份、待审查、一次性票据、登录审计 | 写任一产品 ID 特例；保存 OAuth 长期令牌   |
| Admin Vue        | 动态登录入口、系统登录方式设置、待审查与绑定 UI                 | 包含 App Secret；在前端决定身份绑定       |
| Provider adapter | 飞书、微信、手机号的协议转换和配置就绪检查                      | 签发 Host JWT；自动认领本地账号           |
| 业务插件         | 声明 `hostReuse: identity`，消费 Host actor                     | 自建登录页、用户表、JWT 或 OAuth callback |
| Phoenix Wing     | 通用布局和控件                                                  | 登录策略、provider、用户或会话逻辑        |

## 4. 登录方式策略

首期登录方式采用“只读启用集合 + 固定默认方式”，不提供互斥配置：

| method ID  | 显示名称 | 首期范围                   | 身份主体                       |
| ---------- | -------- | -------------------------- | ------------------------------ |
| `password` | 一般登录 | 用户名 + 密码 + 图片验证码 | `base_sys_user`                |
| `feishu`   | 飞书登录 | 网页 OAuth + 租户白名单    | 外部身份映射到 `base_sys_user` |

策略公开模型建议为：

```json
{
  "formatVersion": 1,
  "scope": "admin-console",
  "enabledMethods": ["password", "feishu"],
  "defaultMethod": "password",
  "methods": [
    { "id": "password", "ready": true, "label": "账号密码" },
    { "id": "feishu", "ready": true, "label": "飞书" }
  ]
}
```

规则：

1. `enabledMethods` 至少包含一个真正 `ready` 的方式；未配置凭据的 provider 不能启用。
2. `defaultMethod` 必须位于 `enabledMethods`。
3. 公开响应只含展示所需状态，不包含 App Secret、内部路径、完整错误体或租户秘密。
4. 非密码登录也必须经过用户状态、角色、部门、禁用状态和会话版本校验，再由 Host
   统一签发 JWT。
5. 首期没有修改策略的接口，`password` 始终启用且为默认方式。未来允许关闭密码前必须
   提供独立、受审计且不由普通页面暴露的紧急恢复入口。
6. 登录策略作用域固定为 `admin-console`。App 端 `user_info` 登录策略若需要统一，另立
   scope 和迁移，不隐式共享账号。

非敏感策略可以进入 Host 数据库；provider secret 只能来自环境变量或未来的 Host
secret provider。设置页面只能显示“已配置/未配置”，不能读回 secret。

## 5. 公共接口候选

保持现有密码接口兼容，由 Base Open Controller 作为薄入口调用 Pah Identity 服务。

### 5.1 未登录公开接口

| Method | URL                                      | 用途                                     |
| ------ | ---------------------------------------- | ---------------------------------------- |
| `GET`  | `/admin/base/open/login-policy`          | 返回可公开的登录方式和就绪状态           |
| `POST` | `/admin/base/open/login`                 | 现有一般登录，策略关闭时明确拒绝         |
| `GET`  | `/admin/base/open/oauth/feishu/start`    | 创建单次飞书 OAuth 流程                  |
| `GET`  | `/admin/base/open/oauth/feishu/callback` | 飞书回调，只重定向一次性票据或待审查状态 |
| `POST` | `/admin/base/open/oauth/exchange-ticket` | 一次性票据换 Host JWT                    |

所有公开接口必须有速率限制、固定错误码和安全日志；callback URL 必须逐字匹配配置。
公开 flow 错误使用统一结构：

```json
{
  "code": 1001,
  "message": "飞书登录配置不完整",
  "data": { "error": "provider_misconfigured" }
}
```

callback 无论成功、待审查或失败都重定向到 Admin Web `/oauth/callback`。成功只携带短 TTL
一次性 ticket；前端必须立即调用 exchange-ticket，且不得把 ticket 当长期会话保存。`state`、
OAuth code、ticket、验证码、密码和 refresh token 在 Base 请求日志中均被精确脱敏。

### 5.2 管理接口

| Method | URL                                            | 用途                   |
| ------ | ---------------------------------------------- | ---------------------- |
| `GET`  | `/admin/pah/identity/bind-request/list`        | 查询待审查记录         |
| `POST` | `/admin/pah/identity/bind-request/bind`        | 绑定已有后台用户       |
| `POST` | `/admin/pah/identity/bind-request/reject`      | 拒绝绑定申请           |
| `GET`  | `/admin/pah/identity/external-identity/list`   | 查询用户外部身份       |
| `POST` | `/admin/pah/identity/external-identity/unlink` | 管理员解除外部身份绑定 |

普通用户若需要查看或解除自己的身份，另提供 `self` 资源接口；不得允许自助绑定未审查
provider，也不得复用管理员 capability。

## 6. 首期数据模型

Phoenix 新表遵循 `pah_` 命名，外键主体始终是 `base_sys_user.id`：

| 表                          | 长期保存 | 用途                                          |
| --------------------------- | -------- | --------------------------------------------- |
| `pah_external_identity`     | 是       | `provider + providerSubject` 唯一映射系统用户 |
| `pah_external_bind_request` | 是       | 未绑定身份的待审查快照、状态和处理人          |
| `pah_oauth_login_attempt`   | 否       | 短 TTL、单次消费的 state 哈希                 |
| `pah_oauth_login_ticket`    | 否       | 短 TTL、单次消费的登录票据哈希                |

登录策略表和独立登录审计表不进入首期；启用状态来自环境变量，管理员绑定/拒绝/解绑请求继续
由现有 Host 请求日志审计。后续若增加可写策略或多 Provider，再以新 migration 增量进入。

约束至少包括：

- `(provider, provider_subject)` 唯一；一个外部身份不能绑定两个系统用户。
- active identity 的 provider metadata 只保存必要快照，不保存 access/refresh token。
- 手机号先经过规范化并显式绑定；禁止仅凭收到验证码就自动认领同号系统用户。
- 待审查重复登录更新 `lastSeenAt`，不无限新增 pending 行。
- 禁用或删除系统用户时，外部身份不能绕过用户状态登录。
- DDL 走 Pah migration、可信备份和 PostgreSQL 恢复演练；禁止页面按钮执行 DDL，
  禁止生产 `synchronize`。

## 7. Provider 扩展契约

provider adapter 至少实现：

```ts
interface PahIdentityProvider {
  readonly id: 'feishu';
  publicInfo(): {
    id: string;
    label: string;
    ready: boolean;
    reasonCode?: string;
  };
  createAuthorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<{ accessToken: string }>;
  readIdentity(accessToken: string): Promise<{
    providerSubject: string;
    displayName?: string;
    email?: string;
    metadata?: Record<string, unknown>;
  }>;
}
```

`accessToken` 只在单次服务端调用链内存活，不进入数据库、日志、响应、审计或备份。
首期只有飞书 adapter，不引入动态 Provider registry；数据模型仍使用稳定 `provider` 字段，
后续可以增量增加新 adapter。Host 不允许出现 Open Issue 等产品映射。

飞书作为首个 provider 迁移；微信必须先冻结网页 Admin Console 的具体 OAuth 类型，不能把
现有小程序、公众号和 App 三个入口模糊合并。手机号不是 OAuth provider，应由独立的
验证码 challenge adapter 实现，但最终仍进入同一 Host 会话签发和审计流程。

## 8. Admin Vue 扩展

### 登录页

- 首次加载 `GET /admin/base/open/login-policy`，按服务端顺序渲染已启用且 ready 的方式。
- 一般登录保留现有用户名、密码和验证码表单。
- 飞书按钮请求 `GET /admin/base/open/oauth/feishu/start?returnTo=...`，随后将浏览器导航到
  响应 `authorizationUrl`；手机号和微信不在首期 Admin Console 范围。
- OAuth callback 只处理一次性票据、待审查或公开错误码，不接收长期 Token。
- callback 收到 `status=authenticated` 时立即 `POST /oauth/exchange-ticket`，复用现有登录成功
  后的 token/refreshToken 写入和首页跳转；`status=pending` 显示申请编号与等待管理员处理提示。
- callback 只能使用服务端返回的已规范化 `returnTo`；不得接受外站 URL，也不得把 OAuth code、
  飞书 access token 或 App Secret 写入 Pinia、localStorage、日志或埋点。
- 某 provider 故障不能破坏其他登录方式；策略无可用方式时显示明确维护状态。

### 系统设置

建议放在“管理 → 系统设置 → 登录方式”，而不是 Open Issue 设置：

- 多选启用方式、选择默认方式、显示 provider 配置就绪状态。
- 保存前服务端再次校验至少一个 ready 方式与 break-glass 门禁。
- 待审查处理放在 Host 用户/组织管理，复用 `base_sys_user`、部门和角色选择器。
- 普通用户的“我的登录方式”只显示已绑定身份和允许的解绑动作。

## 9. Legacy 数据迁移边界

本阶段首先迁移能力，不自动搬运 legacy 账号：

- 禁止导入旧 users、密码哈希、角色、权限或旧 JWT。
- 禁止按 username、姓名、邮箱或手机号自动认领系统用户。
- 如需迁移已绑定飞书身份，先离线生成只读映射计划：legacy user →
  `base_sys_user.id`，由管理员逐项确认后受控导入。
- 冲突、缺失用户、重复 subject 或租户变化必须 fail-closed 并形成报告。
- OAuth attempt/ticket 不迁移；access/refresh token 永不迁移。
- 能力切换前旧系统仍是唯一登录真源；切换窗口必须可回退到一般登录。

## 10. 验收门禁

除单元、类型和生产构建外，至少恢复 legacy 已通过的 TC-01 ～ TC-10，并增加：

1. 密码登录保持兼容；飞书关闭、配置不全、租户非法和 provider 故障均不能影响密码登录。
2. 管理员 200、匿名 401、无 capability 403、授权非 root 200；root 旁路单列。
3. OAuth state 单次消费、ticket 单次消费、超时、取消、错误码、租户拒绝和回调 URL 校验。
4. 未绑定进入待审查；绑定已有、新建并绑定、拒绝、解绑后再登录；不得自动认领。
5. provider 故障不影响其他启用方式；关闭密码前 break-glass 恢复演练通过。
6. 数据库、日志、Output、响应、生产包和备份均不含 App Secret、授权码或 OAuth Token。
7. 1440/720、light/dark、冷刷新、回退和控制台无 Vue/Router/Pinia/Unhandled 错误。

达到这些门禁前，`hostReuse: identity` 只能报告为“需求已声明”，不能报告为“已接通”。

## 11. 本轮 Node 验证边界

- Node 22.23.1 隔离 Host 已通过 `lint + 10 suites / 77 tests + production build`；生成实体清单
  不含产品模块，dist 的 `0003` 与源码逐字 SHA-256 一致。
- PostgreSQL 16.10 隔离库已验证部分失败恢复、连续两次重放、4 表/11 索引/7 外键/2 状态
  约束、敏感 token 列为 0；事务合成约束数据全部回滚。schema-only 基线已实际恢复到第二库，
  权威开发库始终只读且四张新表为 0。
- TypeORM 真实 PostgreSQL 服务链已验证 state 单次、pending、管理员绑定、ticket 单次、Admin
  会话交接、解绑回 pending；合成用户与身份行均已精确清理为 0。
- 独立 HTTP harness 被现有 Host `bootstrap.js` 的 `BaseTranslateMiddleware is not valid in
current context` 阻断；这是运行装配阻断，不是飞书 Provider 或 DDL 失败。合入后必须在实际
  Host 启动链完成公开接口 200/4xx、管理接口 200/401/403 和真实飞书浏览器点检，才能把
  `hostReuse: identity` 报告为已接通。
