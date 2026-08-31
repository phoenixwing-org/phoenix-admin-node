# Phoenix 品牌二元快照契约

> 状态：2026-08-31 冻结。本文替代按字段 hostBindings/effectiveSources 解析的 v3 中间草案。

## 范围与所有权

Public Login Branding Snapshot 是登录首帧、浏览器标题/favicon 和登录后工作台品牌的唯一静态
派生。Host 拥有配置、选择、校验、资源收据、revision、原子发布、启动对账与回退；品牌插件只
提供完整 manifest 声明和包内静态资源，不写数据库、不执行认证逻辑、不扫描或修改 DOM。

数据库分别保存 Host 默认品牌与品牌插件选择。.runtime/pah-public-login-branding/current.json
是可重建的公开派生，不是权威配置。

## 完整二元来源

| 模式 | 完整字段来源 | 当前来源 |
| --- | --- | --- |
| host-default | 标题、副标题、明暗 Logo、favicon 全部来自同一 Host 配置 revision | Host |
| plugin | 全部来自同一个已验证插件 manifest 与资源收据 | 单个活动插件 |

禁止按字段继承、覆盖或混合，不接受 hostBindings/effectiveSources、产品 ID 特例、DOM 探测或
浏览器端猜测。v1/v2 contribution 均按完整固定插件品牌解释。

Host 字段整套映射到 appName、titleTemplate、登录左右文案、favicon、明暗/紧凑 Logo、工作台
标题/副标题/Logo 和 Runtime 就绪日志。未提供独立 favicon 时复用有效亮色 Logo，不再硬编码
Phoenix favicon。

## Host 保存

当前为 Host 时，保存或恢复执行：安全校验 → 配置 revision/CAS → 持久化 → 原子发布新的 Host
snapshot revision。无需 API/Web 重启；当前预览立即更新，新开、刷新或重新登录的页面使用新
revision，其他已打开 SPA 刷新后切换。

当前为插件时，Host 默认品牌仍允许保存或恢复，但只作为备用配置：只更新 Host 配置 revision，
当前插件 snapshot revision 与资源保持不变。API/UI 必须返回“已保存为备用，尚未应用”，不能把
保存成功表述为当前已应用。

## 插件固化与恢复

开发挂载、插件启停或制品更新由受控生命周期重启加载。Node 启动时校验完整声明与资源，成功后
原子发布不可变插件 revision。发布后 Host 备用保存、普通刷新和 Web HMR 都不能重新物化它。

停用或取消选择插件并重启后发布最新 Host 备用配置；切回 Host 不要求卸载插件。

## 失败与回退

- 首次插件候选失败：保持当前 Host revision；
- 活动插件更新失败：保持上一个可用插件 revision；
- Host 备用异常：使用最近一次有效 Host，最后才回退内置 Phoenix；
- current.json 损坏、未知 schema、非法资源 URL/SHA-256/MIME/size 或资源字节不符：拒绝候选；
- 任意路径都不得发布插件 Logo + Host 标题或新旧 revision 混合的半套品牌。

数据库更新和选择使用 revision/CAS。日志只记录 moduleId、version、revision、阶段和安全错误，
不输出资源字节、内部绝对路径、用户数据、Token 或密钥。

## 客户端消费

- HTML/Vue 在 mount 前读取同一 snapshot revision；
- 登录页左右区域、document.title、favicon 和工作台左上角只消费该快照；
- 设置页可以读取 Host 默认配置用于编辑，但不能把备用配置当成当前品牌；
- 路由切换不查品牌数据库，不执行插件品牌脚本；
- 插件首页、菜单、权限和业务视图仍是普通登录后 contribution。

## 验收

- Host 保存无需重启，新开、刷新和重登页面整套使用新 Host revision；
- 插件活动时 Host 备用保存成功，公开插件 revision 不变；
- Host、Acme、Acme 更新失败和 Acme → Host 均不产生半套品牌；
- 登录首个非空可见帧无 Phoenix/Host → Acme 或 Acme → Host 闪烁；
- 明暗主题、标题/favicon、工作台与 Runtime 日志消费同一 revision。
