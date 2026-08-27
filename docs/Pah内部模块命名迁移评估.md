# Pah 内部模块命名迁移评估

> 状态（2026-08-27）：本文以下内容是迁移前的风险评估与冻结证据。方案 A 已在独立
> worktree 实施；当前目录、兼容入口和业务插件适配要求以
> [Phoenix Host 目录迁移实施说明](./PhoenixHost目录迁移实施说明.md) 为准。

## 结论

`Pah` 在当前两端命名规范中明确表示 **Phoenix Admin Host**，不是旧产品名。它主要出现在
源码、开发环境变量和持久化技术标识中；插件管理的用户入口已经是 `/phoenix/plugins`，权威插件
API 已经是 `/admin/phoenix/plugin`。因此当前没有为了品牌展示而立即全量改名的必要。

若只希望内部目录更直观，可以在独立阶段执行方案 A：移动物理目录，但保留所有已经发布、持久化
或被产品插件消费的标识。方案 B 的全量语义改名应等到公共 Host SDK 或包格式的 major 版本，不能
与 Branding 0.1.0 打包安装、登录快照或其他产品迁移并行实施。

数据库表、插件包 kind、descriptor 文件名和业务分组稳定 key 不应因源码目录改名而变化。

## 本轮边界与冻结输入

本轮只读评估，不实施目录、类型、路由、数据库或包格式改名。盘点输入为：

| 对象                | 精确提交                                   | 状态                                              |
| ------------------- | ------------------------------------------ | ------------------------------------------------- |
| Admin Node 评估基线 | `35007421fdb3347f756a0c4f4599bd7b4b2f42f6` | 主工作树另有历史生成文件；本评估使用独立 worktree |
| Admin Vue           | `096ed761bc0e6b80586c67e55efed957d162c549` | clean                                             |
| Phoenix Dev Hub     | `7759c238c08e6b7a213de3caedbdc7d0186da331` | clean                                             |
| Phoenix Branding    | `22bde2bd39a6ecf7143f12ea9f51e11237a8ca37` | clean                                             |

独立 worktree 为 `<workspace>/.worktrees/phoenix-admin-generated-entities`。本轮没有读取或
写入 `<workspace>/.worktrees/phoenix-admin-clean-validation/{node,vue}`，也没有干扰其
9100/8201 插件安装验证服务。

以下数量是上述提交上的 `rg` 静态命中，用于估算影响面，不作为待改文件的机械清单：

- Node `src/modules/pah` 有 36 个文件，`test/modules/pah` 有 8 个文件；约 74 个不同的
  `Pah*` 符号、43 个实际读取的 `process.env.PAH_*` 键和 11 张 `pah_*` Entity 表。
- Vue `src/pah` 有 53 个文件，`src/modules/pah` 有 7 个文件；约 77 个不同的 `Pah*`
  符号、21 个 `PAH_*`/`VITE_PAH_*` 常量或环境名和 7 个 `pah.*` 浏览器持久化键。
- 任一 Pah 标识的粗粒度文件命中为 Node 72、Vue 76、Dev Hub 23；Branding、Open Issue、
  Function 和 BOM 四个产品仓合计约 88。方案 B 至少跨越约 259 个命中文件。

复现盘点时应排除 `.git`、`node_modules`、`dist` 和 coverage，并分别统计源码、测试、脚本、
文档和产品制品，不能把历史文档命中直接当成生产改动。

### 2026-08-13 当前 HEAD 复核

本节只更新评估证据，不改变上面的冻结输入，也不表示已经批准实施目录迁移。复核提交为：

| 对象 | 当前提交 | 复核结果 |
| --- | --- | --- |
| Admin Node | `fc7b3dd0d380801bf5d1bdfbb87b11552927d22e` | `src/modules/pah` 仍为 36 个文件；插件启动健康与编译隔离继续使用现有物理目录 |
| Admin Vue | `11fab10882a15a5b800cc9707b00ba4df2bb80e7` | `src/pah` 与 `src/modules/pah` 均保留；外部插件由 Host 虚拟入口隔离加载 |
| Phoenix Dev Hub | `6e58c859d10ac5e009d16ef0cd3de0c6a0ab22ed` | 旧 `/admin/pah/plugin/*` 调用已改为 `/admin/phoenix/plugin/*`，Hub 只维护 symlink/Git exclude |

结论保持不变：**方案 A 在单独迁移窗口内可行，但不是当前纯 Host 与插件生命周期恢复的前置项；方案 B
仍不应实施。** 当前新增的公开登录品牌、动态插件实体清单和插件启动健康检查进一步扩大了物理路径迁移
的回归面，但没有产生必须立刻改名的新理由。

本次复核确认以下风险仍然存在：

- Identity 控制器仍使用无显式 prefix 的 `@CoolController()`，Navigation 也未显式锁定旧
  `/admin/pah/*` 公共前缀；移动目录前仍必须先锁路由并补枚举测试；
- Node `package.json` 仍打包 `dist/modules/pah` 下的 Host schema、baseline 和 SQL 资产；
- Vue 的 `/@/pah/*` 实际依赖通用 `/@ -> src` alias，物理目录移动后必须增加显式兼容 facade，
  不能只修改 Host 自身 import；
- Dev Hub 的插件 API 已改为 `/admin/phoenix/plugin/*`；该修复不改变物理目录迁移结论，也不得以此为由
  重新开放旧接口；
- `validatePahPluginManifest` 改为更直观的内部函数名 `validatePhoenixPluginManifest`，只属于内部符号
  整理，不等于批准移动 `src/modules/pah`，也不得顺带修改 wire、表名、权限或制品标识。

## 当前标识分层

### 只属于内部实现的标识

这些标识可以在方案 A 中移动或由新名字实现，但仍需兼容 facade：

- Node 物理目录 `src/modules/pah/`；
- Vue Host 物理目录 `src/pah/`、`src/modules/pah/`；
- Host 内部 `Pah*` 类、类型、服务和测试名；
- Node/Vue 内部 import path 和测试 fixture 名；
- 文档标题、注释和开发脚本文件名。

Node 的 `src/modules/pah/service/public-login-branding.ts` 与 Vue 的
`src/pah/PahPublicLoginBranding.ts` 属于这一层的实现文件；文件可移动，但快照 wire contract 不能
随物理路径一起静默改变。

### 已发布或持久化的兼容标识

以下标识已经进入插件、数据库、运维配置、浏览器状态或管理员 assignment，应视为 ABI：

| 标识                                                              | 消费者或持久化位置                               | 决策                           |
| ----------------------------------------------------------------- | ------------------------------------------------ | ------------------------------ |
| `pah-business-module`                                             | `.phoenix.cool` 包 metadata、Host/Dev Hub 验包器 | 保留                           |
| `pah-plugin.artifacts.json`                                       | 多个产品插件、Host production 装配器             | 保留                           |
| `pah-group-business`                                              | manifest、导航表、管理员 assignment              | 永久保留稳定 key               |
| `pah:plugin:*`                                                    | Cool 菜单/API 权限                               | 保留；新显示名不改权限 key     |
| 11 张 `pah_*` 表及其索引、ledger                                  | PostgreSQL、备份、恢复、preflight                | 保留物理表名                   |
| `PAH_*`、`VITE_PAH_*`                                             | Node/Vue/Dev Hub 启动 Profile                    | 至少一个 major 周期双读        |
| `__PAH_PUBLIC_LOGIN_BRANDING__`                                   | Node 首帧脚本、Vue、Branding runtime             | 保留或双读，不做单边替换       |
| `pah.*` storage keys                                              | 浏览器工作台偏好                                 | 旧键只读迁移，禁止直接丢失设置 |
| `/@/pah/*`、`/$/pah/*`                                            | 产品插件的 Host adapter import                   | 保留 alias 或兼容 facade       |
| `/admin/pah/identity`、`/admin/pah/navigation`                    | 当前 Vue 与外部身份/导航 API                     | 保留兼容入口                   |
| `/pah/identity`、`/pah/navigation`、`/pah/dictionary-maintenance` | 当前 Host 页面、菜单或深链                       | 保留 redirect/alias            |

已经规范化的 `/phoenix/plugins` 和 `/admin/phoenix/plugin` 保持不变，不再引入第二套插件管理
真源。产品自己的 `/admin/phoenix-<moduleId>/*` API 也不受 Host 内部命名迁移影响。

## 现存的独立契约错位

Dev Hub `src/server/api.ts` 当前仍请求：

- `/admin/pah/plugin/list`；
- `/admin/pah/plugin/migration-plan?moduleId=...`。

当前 Admin Node 的插件控制器已经显式锁定 `/admin/phoenix/plugin`，而且 Admin Vue 测试明确拒绝
`/admin/pah/plugin` 兼容入口。这是现存的 Dev Hub 与 Host 契约错位，不是目录改名造成的。

应在独立提交中把 Dev Hub 改为 `/admin/phoenix/plugin/*`，补成功、401/403 和错误响应测试。不要
为了兼容这个陈旧调用而重新开放 `/admin/pah/plugin`，也不要把该修复混入目录重命名。

## 方案 A：只改物理目录，稳定标识不变

### 目标形态

- Node 将 `src/modules/pah/` 移到 `src/modules/phoenix/`；
- 如需两端一致，Vue 将内部实现移到 `src/phoenix/` 与 `src/modules/phoenix/`；
- `Pah*` 导出、`/@/pah`、`/$/pah` 和全部 wire/storage 标识继续可用；
- 新内部代码可以逐步使用 `PhoenixAdminHost*` 等更明确名称，但不要求产品同步改动。

### 必须先处理的隐式行为

Cool 会从 Node 模块目录名推导未显式声明的控制器前缀。当前 Identity 和 Navigation 控制器没有
显式 prefix；直接把目录从 `pah` 移到 `phoenix` 会把 API 偷偷改成 `/admin/phoenix/*`。移动前必须
先把旧 `/admin/pah/identity`、`/admin/pah/navigation` 前缀显式锁定，并用路由枚举测试证明物理
目录不再决定公共 URL。插件控制器已有 `/admin/phoenix/plugin` 显式 prefix，不应改变。

同时需要更新：

- Node `package.json` 中 `dist/modules/pah` 的 pkg asset 路径；
- host-baseline loader 当前根、schema/asset 复制路径和生成配置；
- Node 测试相对 import、脚本路径与文档链接；
- Vue 模块发现、动态 viewPath 和内部 import；
- Vite 对 `/@/pah`、`/$/pah` 的兼容 alias/facade；
- Branding 登录快照文档的实现路径，但不修改 manifest 或全局快照字段；
- production `dist` 中 Host 模块路径的新旧冲突检查。

### 风险、工时和收益

风险为中等，主要来自 Cool 模块发现/DI/路由推导、Vite 动态模块加载、pkg asset 路径和历史
host-baseline 路径。预计 2–4 个工程日，包括两端完整构建、插件安装/启停/卸载和登录冷启动。

方案 A 的收益主要是内部目录可读性。由于 `Pah` 本来就表示 Phoenix Admin Host，且用户入口已经
使用 Phoenix，收益不足以支持在 Branding 0.1.0 发布窗口并行实施。

### 回滚

方案 A 不改数据库、包格式、环境变量或公开路由，因此回滚可以恢复目录移动提交并重新构建 Host。
部署前发现任何 DI、路由或资产差异，直接停止发布；部署后回滚时保留兼容 alias，不删除用户浏览器
状态或插件 ledger。回滚验证仍需重跑已安装插件和 Host 默认登录快照。

## 方案 B：全量语义改名与兼容迁移

方案 B 还会把 `Pah*`、`PAH_*`、`pah.*`、旧 API/页面前缀及制品术语迁到新命名。这不是机械
替换，必须提供至少一个 major 版本的双读/别名：

1. 先增加新类型与旧 `Pah*` deprecated alias，Host 与产品插件均可编译；
2. 环境变量优先读取新键，兼容 `PAH_*`；新旧同时存在且值不同时 fail-closed；
3. API 新旧路由指向同一 service，旧页面只做 redirect，不建立第二套状态或生命周期；
4. 浏览器设置和登录快照全局变量双读，迁移成功后只写新键，保留旧读路径至 major 窗口结束；
5. Dev Hub、Branding、Open Issue、Function、BOM 依次升级，不能要求所有相邻源码目录同时 dirty；
6. 最后才评估删除 deprecated facade，并以已发布旧插件包作兼容夹具。

即使选择方案 B，也建议永久保留以下物理/wire 名称：

- `pah_*` 数据表、索引、migration/repair ledger；
- `pah-group-business` assignment key；
- `pah-business-module` 包 kind；
- `pah-plugin.artifacts.json` descriptor 文件名。

这些名字对用户不可见，但连接已有数据库、备份、恢复、不可变旧包和管理员分组。强制重命名 11 张
表会扩展到外键/索引、基线 SQL、preflight、备份证明、恢复演练和回滚，同时使旧 Host/旧包不能
安全共存，几乎没有产品收益。

方案 B 预计 2–4 周；若强制迁移数据库或包格式，预计 4–6 周并需要新的 schema/package major
版本、双版本安装矩阵和生产恢复演练。当前不推荐执行。

## 推荐分阶段顺序

1. **先修独立错位**：单独修复 Dev Hub 两个 `/admin/pah/plugin/*` 调用并提交。
2. **冻结兼容面**：增加 API、包 kind、descriptor、数据库表、权限 key、导航 assignment、环境变量、
   snapshot global 和 storage key 的契约测试。
3. **可选执行 A-Node**：显式锁定 Controller prefix，再移动 Node 目录、构建并回滚演练。
4. **可选执行 A-Vue**：保留 `/@/pah`、`/$/pah` facade，移动 Host 实现，验证动态 viewPath。
5. **跨产品观察**：用至少 Branding 和一个带 DDL 的业务插件完成旧包安装、升级、停用、卸载保留
   数据、重装，以及 Host 默认/活动品牌登录冷启动。
6. **major 决策**：只有公共 SDK 需要统一品牌命名时再批准方案 B；数据库与已发布包标识默认不迁。

任何阶段都应独立中文本地提交，不 push；不得复用或修改正在承担 9100/8201 安装测试的
clean-validation worktree。

## 验证门禁

### Node

- 路由枚举：插件管理仍只有 `/admin/phoenix/plugin`，Identity/Navigation 旧入口仍可用；
- `pah_*` 表、权限 key、navigation target/group key 和 migration ledger 字节不变；
- `pnpm exec jest test/modules/pah --runInBand`；
- `pnpm run lint`、`pnpm run build`；
- production build 后检查 pkg assets、host-baseline、schema、descriptor 与 runtime artifact SHA。

### Vue

- 旧 `/@/pah`、`/$/pah` 产品 adapter 夹具仍可类型检查；
- `/phoenix/plugins` 是唯一插件管理页面，旧 `/pah/plugins` 继续不存在；
- `/pah/identity`、`/pah/navigation`、字典维护和隐藏深链兼容；
- `pnpm run test`、`pnpm run lint`、`pnpm run typecheck`、`pnpm run build`；
- 登录快照在 Host 默认和活动品牌两态均无 Phoenix/Acme 交叉闪烁，认证表单不被接管。

### Dev Hub 与产品制品

- Dev Hub `pnpm run verify`，并断言不再请求 `/admin/pah/plugin`；
- 旧版 `.phoenix.cool`、当前版包和同版本重装均通过权威 Node 验包；
- `kind=pah-business-module`、`pah-plugin.artifacts.json` 和 `pah-group-business` 保持字节兼容；
- 至少验证一个零 DDL Branding 插件和一个带 DDL 插件；
- 未安装 → 验包 → 安装 → 启用 → 停用 → 卸载保留数据 → 重装闭环；
- 管理员自定义分组 assignment、业务表、dictionary/migration ledger 和登录品牌 reset 均保留。

### ESLint 与静态防误改

- 对移动后的全部拥有文件运行 ESLint/Prettier，不使用 Host `--fix` 穿透产品 symlink；
- 静态扫描禁止新增产品 moduleId 特例或把 Branding/其他业务源码复制进 Host；
- 维护稳定标识 allowlist，任何 `pah_*` 表、包 kind、descriptor、分组 key、权限或公开 URL 的删除都
  必须使门禁失败；
- 审计已提交 HEAD 与当前 dirty 快照，生成文件和他人修改不计入发布证据。

## 最终建议

保持当前 `Pah = Phoenix Admin Host` 的公开解释，在 Branding 0.1.0 发布后如仍有内部目录可读性
诉求，再独立执行方案 A。方案 B 暂不进入开发计划；数据库表和已发布包标识默认永久兼容。
