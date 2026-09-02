# Phoenix 插件统一巡检与维护设计

状态：第一阶段已实施；统一 CLI 与聚合接口待完成
日期：2026-08-30

## 1. 结论

Phoenix Admin 可以把“新开发挂载初始化”和“已安装插件维护”合并为一套插件巡检能力。
两类插件的检测证据基本相同，差别只在于源码来源、可信收据和允许执行的下一步动作。

推荐继续以 `/phoenix/plugins` 作为统一入口，不再增加第二个长期页面。用户验收后冻结为两个可折叠
Block，避免把“源码已挂载”和“插件已安装”混成同一动作：

1. **开发挂载**：显示源码身份、双端 symlink、同版本保留包、就绪状态、精确 Terminal 目录与命令；
2. **Phoenix 插件中心**：显示权威登记、迁移、字典、贡献、启停和卸载状态。

两个 Block 按同一 `moduleId` 关联，但开发挂载优先提供运行源码，插件中心只管理贡献与生命周期，不覆盖
开发 symlink。每个插件的详情继续按以下子 Block 显示：

1. 来源与身份；
2. 安全与完整性；
3. 数据库迁移；
4. 字典治理；
5. 菜单、Ribbon、路由与权限贡献；
6. 运行制品、依赖与重启；
7. 停用、卸载与残留清理。

Hub 仍只负责 Node/Vue 源码装配和受控服务重启。Pah Node 是验包、插件台账、DDL、
字典、贡献和卸载的唯一权威；Vue 只展示服务端结论并触发固定生命周期动作。Host 的
`/phoenix/maintenance` 继续处理编译进 Host 的固定、等幂维护项，不接收插件 SQL 或运行时代码。

当前已有实现可以作为第一阶段基线：

- `GET /admin/phoenix/plugin/development-status` 已能检查双端开发挂载、安装状态、迁移 ledger、
  菜单贡献、分组 assignment、当前角色权限和启动快照；
- `/phoenix/plugins` 已能对开发挂载执行“仅检测、选择不可变包、受控安装、启用、重物化、
  提示 Hub 重启”；
- 已安装插件卡片已支持停用、启用和保留数据卸载；
- 启动健康检查能够隔离不可信插件，使单个插件失败不拖垮 Host。

缺口是上述证据尚未聚合成覆盖所有来源的统一巡检结果，也未完整报告“已卸载但 Ribbon/菜单/
运行 payload 残留”等反向生命周期状态。

## 2. 不把“发现、安装、启用”混为一个状态

统一巡检必须同时保留四个正交维度，不能用一个 `installed=true` 代替：

| 维度 | 典型值 | 权威来源 |
| --- | --- | --- |
| 发现来源 | `development-mount`、`managed-payload`、`ledger-only`、`missing` | Host 文件系统与激活收据 |
| 生命周期 | 未登记、已验证、已安装、已启用、已停用、已卸载、失败 | `pah_plugin_installation` |
| 运行状态 | 未加载、待重启、已就绪、版本不一致、已隔离 | 启动健康快照与活动收据 |
| 贡献状态 | 未物化、完整、权限过滤、陈旧残留、孤儿 | contribution、Cool 菜单、assignment 与当前权限 |

因此：

- “Hub 已挂载”只证明源码目录存在，不证明插件已登记或数据库已初始化；
- “已安装”不证明当前进程加载了同版本 Node/Vue payload；
- “已启用”不证明菜单、Ribbon 和字典已经完整物化；
- “已卸载”也不证明旧菜单、活动收据、生成实体、`dist` payload 或浏览器活动页已经清退。

## 3. 统一发现与聚合算法

Node 每次巡检只读合并以下集合，以稳定 `moduleId` 去重：

```text
开发挂载扫描
  ∪ Host 管理的 Node/Vue payload
  ∪ pah_plugin_installation
  ∪ contribution / migration / dictionary ledger
  ∪ activation candidate / active receipt
  ∪ 启动健康快照
  = PluginInspection[]
```

聚合时必须满足：

- Node/Vue 双端开发 symlink 指向同一产品 Git 根和同一插件身份；
- 普通安装只能引用 Host 管理目录，不能把外部 symlink 当作正式 payload；
- 数据库有记录但目录不存在时仍返回 `ledger-only`，不能让卡片消失；
- 目录存在但没有台账时返回 `mounted-unregistered`，不能自动执行安装；
- 同一 `moduleId` 出现多个版本、多个不一致 manifest 或多份活动收据时 fail-closed；
- 结果不向浏览器返回本机绝对路径、凭据、SQL 原文或源码内容。

建议新增统一读接口：

```text
GET /admin/phoenix/plugin/inspection
GET /admin/phoenix/plugin/inspection?moduleId=<moduleId>
```

Vue 切换到统一接口并完成回归后，删除仅面向开发挂载的
`/admin/phoenix/plugin/development-status`，避免两套状态真源长期并存。统一接口只返回事实、风险、
阻断原因和允许动作，不执行修复。

## 4. 统一状态与建议动作

| 巡检状态 | 说明 | 允许动作 |
| --- | --- | --- |
| `mounted-unregistered` | 双端开发挂载合法，但插件中心无台账 | 运行 Host-owned 初始化命令；底层仍校验与挂载逐字节一致的不可变包 |
| `mounted-version-mismatch` | 挂载 manifest 与台账版本不同 | 重新验包，生成升级计划 |
| `verified-not-installed` | 包已验证，尚未完成迁移与安装 | 只读 dry-run；确认后受控安装 |
| `installed-not-enabled` | 数据库已安装，贡献尚未开放 | 启用并物化贡献 |
| `enabled-restart-required` | 台账已启用，当前进程未加载同版本 payload | Hub/部署 supervisor 受控重启 |
| `enabled-contributions-missing` | 菜单、Ribbon、字典或 assignment 少于声明 | 生成重物化计划，再执行受控修复 |
| `enabled-permission-filtered` | 贡献存在，但当前角色不可见 | 跳转权限配置，不重装插件 |
| `ready` | 身份、DDL、字典、贡献、权限和运行快照一致 | 无写操作 |
| `disabled-clean` | 已停用，入口与活动收据已撤销，数据保留 | 启用或卸载 |
| `uninstalled-retained` | 已卸载，业务数据、ledger、字典和 assignment 按契约保留 | 重装或显式清理保留元数据 |
| `stale-contributions` | 已停用/卸载，但菜单、Ribbon、路由或 capability 仍残留 | 只清退本插件贡献 |
| `stale-runtime` | 已停用/卸载，但 payload、活动收据或生成实体仍残留 | 受控清退并重启 |
| `quarantined` | 身份、完整性、边界或版本证据不可信 | 只展示诊断；禁止生命周期写操作 |

一个插件可以同时包含多个问题，例如 `uninstalled + stale-contributions + stale-runtime`。页面应显示
所有问题和依赖顺序，不用最后一个错误覆盖前面的证据。

## 5. 卡片中的巡检 Block

### 5.1 来源与身份

- `moduleId`、名称、版本、发布者、许可证、插件类型；
- 来源是开发挂载、Host 管理 payload，还是仅剩台账；
- Node/Vue 是否成对、manifest 是否一致、Git 开发来源是否 clean；
- package SHA-256、canonical manifest SHA-256、payload 聚合哈希和激活收据是否匹配。

### 5.2 合法性与安全审查

“恶意代码审查”不能被承诺为一次自动扫描后绝对安全。页面应把结论拆成可证明的层级：

1. **结构合法**：manifest v2、路径、命名空间、入口、文件清单、size/SHA、禁止 symlink/路径逃逸；
2. **运行闭包合法**：只接受声明的 runtime artifact，拒绝未知文件、bare import、动态
   `require/import`、插件脚本和联网安装；
3. **静态风险扫描**：标记进程执行、任意文件系统、网络外联、动态代码、原生扩展、凭据访问等
   高风险能力；命中阻断规则则隔离；
4. **人工/外部审查**：对高风险但确有业务必要的能力，绑定审查报告摘要、制品 SHA、审查人和时效。

自动结果只使用“通过当前规则、需人工复核、已隔离”，不得显示“绝对安全”。开发目录 dirty、
双端来源不同或审查报告绑定的 SHA 过期时，原审查结论立即失效。

### 5.3 数据库初始化与等幂升级

- 只比较当前插件 manifest 的 `migrations[]` 与自身 migration ledger；
- migration ID、SQL 原始字节 checksum、版本和顺序必须一一对应；
- 计划只允许访问 manifest `dataOwnership.tables` 与该插件命名空间内的对象；跨插件表、Host 表、
  其他 schema、数据库级 DDL、任意脚本均拒绝；
- 生产保持 `synchronize=false`，禁止用 TypeORM 自动同步代替 migration；
- `GET` dry-run 生成绑定目标数据库与有序哈希的一次性计划；执行前在事务中重新核对指纹；
- 有待执行 DDL 时遵守现有可信备份与恢复演练门禁；零 migration 仍走同一生命周期，但不制造备份；
- 已 applied 的迁移重复巡检必须返回幂等 `0 pending`，不得重放 SQL 或重复 ledger。

页面不得接收 SQL、数据库路径、任意 `planId` 或伪造的备份证明。Vue 只展示 Node 生成的计划摘要。

### 5.4 字典登记与升级

- 只消费 manifest 的 `dictionaryContributions`；
- `typeKey`、贡献 ID 和 policyVersion 必须位于插件命名空间；
- 显示声明、已物化、待新增、待升级、冲突和管理员定制保护数量；
- 核心值不可删除，允许定制字段按策略保留；
- 卸载默认保留字典与治理台账，避免业务数据失去解释；永久清理是单独授权流程。

字典升级与 DDL 可以出现在同一插件维护计划中，但分别记录结果，任一失败不得伪造另一项成功。

### 5.5 工具条、菜单、路由和权限登记

巡检比较 manifest 期望贡献与 Host 实际贡献：

- navigation module、route、capability contribution 数量和稳定 key；
- Cool 菜单记录、Wing Ribbon 投影、路由可达性和当前角色授权；
- 图标 ID 是否存在于冻结 Wing/Host catalog；
- assignment 是否存在，是否仍指向管理员选择的分组；
- 当前进程启动快照是否加载了同版本贡献。

首次物化统一进入 Host 稳定“业务”分组。页面提供“前往分组管理”链接；升级、重装、停用→启用
不得覆盖管理员的稳定 `targetKey → groupId` assignment，也不得自动创建产品大分组。

“受控重物化”必须复用 Node 生命周期：先生成计划，精确删除本插件陈旧 contribution，再按 manifest
重建；不能由 Vue 直接写菜单，也不能用前端临时 Ribbon 掩盖正式 contribution 缺失。

### 5.6 pnpm、运行依赖与重启

巡检可以报告依赖状态，但 Host 不执行插件提供的任意 `pnpm` 命令。页面可以明确显示插件仓和 Admin
Node 两个 Terminal 的目录与可复制命令；插件制品由开发者在插件仓运行已审计脚本生成，Host-owned CLI
只接受 `moduleId` 并复用固定生命周期：

| 场景 | 页面结论 | 处理方式 |
| --- | --- | --- |
| 不可变包运行闭包完整 | 无需安装 | 继续受控装配 |
| 包缺少 Node/Vue runtime artifact | 制品不完整 | 回插件仓重新构建，Host 拒绝安装 |
| Host/Wing peer 版本不兼容 | Host 版本不满足 | 升级 Host 或使用兼容插件版本 |
| 开发源码仓自身依赖未准备 | 开发环境未就绪 | 开发者在产品仓按锁文件准备；Host 不代装 |
| 新 Node/Vue payload 或实体集合发生变化 | 待重启 | Hub/部署 supervisor 执行固定重启动作 |

重启是因为 Midway 装饰器、路由、Entity 集合和 Vite import 图需要重新建立，不是因为页面看到
`package.json` 就应运行 `pnpm install`。未来若引入受控依赖装配，也只能在隔离候选目录依据精确锁、
允许 Registry 和完整性摘要执行 Host 固定命令，不能接收插件脚本、参数、cwd 或环境变量。

## 6. 停用、卸载与 Ribbon 清退

停用和卸载必须进入统一巡检，不能只改变 `pah_plugin_installation.state`。

### 停用

1. 校验目标仍是当前版本和 `enabled`；
2. 撤销本插件活动收据；
3. 删除本插件菜单、route/capability contribution 和运行任务入口；
4. 保留 payload、业务数据、migration/dictionary ledger 和管理员 assignment；
5. 原子生成新的插件实体清单与编译隔离收据；
6. 当前浏览器立即刷新菜单并关闭/迁移属于该插件的活动 View；
7. `activationMode=restart` 时标记待重启，重启后复检为 `disabled-clean`。

### 卸载并保留数据

1. 只允许从已停用或等价安全状态进入；
2. 再次确认 contribution 和活动收据已撤销；
3. 删除候选收据、Node/Vue payload、插件实体生成项及对应非活动 `dist` 制品；
4. 保留业务表、migration ledger、字典、数据治理记录和管理员 assignment；
5. 记录实际移除与待外围清理的 payload，不把“数据库提交成功但外围回收失败”误报为整体回滚；
6. 受控重启后确认登录、EPS、字典和其他插件正常；
7. 巡检结果变为 `uninstalled-retained`，同一稳定插件重装时恢复原分组。

已通过完整权威校验的原始 `.phoenix.cool` 包由 Admin Host 包仓独立保留。卸载和撤销验证候选可以清退
candidate、Node/Vue payload 与非活动 `dist`，但不得把这些动作描述成删除已归档包；开发挂载恢复时必须按
`moduleId/version/SHA-256/sourceCommit` 重新读取并完整验包，再进入 dry-run、安装和启用状态机。包仓的显式
清理属于单独授权的未来能力，不和业务数据保留卸载捆绑。

### 必须检测的残留

- contribution 台账或 Cool 菜单仍存在；
- 当前角色仍能获得插件路由；
- 浏览器 Process/KeepAlive 仍保留活动 View；
- Node/Vue 活动收据、candidate、源 payload 或 `dist/modules/<moduleId>` 仍存在；
- `entities.plugin.ts` 或编译隔离收据仍包含该插件；
- 启动健康快照仍把已卸载版本标为 ready；
- 公开品牌仍选择已停用/卸载插件。

残留修复只允许按稳定 `moduleId` 清理本插件拥有的 contribution 和 payload；不能删除业务表、其他插件
菜单、其他插件字典或共享 Host 配置。

## 7. 页面交互建议

`/phoenix/plugins` 顶部增加统一“插件巡检”摘要，不再单独强调“开发环境插件”：

```text
插件巡检  [仅检测]  正常 3 · 待操作 2 · 隔离 1

插件卡片
├─ 身份与来源       通过
├─ 安全与完整性     需人工复核
├─ 数据库           3/3 applied
├─ 字典             2/2 已物化
├─ 菜单与 Ribbon    8/8 · 当前角色 6/8
├─ 运行时           待重启
└─ 可执行动作       查看计划 / 初始化 / 重物化 / 停用 / 卸载
```

交互规则：

- 页面首次进入只读巡检，不自动改数据库、重物化或重启；
- 每个灰色按钮旁显示精确阻断原因；
- 先点“查看计划”，再显示需要管理员确认的写操作；
- 开发挂载与正式安装保留为两个可折叠 Block，通过稳定 `moduleId` 关联，不把“挂载”误写为“安装”；
- 已卸载但保留数据的插件继续显示，不因 payload 消失而隐藏；
- 权限过滤只引导权限配置，不建议重装；
- 页面刷新后从 Node 恢复状态，不以 Vue 内存或 localStorage 作为真源；
- 某个插件失败只隔离该卡片，不阻断登录、其他插件或 Host 管理页面。

## 8. 接口与职责建议

### Node/Pah

- 聚合所有来源并返回 `PluginInspection`；
- 生成只读维护计划和计划指纹；
- 复用现有验包、migration dry-run、受控安装、enable、disable、controlled uninstall；
- 增加严格限定为单插件 contribution/payload 的残留修复动作；
- 记录 actor、moduleId、版本、包 SHA、计划指纹、前后状态和结果摘要；
- 启动只做快速只读健康检查，不在启动阶段自动写数据库。

### Vue

- 统一渲染巡检卡片、Block、计划、阻断原因和审计摘要；
- 只调用固定 API，不提交 SQL、脚本、文件系统路径、shell 参数或伪造 ledger；
- 状态变化后刷新菜单、动态路由和 Process，并以 Node 复检结果为准；
- 对重启只打开 Hub/部署入口，不伪造重启完成。

### Hub

- 机械创建/删除开发 symlink 与 Git exclude；
- 受控启动、停止和重启固定 Admin API/Web 服务；
- 不解析业务 manifest，不执行 migration，不写插件台账，不物化 Ribbon。

### 插件

- 提供 manifest v2、完整性清单、运行闭包、版本化 migration、字典贡献和健康检查；
- 所有 ID、API、路由、表、字典与 capability 位于自身命名空间；
- 不提供安装脚本、任意 Host SQL、跨插件引用或 Host 产品特例。

## 9. 分阶段实施

### 阶段 A：统一只读巡检

- 新增全来源聚合接口；
- 把当前开发检测与已安装卡片合并；
- 覆盖新挂载、已安装、已停用、已卸载保留、目录缺失、台账缺失和隔离状态；
- 不新增写操作。

### 阶段 B：统一计划

- 为初始化、升级、重物化、停用、卸载和残留清理生成确定性计划；
- 计划明确数据库、字典、贡献、payload、重启和保留项；
- 并发变化或指纹不一致时拒绝执行。

### 阶段 C：复用生命周期动作

- Vue 从计划跳转/调用现有受控 endpoint；
- 新增动作仅限目前缺失的单插件残留清退；
- 不创建第二套安装器、migration runner 或 Hub 编排。

### 阶段 D：静态安全分级

- 冻结自动阻断规则、人工审查报告格式和 SHA 绑定；
- 先只报告，再对确定性高风险规则 fail-closed；
- 不把启发式扫描宣传为完整恶意代码证明。

## 10. 验收矩阵

至少覆盖以下通用场景，测试 fixture 使用匿名示例插件，不把具体产品写入 Host：

1. 纯 Host：巡检为空，登录、EPS、字典正常；
2. 仅 Node 或仅 Vue 挂载：隔离，不能初始化；
3. 双端合法新挂载：显示 `mounted-unregistered`；
4. 选择不匹配包：拒绝，不写台账和数据库；
5. 零 migration：同一生命周期完成安装，不生成虚假 DDL/备份；
6. 有 migration：dry-run、可信备份/恢复、事务 ledger 和幂等复检通过；
7. 字典首次登记、policyVersion 升级、冲突和管理员定制保护；
8. 首次启用进入稳定“业务”组，管理员移动后升级/停启/重装保持 assignment；
9. 贡献缺失：只重物化目标插件，不重放已 applied migration；
10. 当前角色权限不足：显示过滤，不把它误诊为菜单缺失；
11. 停用：Ribbon/菜单/路由立即不可达，数据和 assignment 保留；
12. 卸载：payload、活动收据和插件实体清退，业务表/字典/ledger/assignment 保留；
13. 故意制造菜单、收据、`dist` 或实体残留：巡检识别并只清理目标插件；
14. 一个插件隔离：其他插件与 Host 登录继续正常；
15. 重启前后版本指纹一致，页面状态不丢失；
16. 重复检测、重复计划和对已健康项执行维护均不产生额外写入。

## 11. 与现有文档的关系

- [开发插件初始化与就绪检测](./开发插件初始化与就绪检测.md)：当前已实现的开发挂载第一阶段；
- [Pah 插件数据库迁移契约](./Pah插件数据库迁移契约.md)：DDL、dry-run、ledger 与备份权威；
- [Phoenix 插件实体注册分层实施计划](./Phoenix插件实体注册分层实施计划.md)：实体清单、收据、
  编译隔离和卸载清退；
- [Phoenix Admin 维护中心契约](./Phoenix%20Admin维护中心契约.md)：Host 固定维护项，不替代插件生命周期；
- Vue 的 `docs/PahPLUGIN.md`：扩展中心页面和前端边界；
- Vue 的 `docs/PahPLUGIN-RUNTIME-TODO.md`：重启、回滚和未来热插拔边界。

本方案不要求现在修改插件包版本、执行安装、运行 SQL、重启服务或改动 Hub。
