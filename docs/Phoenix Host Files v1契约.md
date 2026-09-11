# Phoenix Host Files v1 契约

## 目标与非目标

Files v1 是 Phoenix Admin Host 面向所有业务插件提供的通用文件能力。Host 拥有文件描述符、
认证内容读取、通用业务绑定、权限、审计和存储 Provider；插件只保存自己的业务数据以及
Host `fileId` / `bindingId` 引用。该契约不读取插件业务表，也不包含任何产品分支。

以下既有 Cool 能力不能冒充 Files v1：

- `/admin/base/comm/upload` 只返回旧上传插件结果，没有稳定描述符、owner、绑定和审计；
- 静态 `/upload` 是公开 URL，不具备逐请求身份与 capability 校验；
- `space_info` 保存 URL 和存储 key，缺少不可伪造的插件 owner 边界。

Files v1 首批不包含病毒扫描、对象存储签名 URL、断点续传、文件购物车、发放或业务导入任务。
这些能力以后只能通过 Provider 或新的 Host 契约扩展，不能由插件绕过 v1 自建公共静态目录。

## 描述符

`pah_file_descriptor` 保存以下 Host-owned 字段：

- `fileId`：Host 生成的 UUID，稳定且全局唯一；
- `version`：从 1 开始，任何元数据、删除或恢复变更都单调递增；
- `sha256`、服务端识别的 `mime`、`originalName`、`size`；
- `providerId` 与不泄露磁盘路径的 `storageIdentity`；
- 私有 `storageKey`，只允许 Provider 使用，任何 API 都不得返回；
- `status=active|deleted`、`ownerModuleId`、创建/更新/删除 actor 与时间。

SHA-256 必须由 Host 流式计算。客户端摘要只能作为上传前提示，不能作为权威值。v1 Provider
按内容 SHA 去重不可变 blob，但每次上传仍创建新的描述符；响应明确报告
`storageDeduplicated`，避免把存储去重误解为业务对象去重。

## 通用绑定

`pah_file_binding` 只保存 Host 可以理解的通用关系：

- `bindingId`、`ownerModuleId`；
- 不透明 `resourceType` / `resourceKey`；
- `fileId` / `fileVersion`；
- `relationType`、`alias`、`note`、有限 JSON `attributes`、`sortOrder`、`isPrimary`；
- `status=active|unbound`、幂等键、actor 与时间。

Host 不解析 `resourceType` / `resourceKey`，不查询插件表。解绑与删除是两个独立动作：存在活动
绑定时不能删除描述符；解绑不物理删除内容；恢复只恢复相应 Host 记录。插件若保存不可变业务
快照，是否允许最终物理清理由后续 retention 契约决定，v1 不提供物理删除 API。

## API 与权限

统一前缀为 `/admin/phoenix/files/:ownerModuleId`：

| capability | endpoint |
| --- | --- |
| `<moduleId>:files:read` | `GET /admin/phoenix/files/:ownerModuleId` |
| | `GET /admin/phoenix/files/:ownerModuleId/:fileId` |
| | `GET /admin/phoenix/files/:ownerModuleId/:fileId/content` |
| | `GET /admin/phoenix/files/:ownerModuleId/bindings` |
| `<moduleId>:files:write` | `POST /admin/phoenix/files/:ownerModuleId` |
| | `PATCH /admin/phoenix/files/:ownerModuleId/:fileId` |
| | `POST /admin/phoenix/files/:ownerModuleId/bindings` |
| | `PATCH /admin/phoenix/files/:ownerModuleId/bindings/:bindingId` |
| | `POST /admin/phoenix/files/:ownerModuleId/bindings/:bindingId/unbind` |
| | `POST /admin/phoenix/files/:ownerModuleId/bindings/:bindingId/restore` |
| `<moduleId>:files:admin` | `POST /admin/phoenix/files/:ownerModuleId/:fileId/delete` |
| | `POST /admin/phoenix/files/:ownerModuleId/:fileId/restore` |

`ownerModuleId` 只是定位参数，不是授权证明。每个请求还必须同时满足：

1. 已通过 Host 登录认证；
2. 目标插件已登记且 `state=enabled`；
3. manifest 声明 `hostReuse: ["files"]`；
4. manifest 声明对应语义 capability；
5. 当前角色持有该插件的语义 capability；
6. capability endpoint 只能使用 Host 固定目录，不能借此声明其他 Host 路径。

Cool 菜单权限先执行 endpoint 模板门禁，Files service 再按目标 owner 执行语义 capability 门禁，
从而避免用户持有插件 A 的公共 endpoint 后越权访问插件 B。root 管理员仍服从目标插件 enabled、
`hostReuse` 和 manifest 声明，只省略角色分配检查。

## Node 插件权威描述符端口

插件创建发放、归档或其他不可变业务快照时，不得信任浏览器提交的 `fileVersion`、SHA、MIME
或 size，也不得导入 `phoenix/service/files`、Provider、Repository 或实体。Host 提供稳定的 Node
端口：

- 公共契约：`src/modules/phoenix/port/files.ts`；
- DI token：`PAH_HOST_FILES_PORT`（值固定为 `pahHostFilesPortV1`）；
- 接口：`PahHostFilesPortV1.resolveActiveDescriptor(input)`；
- 输入仅允许 `ownerModuleId`、`fileId` 和可选 `expectedVersion`；未知字段 fail-closed；
- 输出只含 `fileId/version/sha256/originalName/mime/size/ownerModuleId`，对象运行时冻结；
- 端口重新执行登录身份、插件 enabled、`hostReuse: files`、manifest capability、角色、owner
  和审计门禁，并且只接受 `status=active` 的 Host 权威描述符。

需要冻结既有 Host binding 关系时，调用 `resolveActiveBinding({ ownerModuleId, bindingId })`。
输入不接受浏览器提供的 `resourceType/resourceKey/relationType/fileId/fileVersion`；Host 重新读取
active binding 与 active descriptor，强制二者 owner、fileId 和 version 一致，再只返回
`bindingId/resourceType/resourceKey/relationType/fileId/fileVersion` 的冻结对象。binding 已解绑、
文件已删除或版本漂移均 fail-closed，插件不得把客户端 binding 元数据回写为权威快照。

位于标准插件 `src/modules/<moduleId>/service/*.ts` 的消费示例：

```ts
import { Inject, Provide } from '@midwayjs/core';
import {
  PAH_HOST_FILES_PORT,
  PahHostFilesPortV1,
} from '../../phoenix/port/files';

@Provide()
export class ExampleDispatchService {
  @Inject(PAH_HOST_FILES_PORT)
  hostFiles: PahHostFilesPortV1;

  async resolveFile(input: { fileId: string; fileVersion?: number }) {
    return this.hostFiles.resolveActiveDescriptor({
      ownerModuleId: 'example-plugin',
      fileId: input.fileId,
      expectedVersion: input.fileVersion,
    });
  }

  async resolveBinding(bindingId: string) {
    return this.hostFiles.resolveActiveBinding({
      ownerModuleId: 'example-plugin',
      bindingId,
    });
  }
}
```

调用方只能保存返回 DTO 中的稳定业务快照；不能保存或推导 `storageIdentity`、provider、repository
或物理路径。错误使用 `PahHostFilesPortError` 的稳定 `code/statusCode`：

| code | statusCode | 语义 |
| --- | ---: | --- |
| `INVALID_ARGUMENT` | 400 | 输入形状、owner、fileId 或 expectedVersion 非法 |
| `UNAUTHENTICATED` | 401 | 缺少有效 Host actor |
| `ACCESS_DENIED` | 403 | 插件、hostReuse、capability、角色或 owner 门禁拒绝 |
| `NOT_FOUND` | 404 | 该 owner 下不存在文件或 binding |
| `INACTIVE` | 409 | 描述符或 binding 不是活动状态 |
| `VERSION_CONFLICT` | 409 | expectedVersion 不一致，或 binding 指向旧描述符版本 |
| `HOST_FAILURE` | 500 | Host 内部读取或审计失败；不向插件泄露内部错误或路径 |

该端口不新增 HTTP endpoint，不改变 Files v1 schema；浏览器仍只调用已有 Host Files HTTP API，
插件 Node 在业务写事务前使用端口重新解析权威描述符。

## 内容与 Provider

v1 默认 `local` Provider：

- 根目录由 Host 配置，目录 mode 0700、blob mode 0600；
- storage key 必须是 Host 生成的内容寻址相对路径，realpath 不得越界或经过 symlink；
- 写入使用同目录临时文件、fsync 和排他发布；已存在内容必须重新核对 size/SHA；
- Provider 在发布 blob 前先写入 0600 的 pending write receipt；描述符事务成功后才清退收据，
  因此数据库失败留下的内容寻址对象仍可由 Host reconcile/GC 追踪；
- 读取前重新核对普通文件、size 与 SHA，失败即拒绝，不返回损坏内容。

Provider 接口只暴露 `put` 和经过校验的 `open`。数据库描述符不保存公开 URL。后续对象存储
Provider 必须保持同一 owner、完整性和认证内容语义，不能把 bucket key 暴露给插件。

v1 上传上限为 Host 固定值，默认 32 MiB。服务端只接受已知二进制签名或有效 UTF-8 文本，
不信任浏览器 MIME。内联预览仅允许 Host 白名单；其他类型强制 attachment。所有内容响应都设置
`X-Content-Type-Options: nosniff`、私有 no-store 缓存和安全文件名。

## 审计与失败语义

`pah_file_audit_record` 保存 owner、action、actor、file/binding identity、结果、correlation ID
和有限 JSON detail；不得保存文件内容、token、口令、存储路径或任意请求体。成功的描述符/绑定
写入和审计在同一数据库事务中提交。Provider 写入成功但数据库事务失败时，pending write receipt
必须保留，不能产生不可追踪孤儿；描述符已提交但收据清退失败时响应标记
`providerReconcilePending=true` 并写入无秘密失败审计。客户端可安全重试，不伪造 ledger。

## Host schema 与空库基线

Files v1 新增三张 `pah_` Host 表，并通过新的 Pah Host schema migration 等幂发布。实体、SQL、
descriptor、required relations 和打包清单必须一一一致，普通启动继续保持
`synchronize=false`、`initialize=false`。

当前可执行空库 baseline v2 已由环境所有者在 PostgreSQL 16 精确空库生成并复核结构指纹，
同时包含：

- v1 的 29 张表；
- 4 张 external identity 表；
- 3 张 Files v1 表；
- 当前全部 Host schema artifacts；
- 受控空库实际生成的完整列/索引/约束/序列指纹和冻结 source commit。

活动 `host-baseline.json` 固定 schema v5 的六份自包含制品与 36 个 `requiredRelations`，离线门禁
逐项核对当前固定实体、SQL 表集合、size、SHA-256 和完整结构指纹。历史 v1、旧 assembly 及任何
旧业务插件 plan/receipt 均不得作为 v2 证据；已有隔离 Profile 必须重新建基线。
