import { randomUUID } from 'crypto';
import { BaseService, CoolCommException } from '@cool-midway/core';
import { Inject, Provide } from '@midwayjs/core';
import { InjectDataSource, InjectEntityModel } from '@midwayjs/typeorm';
import { Context } from '@midwayjs/koa';
import { DataSource, EntityManager, Equal, Repository } from 'typeorm';
import { BaseSysMenuService } from '../../base/service/sys/menu';
import { PahFileAuditRecordEntity } from '../entity/file-audit-record';
import { PahFileBindingEntity } from '../entity/file-binding';
import { PahFileDescriptorEntity } from '../entity/file-descriptor';
import { PahPluginInstallationEntity } from '../entity/plugin';
import {
  PahFileBindingV1,
  PahFileDescriptorV1,
  PahFilesCapabilityKind,
  pahFilesCapabilityId,
} from '../interface/files';
import {
  PahHostFilesPortError,
  PahResolveActiveFileBindingInputV1,
  PahResolveActiveFileDescriptorInputV1,
} from '../port/files';
import { PahFileProviderRegistry } from '../provider/file';
import {
  canPreviewPahFileMime,
  inspectPahUpload,
  safePahFileName,
} from './files-inspection';

interface UploadedFile {
  data?: string;
  filename?: string;
}

type SafeAuditDetail = Record<string, string | number | boolean | null>;

const MODULE_ID = /^[a-z][a-z0-9-]{0,127}$/u;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

function safeText(
  value: unknown,
  label: string,
  maximum: number,
  required = true
) {
  const normalized =
    typeof value === 'string' ? value.trim().normalize('NFC') : '';
  if (
    (required && !normalized) ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new CoolCommException(
      `${label}必须是${required ? ' 1～' : ' 0～'}${maximum} 字安全文本`
    );
  }
  return normalized || null;
}

function safeInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new CoolCommException(`${label}不合法`);
  }
  return parsed;
}

function safeBoolean(value: unknown, label: string) {
  if (typeof value !== 'boolean')
    throw new CoolCommException(`${label}必须是布尔值`);
  return value;
}

function safeUuid(value: unknown, label: string) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new CoolCommException(`${label}不合法`);
  }
  return value.toLowerCase();
}

function safeAttributes(value: unknown) {
  if (value === undefined || value === null) return {};
  if (
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new CoolCommException('文件绑定 attributes 必须是普通对象');
  }
  const entries = Object.entries(value);
  if (entries.length > 20) {
    throw new CoolCommException('文件绑定 attributes 最多 20 项');
  }
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of entries.sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (!/^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/u.test(key)) {
      throw new CoolCommException(`文件绑定 attribute key 不安全：${key}`);
    }
    if (
      item !== null &&
      typeof item !== 'string' &&
      typeof item !== 'number' &&
      typeof item !== 'boolean'
    ) {
      throw new CoolCommException(`文件绑定 attribute value 不受支持：${key}`);
    }
    if (typeof item === 'string' && item.length > 256) {
      throw new CoolCommException(`文件绑定 attribute value 过长：${key}`);
    }
    if (typeof item === 'number' && !Number.isFinite(item)) {
      throw new CoolCommException(
        `文件绑定 attribute value 不是有限数值：${key}`
      );
    }
    result[key] = item;
  }
  return result;
}

function timeText(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : '';
}

function descriptorDto(entity: PahFileDescriptorEntity): PahFileDescriptorV1 {
  return {
    schemaVersion: 1,
    fileId: entity.fileId,
    version: entity.version,
    sha256: entity.sha256,
    mime: entity.mime,
    originalName: entity.originalName,
    size: Number(entity.size),
    providerId: entity.providerId,
    storageIdentity: entity.storageIdentity,
    status: entity.status,
    ownerModuleId: entity.ownerModuleId,
    createdBy: entity.createdBy,
    createdAt: timeText(entity.createTime),
    updatedBy: entity.updatedBy,
    updatedAt: timeText(entity.updateTime),
    deletedBy: entity.deletedBy,
    deletedAt: entity.deletedAt,
  };
}

function bindingDto(entity: PahFileBindingEntity): PahFileBindingV1 {
  return {
    schemaVersion: 1,
    bindingId: entity.bindingId,
    ownerModuleId: entity.ownerModuleId,
    resourceType: entity.resourceType,
    resourceKey: entity.resourceKey,
    fileId: entity.fileId,
    fileVersion: entity.fileVersion,
    relationType: entity.relationType,
    alias: entity.alias,
    note: entity.note,
    attributes: entity.attributes || {},
    sortOrder: entity.sortOrder,
    isPrimary: entity.isPrimary,
    status: entity.status,
    createdBy: entity.createdBy,
    createdAt: timeText(entity.createTime),
    updatedBy: entity.updatedBy,
    updatedAt: timeText(entity.updateTime),
    unboundBy: entity.unboundBy,
    unboundAt: entity.unboundAt,
  };
}

@Provide()
export class PahFilesService extends BaseService {
  @Inject()
  ctx: Context;

  @InjectDataSource()
  dataSource: DataSource;

  @InjectEntityModel(PahPluginInstallationEntity)
  pluginInstallationEntity: Repository<PahPluginInstallationEntity>;

  @InjectEntityModel(PahFileDescriptorEntity)
  fileDescriptorEntity: Repository<PahFileDescriptorEntity>;

  @InjectEntityModel(PahFileBindingEntity)
  fileBindingEntity: Repository<PahFileBindingEntity>;

  @InjectEntityModel(PahFileAuditRecordEntity)
  fileAuditRecordEntity: Repository<PahFileAuditRecordEntity>;

  @Inject()
  baseSysMenuService: BaseSysMenuService;

  @Inject()
  providerRegistry: PahFileProviderRegistry;

  private actorId() {
    const value = Number(this.ctx.admin?.userId);
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new CoolCommException('Host Files 缺少有效登录身份', 401);
    }
    return value;
  }

  private correlationId() {
    const header = this.ctx.get?.('X-Request-ID');
    return typeof header === 'string' &&
      /^[a-zA-Z0-9._:-]{1,128}$/u.test(header)
      ? header
      : randomUUID();
  }

  private async requireAccess(
    ownerModuleId: string,
    kind: PahFilesCapabilityKind
  ) {
    if (!MODULE_ID.test(ownerModuleId)) {
      throw new CoolCommException('Host Files ownerModuleId 不合法');
    }
    const actorId = this.actorId();
    const correlationId = this.correlationId();
    const installation = await this.pluginInstallationEntity.findOne({
      where: { moduleId: Equal(ownerModuleId) },
    });
    if (
      !installation ||
      installation.state !== 'enabled' ||
      !Array.isArray(installation.manifest?.hostReuse) ||
      !installation.manifest.hostReuse.includes('files')
    ) {
      await this.auditDenied(
        ownerModuleId,
        `${kind}:access`,
        actorId,
        { reason: 'plugin-files-disabled' },
        correlationId
      );
      throw new CoolCommException('目标插件未启用 Host Files 能力', 403);
    }
    const capabilityId = pahFilesCapabilityId(ownerModuleId, kind);
    if (
      !Array.isArray(installation.manifest?.capabilities) ||
      !installation.manifest.capabilities.some(item => item.id === capabilityId)
    ) {
      await this.auditDenied(
        ownerModuleId,
        `${kind}:access`,
        actorId,
        { reason: 'capability-undeclared' },
        correlationId
      );
      throw new CoolCommException(
        `目标插件未声明 Files capability：${capabilityId}`,
        403
      );
    }
    if (this.ctx.admin?.username !== 'admin') {
      const roleIds = Array.isArray(this.ctx.admin?.roleIds)
        ? this.ctx.admin.roleIds.map(Number).filter(Number.isSafeInteger)
        : [];
      const permissions = await this.baseSysMenuService.getPerms(roleIds);
      if (!permissions.includes(capabilityId)) {
        await this.auditDenied(
          ownerModuleId,
          `${kind}:access`,
          actorId,
          { capabilityId, reason: 'role-permission-missing' },
          correlationId
        );
        throw new CoolCommException('没有目标插件的 Host Files 权限', 403);
      }
    }
    return { actorId, correlationId, capabilityId };
  }

  private auditEntity(
    ownerModuleId: string,
    action: string,
    result: 'success' | 'denied' | 'failed',
    actorId: number,
    correlationId: string,
    detail: SafeAuditDetail,
    fileId: string | null = null,
    bindingId: string | null = null
  ) {
    return {
      auditId: randomUUID(),
      ownerModuleId,
      action,
      result,
      actorId,
      correlationId,
      fileId,
      bindingId,
      detail,
    };
  }

  private async auditDenied(
    ownerModuleId: string,
    action: string,
    actorId: number,
    detail: SafeAuditDetail,
    correlationId = this.correlationId()
  ) {
    await this.fileAuditRecordEntity.save(
      this.auditEntity(
        ownerModuleId,
        action,
        'denied',
        actorId,
        correlationId,
        detail
      )
    );
  }

  private async auditRead(
    ownerModuleId: string,
    action: string,
    actorId: number,
    correlationId: string,
    detail: SafeAuditDetail,
    fileId: string | null = null,
    bindingId: string | null = null
  ) {
    await this.fileAuditRecordEntity.save(
      this.auditEntity(
        ownerModuleId,
        action,
        'success',
        actorId,
        correlationId,
        detail,
        fileId,
        bindingId
      )
    );
  }

  private async mutation<T>(
    ownerModuleId: string,
    action: string,
    access: { actorId: number; correlationId: string },
    work: () => Promise<T>,
    refs: { fileId?: string; bindingId?: string } = {}
  ) {
    try {
      return await work();
    } catch (error) {
      await this.fileAuditRecordEntity.save(
        this.auditEntity(
          ownerModuleId,
          action,
          'failed',
          access.actorId,
          access.correlationId,
          {
            reason:
              error instanceof CoolCommException
                ? 'request-rejected'
                : 'internal-error',
          },
          refs.fileId || null,
          refs.bindingId || null
        )
      );
      throw error;
    }
  }

  private async fileForOwner(
    repository: Repository<PahFileDescriptorEntity>,
    ownerModuleId: string,
    fileId: string
  ) {
    const file = await repository.findOne({
      where: { ownerModuleId: Equal(ownerModuleId), fileId: Equal(fileId) },
    });
    if (!file) throw new CoolCommException('Host 文件不存在');
    return file;
  }

  async upload(ownerModuleId: string, upload: UploadedFile) {
    const access = await this.requireAccess(ownerModuleId, 'write');
    return this.mutation(ownerModuleId, 'file.upload', access, async () => {
      if (!upload?.data || !upload.filename) {
        throw new CoolCommException('未收到有效上传文件');
      }
      const originalName = safePahFileName(upload.filename);
      const inspection = await inspectPahUpload(upload.data);
      const provider = this.providerRegistry.defaultProvider();
      const stored = await provider.put(
        upload.data,
        inspection.sha256,
        inspection.size
      );
      const fileId = randomUUID();
      const result = await this.dataSource.transaction(async manager => {
        const repository = manager.getRepository(PahFileDescriptorEntity);
        const file = await repository.save({
          fileId,
          version: 1,
          sha256: inspection.sha256,
          mime: inspection.mime,
          originalName,
          size: String(inspection.size),
          providerId: stored.providerId,
          storageIdentity: stored.storageIdentity,
          storageKey: stored.storageKey,
          status: 'active',
          ownerModuleId,
          createdBy: access.actorId,
          updatedBy: null,
          deletedBy: null,
          deletedAt: null,
        });
        await manager.getRepository(PahFileAuditRecordEntity).save(
          this.auditEntity(
            ownerModuleId,
            'file.upload',
            'success',
            access.actorId,
            access.correlationId,
            {
              mime: inspection.mime,
              size: inspection.size,
              storageDeduplicated: stored.deduplicated,
            },
            fileId
          )
        );
        return file;
      });
      let providerReconcilePending = false;
      try {
        await provider.commitWrite(stored.writeReceiptId);
      } catch {
        providerReconcilePending = true;
        await this.fileAuditRecordEntity.save(
          this.auditEntity(
            ownerModuleId,
            'file.upload.provider-reconcile',
            'failed',
            access.actorId,
            access.correlationId,
            { reason: 'write-receipt-finalize-failed' },
            fileId
          )
        );
      }
      return {
        descriptor: descriptorDto(result),
        storageDeduplicated: stored.deduplicated,
        providerReconcilePending,
        correlationId: access.correlationId,
      };
    });
  }

  async listFiles(
    ownerModuleId: string,
    query: { status?: unknown; page?: unknown; size?: unknown }
  ) {
    const access = await this.requireAccess(ownerModuleId, 'read');
    const status = query.status === 'deleted' ? 'deleted' : 'active';
    const page = safeInteger(query.page ?? 1, 'page', 1, 1_000_000);
    const size = safeInteger(query.size ?? 20, 'size', 1, 100);
    const [rows, total] = await this.fileDescriptorEntity.findAndCount({
      where: { ownerModuleId: Equal(ownerModuleId), status },
      order: { id: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });
    await this.auditRead(
      ownerModuleId,
      'file.list',
      access.actorId,
      access.correlationId,
      { status, page, size, resultCount: rows.length }
    );
    return {
      list: rows.map(descriptorDto),
      pagination: { page, size, total },
      correlationId: access.correlationId,
    };
  }

  async fileInfo(ownerModuleId: string, fileIdInput: string) {
    const access = await this.requireAccess(ownerModuleId, 'read');
    const fileId = safeUuid(fileIdInput, 'fileId');
    const file = await this.fileForOwner(
      this.fileDescriptorEntity,
      ownerModuleId,
      fileId
    );
    await this.auditRead(
      ownerModuleId,
      'file.info',
      access.actorId,
      access.correlationId,
      { status: file.status },
      fileId
    );
    return {
      descriptor: descriptorDto(file),
      correlationId: access.correlationId,
    };
  }

  async resolveActiveDescriptorForPort(
    input: PahResolveActiveFileDescriptorInputV1
  ) {
    const { ownerModuleId, fileId, expectedVersion } = input;
    const access = await this.requireAccess(ownerModuleId, 'read');
    let file: PahFileDescriptorEntity | null;
    try {
      file = await this.fileDescriptorEntity.findOne({
        where: {
          ownerModuleId: Equal(ownerModuleId),
          fileId: Equal(fileId),
        },
      });
    } catch (error) {
      await this.fileAuditRecordEntity.save(
        this.auditEntity(
          ownerModuleId,
          'file.resolve-active',
          'failed',
          access.actorId,
          access.correlationId,
          { reason: 'descriptor-read-failed' },
          fileId
        )
      );
      throw error;
    }
    if (!file) {
      await this.fileAuditRecordEntity.save(
        this.auditEntity(
          ownerModuleId,
          'file.resolve-active',
          'failed',
          access.actorId,
          access.correlationId,
          { reason: 'file-not-found' },
          fileId
        )
      );
      throw new PahHostFilesPortError('NOT_FOUND', 'Host 文件不存在', 404);
    }
    if (file.status !== 'active') {
      await this.fileAuditRecordEntity.save(
        this.auditEntity(
          ownerModuleId,
          'file.resolve-active',
          'denied',
          access.actorId,
          access.correlationId,
          { reason: 'file-inactive' },
          fileId
        )
      );
      throw new PahHostFilesPortError(
        'INACTIVE',
        'Host 文件不是活动描述符',
        409
      );
    }
    if (expectedVersion !== undefined && file.version !== expectedVersion) {
      await this.fileAuditRecordEntity.save(
        this.auditEntity(
          ownerModuleId,
          'file.resolve-active',
          'failed',
          access.actorId,
          access.correlationId,
          {
            reason: 'descriptor-version-conflict',
            expectedVersion,
            actualVersion: file.version,
          },
          fileId
        )
      );
      throw new PahHostFilesPortError(
        'VERSION_CONFLICT',
        'Host 文件描述符版本不一致',
        409
      );
    }
    const descriptor = Object.freeze({
      fileId: file.fileId,
      version: file.version,
      sha256: file.sha256,
      originalName: file.originalName,
      mime: file.mime,
      size: Number(file.size),
      ownerModuleId: file.ownerModuleId,
    });
    await this.auditRead(
      ownerModuleId,
      'file.resolve-active',
      access.actorId,
      access.correlationId,
      { version: file.version, mime: file.mime, size: Number(file.size) },
      fileId
    );
    return descriptor;
  }

  async resolveActiveBindingForPort(input: PahResolveActiveFileBindingInputV1) {
    const { ownerModuleId, bindingId } = input;
    const access = await this.requireAccess(ownerModuleId, 'read');
    let binding: PahFileBindingEntity | null;
    try {
      binding = await this.fileBindingEntity.findOne({
        where: {
          ownerModuleId: Equal(ownerModuleId),
          bindingId: Equal(bindingId),
        },
      });
    } catch (error) {
      await this.fileAuditRecordEntity.save(
        this.auditEntity(
          ownerModuleId,
          'binding.resolve-active',
          'failed',
          access.actorId,
          access.correlationId,
          { reason: 'binding-read-failed' },
          null,
          bindingId
        )
      );
      throw error;
    }
    if (!binding) {
      await this.fileAuditRecordEntity.save(
        this.auditEntity(
          ownerModuleId,
          'binding.resolve-active',
          'failed',
          access.actorId,
          access.correlationId,
          { reason: 'binding-not-found' },
          null,
          bindingId
        )
      );
      throw new PahHostFilesPortError('NOT_FOUND', 'Host 文件绑定不存在', 404);
    }
    if (binding.status !== 'active') {
      await this.fileAuditRecordEntity.save(
        this.auditEntity(
          ownerModuleId,
          'binding.resolve-active',
          'denied',
          access.actorId,
          access.correlationId,
          { reason: 'binding-inactive' },
          binding.fileId,
          bindingId
        )
      );
      throw new PahHostFilesPortError(
        'INACTIVE',
        'Host 文件绑定不是活动状态',
        409
      );
    }
    let file: PahFileDescriptorEntity | null;
    try {
      file = await this.fileDescriptorEntity.findOne({
        where: {
          ownerModuleId: Equal(ownerModuleId),
          fileId: Equal(binding.fileId),
        },
      });
    } catch (error) {
      await this.fileAuditRecordEntity.save(
        this.auditEntity(
          ownerModuleId,
          'binding.resolve-active',
          'failed',
          access.actorId,
          access.correlationId,
          { reason: 'descriptor-read-failed' },
          binding.fileId,
          bindingId
        )
      );
      throw error;
    }
    if (!file) {
      await this.fileAuditRecordEntity.save(
        this.auditEntity(
          ownerModuleId,
          'binding.resolve-active',
          'failed',
          access.actorId,
          access.correlationId,
          { reason: 'binding-file-not-found' },
          binding.fileId,
          bindingId
        )
      );
      throw new PahHostFilesPortError('NOT_FOUND', 'Host 文件不存在', 404);
    }
    if (file.status !== 'active') {
      await this.fileAuditRecordEntity.save(
        this.auditEntity(
          ownerModuleId,
          'binding.resolve-active',
          'denied',
          access.actorId,
          access.correlationId,
          { reason: 'binding-file-inactive' },
          binding.fileId,
          bindingId
        )
      );
      throw new PahHostFilesPortError(
        'INACTIVE',
        'Host 文件不是活动描述符',
        409
      );
    }
    if (binding.fileVersion !== file.version) {
      await this.fileAuditRecordEntity.save(
        this.auditEntity(
          ownerModuleId,
          'binding.resolve-active',
          'failed',
          access.actorId,
          access.correlationId,
          {
            reason: 'binding-file-version-conflict',
            bindingFileVersion: binding.fileVersion,
            descriptorVersion: file.version,
          },
          binding.fileId,
          bindingId
        )
      );
      throw new PahHostFilesPortError(
        'VERSION_CONFLICT',
        'Host 文件绑定版本与描述符不一致',
        409
      );
    }
    const result = Object.freeze({
      bindingId: binding.bindingId,
      resourceType: binding.resourceType,
      resourceKey: binding.resourceKey,
      relationType: binding.relationType,
      fileId: binding.fileId,
      fileVersion: binding.fileVersion,
    });
    await this.auditRead(
      ownerModuleId,
      'binding.resolve-active',
      access.actorId,
      access.correlationId,
      {
        resourceType: binding.resourceType,
        relationType: binding.relationType,
        fileVersion: binding.fileVersion,
      },
      binding.fileId,
      bindingId
    );
    return result;
  }

  async content(
    ownerModuleId: string,
    fileIdInput: string,
    dispositionInput: unknown
  ) {
    const access = await this.requireAccess(ownerModuleId, 'read');
    const fileId = safeUuid(fileIdInput, 'fileId');
    const file = await this.fileForOwner(
      this.fileDescriptorEntity,
      ownerModuleId,
      fileId
    );
    if (file.status !== 'active')
      throw new CoolCommException('Host 文件已删除');
    const requested = dispositionInput === 'preview' ? 'preview' : 'download';
    const disposition =
      requested === 'preview' && canPreviewPahFileMime(file.mime)
        ? 'inline'
        : 'attachment';
    const stream = await this.providerRegistry
      .resolve(file.providerId)
      .open(file.storageKey, file.sha256, Number(file.size));
    await this.auditRead(
      ownerModuleId,
      disposition === 'inline' ? 'file.preview' : 'file.download',
      access.actorId,
      access.correlationId,
      { mime: file.mime, size: Number(file.size) },
      fileId
    );
    return {
      descriptor: descriptorDto(file),
      stream,
      disposition,
      correlationId: access.correlationId,
    };
  }

  async updateFile(ownerModuleId: string, fileIdInput: string, input: any) {
    const access = await this.requireAccess(ownerModuleId, 'write');
    const fileId = safeUuid(fileIdInput, 'fileId');
    const originalName = safePahFileName(input?.originalName);
    const file = await this.mutation(
      ownerModuleId,
      'file.update',
      access,
      () =>
        this.dataSource.transaction(async manager => {
          const repository = manager.getRepository(PahFileDescriptorEntity);
          const current = await this.lockedFile(manager, ownerModuleId, fileId);
          if (current.status !== 'active') {
            throw new CoolCommException('Host 文件已删除');
          }
          current.originalName = originalName;
          current.version += 1;
          current.updatedBy = access.actorId;
          const saved = await repository.save(current);
          await manager
            .getRepository(PahFileAuditRecordEntity)
            .save(
              this.auditEntity(
                ownerModuleId,
                'file.update',
                'success',
                access.actorId,
                access.correlationId,
                { version: saved.version },
                fileId
              )
            );
          return saved;
        }),
      { fileId }
    );
    return {
      descriptor: descriptorDto(file),
      correlationId: access.correlationId,
    };
  }

  private async lockedFile(
    manager: EntityManager,
    ownerModuleId: string,
    fileId: string
  ) {
    const file = await manager
      .getRepository(PahFileDescriptorEntity)
      .createQueryBuilder('file')
      .setLock('pessimistic_write')
      .where('file."ownerModuleId" = :ownerModuleId', { ownerModuleId })
      .andWhere('file."fileId" = :fileId', { fileId })
      .getOne();
    if (!file) throw new CoolCommException('Host 文件不存在');
    return file;
  }

  async deleteFile(ownerModuleId: string, fileIdInput: string) {
    return this.changeFileStatus(ownerModuleId, fileIdInput, 'deleted');
  }

  async restoreFile(ownerModuleId: string, fileIdInput: string) {
    return this.changeFileStatus(ownerModuleId, fileIdInput, 'active');
  }

  private async changeFileStatus(
    ownerModuleId: string,
    fileIdInput: string,
    target: 'active' | 'deleted'
  ) {
    const access = await this.requireAccess(ownerModuleId, 'admin');
    const fileId = safeUuid(fileIdInput, 'fileId');
    const action = target === 'deleted' ? 'file.delete' : 'file.restore';
    const file = await this.mutation(
      ownerModuleId,
      action,
      access,
      () =>
        this.dataSource.transaction(async manager => {
          const current = await this.lockedFile(manager, ownerModuleId, fileId);
          if (current.status === target) {
            await manager
              .getRepository(PahFileAuditRecordEntity)
              .save(
                this.auditEntity(
                  ownerModuleId,
                  `${action}.noop`,
                  'success',
                  access.actorId,
                  access.correlationId,
                  { version: current.version },
                  fileId
                )
              );
            return current;
          }
          if (target === 'deleted') {
            const activeBindings = await manager
              .getRepository(PahFileBindingEntity)
              .count({
                where: {
                  ownerModuleId: Equal(ownerModuleId),
                  fileId: Equal(fileId),
                  status: 'active',
                },
              });
            if (activeBindings > 0) {
              throw new CoolCommException(
                '存在活动业务绑定，不能删除 Host 文件'
              );
            }
          }
          current.status = target;
          current.version += 1;
          current.updatedBy = access.actorId;
          current.deletedBy = target === 'deleted' ? access.actorId : null;
          current.deletedAt =
            target === 'deleted' ? new Date().toISOString() : null;
          const saved = await manager
            .getRepository(PahFileDescriptorEntity)
            .save(current);
          await manager
            .getRepository(PahFileAuditRecordEntity)
            .save(
              this.auditEntity(
                ownerModuleId,
                action,
                'success',
                access.actorId,
                access.correlationId,
                { version: saved.version },
                fileId
              )
            );
          return saved;
        }),
      { fileId }
    );
    return {
      descriptor: descriptorDto(file),
      correlationId: access.correlationId,
    };
  }

  async listBindings(
    ownerModuleId: string,
    query: { resourceType?: unknown; resourceKey?: unknown; status?: unknown }
  ) {
    const access = await this.requireAccess(ownerModuleId, 'read');
    const resourceType = safeText(
      query.resourceType,
      'resourceType',
      128
    ) as string;
    const resourceKey = safeText(
      query.resourceKey,
      'resourceKey',
      255
    ) as string;
    const status = query.status === 'unbound' ? 'unbound' : 'active';
    const rows = await this.fileBindingEntity.find({
      where: {
        ownerModuleId: Equal(ownerModuleId),
        resourceType: Equal(resourceType),
        resourceKey: Equal(resourceKey),
        status,
      },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
    await this.auditRead(
      ownerModuleId,
      'binding.list',
      access.actorId,
      access.correlationId,
      { resourceType, resourceKey, status, resultCount: rows.length }
    );
    return { list: rows.map(bindingDto), correlationId: access.correlationId };
  }

  async createBinding(ownerModuleId: string, input: any) {
    const access = await this.requireAccess(ownerModuleId, 'write');
    const payload = this.bindingInput(input);
    const binding = await this.mutation(
      ownerModuleId,
      'binding.create',
      access,
      () =>
        this.dataSource.transaction(async manager => {
          const repository = manager.getRepository(PahFileBindingEntity);
          const existing = await repository.findOne({
            where: {
              ownerModuleId: Equal(ownerModuleId),
              idempotencyKey: Equal(payload.idempotencyKey),
            },
          });
          if (existing) {
            const same =
              existing.fileId === payload.fileId &&
              existing.resourceType === payload.resourceType &&
              existing.resourceKey === payload.resourceKey &&
              existing.relationType === payload.relationType &&
              existing.alias === payload.alias &&
              existing.note === payload.note &&
              JSON.stringify(existing.attributes || {}) ===
                JSON.stringify(payload.attributes) &&
              existing.sortOrder === payload.sortOrder &&
              existing.isPrimary === payload.isPrimary;
            if (!same) {
              throw new CoolCommException('绑定幂等键已用于不同请求');
            }
            await manager
              .getRepository(PahFileAuditRecordEntity)
              .save(
                this.auditEntity(
                  ownerModuleId,
                  'binding.create.replay',
                  'success',
                  access.actorId,
                  access.correlationId,
                  { idempotentReplay: true },
                  existing.fileId,
                  existing.bindingId
                )
              );
            return existing;
          }
          const file = await this.lockedFile(
            manager,
            ownerModuleId,
            payload.fileId
          );
          if (file.status !== 'active') {
            throw new CoolCommException('Host 文件已删除');
          }
          if (payload.isPrimary) {
            await this.clearPrimary(manager, ownerModuleId, payload);
          }
          const saved = await repository.save({
            bindingId: randomUUID(),
            ownerModuleId,
            ...payload,
            fileVersion: file.version,
            status: 'active',
            createdBy: access.actorId,
            updatedBy: null,
            unboundBy: null,
            unboundAt: null,
          });
          await manager.getRepository(PahFileAuditRecordEntity).save(
            this.auditEntity(
              ownerModuleId,
              'binding.create',
              'success',
              access.actorId,
              access.correlationId,
              {
                resourceType: payload.resourceType,
                relationType: payload.relationType,
                isPrimary: payload.isPrimary,
              },
              payload.fileId,
              saved.bindingId
            )
          );
          return saved;
        })
    );
    return {
      binding: bindingDto(binding),
      correlationId: access.correlationId,
    };
  }

  private bindingInput(input: any) {
    return {
      fileId: safeUuid(input?.fileId, 'fileId'),
      resourceType: safeText(
        input?.resourceType,
        'resourceType',
        128
      ) as string,
      resourceKey: safeText(input?.resourceKey, 'resourceKey', 255) as string,
      relationType: safeText(input?.relationType, 'relationType', 64) as string,
      alias:
        input?.alias === undefined
          ? null
          : safeText(input.alias, 'alias', 255, false),
      note:
        input?.note === undefined
          ? null
          : safeText(input.note, 'note', 2000, false),
      attributes: safeAttributes(input?.attributes),
      sortOrder: safeInteger(
        input?.sortOrder ?? 0,
        'sortOrder',
        -1_000_000,
        1_000_000
      ),
      isPrimary: safeBoolean(input?.isPrimary ?? false, 'isPrimary'),
      idempotencyKey: safeText(
        input?.idempotencyKey,
        'idempotencyKey',
        128
      ) as string,
    };
  }

  private bindingUpdateInput(input: any) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new CoolCommException('文件绑定更新必须是对象');
    }
    const updates: Partial<
      Pick<
        PahFileBindingEntity,
        'alias' | 'note' | 'attributes' | 'sortOrder' | 'isPrimary'
      >
    > = {};
    if (Object.prototype.hasOwnProperty.call(input, 'alias')) {
      updates.alias = safeText(input.alias, 'alias', 255, false);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'note')) {
      updates.note = safeText(input.note, 'note', 2000, false);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'attributes')) {
      updates.attributes = safeAttributes(input.attributes);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'sortOrder')) {
      updates.sortOrder = safeInteger(
        input.sortOrder,
        'sortOrder',
        -1_000_000,
        1_000_000
      );
    }
    if (Object.prototype.hasOwnProperty.call(input, 'isPrimary')) {
      updates.isPrimary = safeBoolean(input.isPrimary, 'isPrimary');
    }
    if (Object.keys(updates).length === 0) {
      throw new CoolCommException('文件绑定更新没有可修改字段');
    }
    return updates;
  }

  private async clearPrimary(
    manager: EntityManager,
    ownerModuleId: string,
    input: {
      resourceType: string;
      resourceKey: string;
      relationType: string;
    },
    exceptBindingId?: string
  ) {
    const query = manager
      .getRepository(PahFileBindingEntity)
      .createQueryBuilder()
      .update()
      .set({ isPrimary: false })
      .where('"ownerModuleId" = :ownerModuleId', { ownerModuleId })
      .andWhere('"resourceType" = :resourceType', input)
      .andWhere('"resourceKey" = :resourceKey', input)
      .andWhere('"relationType" = :relationType', input)
      .andWhere('status = :status', { status: 'active' })
      .andWhere('"isPrimary" = true');
    if (exceptBindingId) {
      query.andWhere('"bindingId" <> :exceptBindingId', { exceptBindingId });
    }
    await query.execute();
  }

  private async lockedBinding(
    manager: EntityManager,
    ownerModuleId: string,
    bindingId: string
  ) {
    const binding = await manager
      .getRepository(PahFileBindingEntity)
      .createQueryBuilder('binding')
      .setLock('pessimistic_write')
      .where('binding."ownerModuleId" = :ownerModuleId', { ownerModuleId })
      .andWhere('binding."bindingId" = :bindingId', { bindingId })
      .getOne();
    if (!binding) throw new CoolCommException('Host 文件绑定不存在');
    return binding;
  }

  async updateBinding(
    ownerModuleId: string,
    bindingIdInput: string,
    input: any
  ) {
    const access = await this.requireAccess(ownerModuleId, 'write');
    const bindingId = safeUuid(bindingIdInput, 'bindingId');
    const updates = this.bindingUpdateInput(input);
    const binding = await this.mutation(
      ownerModuleId,
      'binding.update',
      access,
      () =>
        this.dataSource.transaction(async manager => {
          const current = await this.lockedBinding(
            manager,
            ownerModuleId,
            bindingId
          );
          if (current.status !== 'active') {
            throw new CoolCommException('Host 文件绑定已解绑');
          }
          if (updates.alias !== undefined) current.alias = updates.alias;
          if (updates.note !== undefined) current.note = updates.note;
          if (updates.attributes !== undefined) {
            current.attributes = updates.attributes;
          }
          if (updates.sortOrder !== undefined) {
            current.sortOrder = updates.sortOrder;
          }
          if (updates.isPrimary !== undefined) {
            current.isPrimary = updates.isPrimary;
          }
          current.updatedBy = access.actorId;
          if (current.isPrimary) {
            await this.clearPrimary(manager, ownerModuleId, current, bindingId);
          }
          const saved = await manager
            .getRepository(PahFileBindingEntity)
            .save(current);
          await manager
            .getRepository(PahFileAuditRecordEntity)
            .save(
              this.auditEntity(
                ownerModuleId,
                'binding.update',
                'success',
                access.actorId,
                access.correlationId,
                { isPrimary: saved.isPrimary, sortOrder: saved.sortOrder },
                saved.fileId,
                bindingId
              )
            );
          return saved;
        }),
      { bindingId }
    );
    return {
      binding: bindingDto(binding),
      correlationId: access.correlationId,
    };
  }

  async unbind(ownerModuleId: string, bindingIdInput: string) {
    return this.changeBindingStatus(ownerModuleId, bindingIdInput, 'unbound');
  }

  async restoreBinding(ownerModuleId: string, bindingIdInput: string) {
    return this.changeBindingStatus(ownerModuleId, bindingIdInput, 'active');
  }

  private async changeBindingStatus(
    ownerModuleId: string,
    bindingIdInput: string,
    target: 'active' | 'unbound'
  ) {
    const access = await this.requireAccess(ownerModuleId, 'write');
    const bindingId = safeUuid(bindingIdInput, 'bindingId');
    const action = target === 'unbound' ? 'binding.unbind' : 'binding.restore';
    const binding = await this.mutation(
      ownerModuleId,
      action,
      access,
      () =>
        this.dataSource.transaction(async manager => {
          const current = await this.lockedBinding(
            manager,
            ownerModuleId,
            bindingId
          );
          if (current.status === target) {
            await manager
              .getRepository(PahFileAuditRecordEntity)
              .save(
                this.auditEntity(
                  ownerModuleId,
                  `${action}.noop`,
                  'success',
                  access.actorId,
                  access.correlationId,
                  { status: target },
                  current.fileId,
                  bindingId
                )
              );
            return current;
          }
          if (target === 'active') {
            const file = await this.lockedFile(
              manager,
              ownerModuleId,
              current.fileId
            );
            if (file.status !== 'active') {
              throw new CoolCommException('Host 文件已删除');
            }
            current.fileVersion = file.version;
            if (current.isPrimary) {
              await this.clearPrimary(
                manager,
                ownerModuleId,
                current,
                bindingId
              );
            }
          }
          current.status = target;
          current.updatedBy = access.actorId;
          current.unboundBy = target === 'unbound' ? access.actorId : null;
          current.unboundAt =
            target === 'unbound' ? new Date().toISOString() : null;
          const saved = await manager
            .getRepository(PahFileBindingEntity)
            .save(current);
          await manager
            .getRepository(PahFileAuditRecordEntity)
            .save(
              this.auditEntity(
                ownerModuleId,
                action,
                'success',
                access.actorId,
                access.correlationId,
                { status: target },
                saved.fileId,
                bindingId
              )
            );
          return saved;
        }),
      { bindingId }
    );
    return {
      binding: bindingDto(binding),
      correlationId: access.correlationId,
    };
  }
}
