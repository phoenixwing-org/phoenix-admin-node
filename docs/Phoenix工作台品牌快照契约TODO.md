# Phoenix 工作台品牌快照契约 TODO

## 状态与范围

本文件只冻结后续契约，**本轮不修改数据库、接口、快照 schema 或插件生命周期代码**。
目标是让登录后的工作台左上品牌区可以由管理员配置紧凑 Logo、主标题与副标题，同时避免每次
打开页面都查询数据库。

Public Login Branding Snapshot v1 仍只负责登录前公开品牌壳；工作台候选作为明确的
`schemaVersion=2` 扩展。它不包含用户、权限、菜单、首页业务数据或任意可执行代码。

## 建议字段

```ts
workbench: {
  title: string;
  subtitle: { mode: 'web-origin' | 'text'; text?: string };
  logoVariant: 'compact';
}
```

- Host 默认标题为 `Phoenix Admin`，Logo 使用 Host 自带 compact SVG。
- `web-origin` 由浏览器显示当前 `window.location.origin`，静态快照不固化开发端口或内部 API
  地址。
- `text` 只允许通过长度、控制字符与 Unicode 正规化校验的纯文本。
- 活动品牌必须整套覆盖 Logo、标题和副标题，禁止形成插件 Logo 与 Host 文案混搭。

## 权威状态与静态派生

1. 数据库只保存 Host 默认配置、活动品牌选择和并发 revision，仍是管理端权威真源。
2. Node 把有效配置编译为严格白名单 JSON，写入 `.runtime/pah-public-login-branding` 的新
   revision；同目录临时文件、`fsync`、原子替换后才切换 `current.json`。
3. Vue mount 前读取同源快照，工作台只消费已初始化 Store，不在每次路由或组件挂载时查询
   数据库。
4. 优先级固定为：有效活动品牌插件 → 数据库 Host 默认配置 → 内置 Phoenix Admin 默认。
5. 新候选无效或写入失败时保持 last-known-good，不发布半套品牌。

## 更新触发矩阵

- 管理员保存或恢复 Host 默认品牌；
- 选择新的活动品牌；
- 升级当前活动品牌；
- 停用或卸载当前活动品牌（先切回 Host 默认）；
- 进入安全模式；
- Node 启动时发现数据库 revision 与静态快照不一致并完成对账。

并发更新必须使用 revision/CAS；CAS 失败时重新读取数据库 winner 并对账，旧请求不得覆盖新
选择。

## 资源与安全边界

- Logo 只接受 Host 内置资源，或已校验插件制品内的内容寻址描述符：相对同源路径、
  SHA-256、MIME、size 一致。
- 禁止数据库保存 SVG 原文、任意 HTML/CSS/JavaScript、外部 URL、`data:`、symlink 或
  MutationObserver 生产投影。
- SVG 延续登录品牌的静态安全检查：禁止脚本、事件属性、外链、相对请求、`@import`；MIME
  必须与扩展名一一对应。
- 快照是匿名可读的公开外观数据，不得包含用户数据、权限结果、Token、内部文件路径或密钥。

## 示例插件与所有权

示例品牌插件首轮可以复用既有 `brand.appName`、compact Logo 与 `login.subtitle`；正式 v2
冻结后再声明 `uiContributions.workbench`。插件只提供 manifest 与包内资源，不能写 Host
数据库、生成快照、执行认证逻辑或复制 Host 安装器。

## 验收门禁

- Host 默认、活动品牌、损坏候选、安全模式和卸载活动品牌五种状态均直接得到完整一致品牌；
- 保存后只发生一次原子 revision 切换，冷/热启动不逐页访问数据库；
- 多管理员竞争以数据库 winner 为准，静态 `current.json` 最终与 winner 一致；
- 明暗主题、宽窄屏、首次加载与路由切换无 Logo/标题替换闪烁；
- 快照损坏、资源缺失和 Node 重启均回退 last-known-good 或内置 Host 默认；
- 日志只记录 moduleId、revision 与安全状态，不输出文本内容、文件绝对路径或资源字节。
