# Phoenix 工作台品牌二元快照实施清单

> 正式规则以《Phoenix 品牌二元快照契约》为准。此前 v3 按字段来源草案已经废止，不得继续作为
> 实现或测试真源。

## 必须保留

- [ ] Vue mount 前 bootstrap 与同一 revision 多消费者；
- [ ] Host 文本/SVG 安全校验和内容寻址资源收据；
- [ ] 临时文件、fsync、原子替换和 last-known-good；
- [ ] Host 配置与品牌选择 revision/CAS；
- [ ] 损坏候选失败关闭；
- [ ] 插件 runtime 不修改品牌 DOM 或 document head。

## 必须替换

- [ ] 删除 manifest v3 hostBindings 校验与类型；
- [ ] 删除 snapshot effectiveSources 与按字段编译；
- [ ] 恢复 v1/v2 完整静态插件品牌；
- [ ] 插件活动时 Host 保存只更新备用配置，不重新编译插件快照；
- [ ] 设置页只展示完整 Host 或完整插件来源。

## Host 保存

- [ ] Host 模式保存后立即原子发布，无需 API/Web 重启；
- [ ] 新开、刷新和重登页面使用新 revision；
- [ ] 已打开 SPA 保持启动时 revision，刷新后切换；
- [ ] 插件模式保存只更新 Host 配置，公开插件 revision 不变；
- [ ] 并发冲突返回数据库 winner。

## 联合门禁

- [ ] Host 内置、Host 自定义、活动插件三种完整快照；
- [ ] Host 保存后的预览、刷新、重新登录与 Node/Web 重启；
- [ ] 插件活动期间 Host 备用保存不改变公开 revision；
- [ ] Host → Acme、Acme 更新、Acme → Host；
- [ ] manifest/资源损坏、快照损坏和过期 CAS；
- [ ] 无 DOM observer、localStorage 权威状态或复制认证逻辑。

## 实施边界

- [ ] 先在 Admin 进行中 worktree 与 9400/8401 测试组验证；
- [ ] 只启用/停用已有 Acme 开发挂载，不执行产品安装、DDL 或数据库重置；
- [ ] 不触碰 Admin 主工作树用户 dirty 文件；
- [ ] 三仓各自收口为一个当前时间的未推送节点，通过后再更新 develop；
- [ ] 不 push、不 tag。
