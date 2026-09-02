import { DecoratorManager } from '@midwayjs/core';
import {
  PAH_FILES_CAPABILITY_ENDPOINTS,
  pahFilesCapabilityId,
} from '../../../src/modules/phoenix/interface/files';
import {
  PAH_HOST_FILES_PORT,
  PahHostFilesPortError,
} from '../../../src/modules/phoenix/port/files';
import { PahFilesService } from '../../../src/modules/phoenix/service/files';
import { PahHostFilesPortAdapter } from '../../../src/modules/phoenix/service/files-port';

const OWNER = 'example-plugin';
const FILE_ID = '11111111-1111-4111-8111-111111111111';
const BINDING_ID = '22222222-2222-4222-8222-222222222222';

function file(status: 'active' | 'deleted' = 'active') {
  return {
    fileId: FILE_ID,
    version: 3,
    sha256: 'a'.repeat(64),
    mime: 'application/json',
    originalName: 'fixture.json',
    size: '12',
    providerId: 'local',
    storageIdentity: `sha256:${'a'.repeat(64)}`,
    storageKey: 'aa/private-path',
    status,
    ownerModuleId: OWNER,
  };
}

function binding(status: 'active' | 'unbound' = 'active') {
  return {
    bindingId: BINDING_ID,
    ownerModuleId: OWNER,
    resourceType: 'manufacturing-order',
    resourceKey: 'order-7',
    fileId: FILE_ID,
    fileVersion: 3,
    relationType: 'dispatch-source',
    alias: 'browser-must-not-copy',
    note: 'private-note',
    attributes: { private: true },
    sortOrder: 1,
    isPrimary: true,
    status,
  };
}

function fixture(options: {
  descriptor?: ReturnType<typeof file> | null;
  binding?: ReturnType<typeof binding> | null;
  username?: string;
  permissions?: string[];
  findError?: Error;
} = {}) {
  const auditSave = jest.fn().mockResolvedValue(undefined);
  const findOne = options.findError
    ? jest.fn().mockRejectedValue(options.findError)
    : jest.fn().mockResolvedValue(
        options.descriptor === undefined ? file() : options.descriptor
      );
  const findBinding = jest.fn().mockResolvedValue(
    options.binding === undefined ? binding() : options.binding
  );
  const service = new PahFilesService();
  Object.assign(service, {
    ctx: {
      admin: {
        userId: 7,
        username: options.username ?? 'operator',
        roleIds: [2],
      },
      get: jest.fn().mockReturnValue('port-fixture'),
    },
    pluginInstallationEntity: {
      findOne: jest.fn().mockResolvedValue({
        moduleId: OWNER,
        state: 'enabled',
        manifest: {
          hostReuse: ['files'],
          capabilities: [
            {
              id: pahFilesCapabilityId(OWNER, 'read'),
              risk: 'read',
              endpoints: [...PAH_FILES_CAPABILITY_ENDPOINTS.read],
            },
          ],
        },
      }),
    },
    baseSysMenuService: {
      getPerms: jest.fn().mockResolvedValue(
        options.permissions ?? [pahFilesCapabilityId(OWNER, 'read')]
      ),
    },
    fileDescriptorEntity: { findOne },
    fileBindingEntity: { findOne: findBinding },
    fileAuditRecordEntity: { save: auditSave },
  });
  const adapter = new PahHostFilesPortAdapter();
  Object.assign(adapter, { pahFilesService: service });
  return { adapter, auditSave, findOne, findBinding };
}

describe('Phoenix Host Files descriptor port v1', () => {
  it('以稳定 token 注册，并只返回冻结的安全活动描述符', async () => {
    expect(DecoratorManager.getProviderId(PahHostFilesPortAdapter)).toBe(
      PAH_HOST_FILES_PORT
    );
    const { adapter, auditSave } = fixture();
    const result = await adapter.resolveActiveDescriptor({
      ownerModuleId: OWNER,
      fileId: FILE_ID,
      expectedVersion: 3,
    });

    expect(result).toEqual({
      fileId: FILE_ID,
      version: 3,
      sha256: 'a'.repeat(64),
      originalName: 'fixture.json',
      mime: 'application/json',
      size: 12,
      ownerModuleId: OWNER,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).not.toHaveProperty('providerId');
    expect(result).not.toHaveProperty('storageIdentity');
    expect(result).not.toHaveProperty('storageKey');
    expect(auditSave).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'file.resolve-active',
        result: 'success',
        fileId: FILE_ID,
        detail: { version: 3, mime: 'application/json', size: 12 },
      })
    );
    expect(JSON.stringify(auditSave.mock.calls)).not.toContain('private-path');
  });

  it('拒绝未知字段和非法 expectedVersion，且不访问 repository', async () => {
    const { adapter, findOne } = fixture();
    await expect(
      adapter.resolveActiveDescriptor({
        ownerModuleId: OWNER,
        fileId: FILE_ID,
        expectedVersion: 0,
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', statusCode: 400 });
    await expect(
      adapter.resolveActiveDescriptor({
        ownerModuleId: OWNER,
        fileId: FILE_ID,
        browserSha256: 'untrusted',
      } as any)
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', statusCode: 400 });
    expect(findOne).not.toHaveBeenCalled();
  });

  it('角色门禁拒绝映射为稳定 ACCESS_DENIED，仍保留 denied 审计', async () => {
    const { adapter, auditSave, findOne } = fixture({ permissions: [] });
    await expect(
      adapter.resolveActiveDescriptor({
        ownerModuleId: OWNER,
        fileId: FILE_ID,
      })
    ).rejects.toMatchObject({ code: 'ACCESS_DENIED', statusCode: 403 });
    expect(findOne).not.toHaveBeenCalled();
    expect(auditSave).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'denied',
        detail: expect.objectContaining({ reason: 'role-permission-missing' }),
      })
    );
  });

  it('不存在、非活动和版本冲突分别 fail-closed 并写有限审计', async () => {
    const missing = fixture({ descriptor: null });
    await expect(
      missing.adapter.resolveActiveDescriptor({
        ownerModuleId: OWNER,
        fileId: FILE_ID,
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    expect(missing.auditSave).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { reason: 'file-not-found' } })
    );

    const inactive = fixture({ descriptor: file('deleted') });
    await expect(
      inactive.adapter.resolveActiveDescriptor({
        ownerModuleId: OWNER,
        fileId: FILE_ID,
      })
    ).rejects.toMatchObject({ code: 'INACTIVE', statusCode: 409 });
    expect(inactive.auditSave).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'denied',
        detail: { reason: 'file-inactive' },
      })
    );

    const conflict = fixture();
    await expect(
      conflict.adapter.resolveActiveDescriptor({
        ownerModuleId: OWNER,
        fileId: FILE_ID,
        expectedVersion: 2,
      })
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT', statusCode: 409 });
    expect(conflict.auditSave).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'failed',
        detail: {
          reason: 'descriptor-version-conflict',
          expectedVersion: 2,
          actualVersion: 3,
        },
      })
    );
  });

  it('内部读取失败只返回稳定 HOST_FAILURE，不泄露内部错误或路径', async () => {
    const fixtureResult = fixture({
      findError: new Error('/private/provider/storage/object'),
    });
    let caught: unknown;
    try {
      await fixtureResult.adapter.resolveActiveDescriptor({
        ownerModuleId: OWNER,
        fileId: FILE_ID,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PahHostFilesPortError);
    expect(caught).toMatchObject({ code: 'HOST_FAILURE', statusCode: 500 });
    expect(String(caught)).not.toContain('private/provider');
    expect(fixtureResult.auditSave).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'failed',
        detail: { reason: 'descriptor-read-failed' },
      })
    );
  });

  it('binding 由 Host 重新解析并只返回冻结的权威关系字段', async () => {
    const { adapter, auditSave } = fixture();
    const result = await adapter.resolveActiveBinding({
      ownerModuleId: OWNER,
      bindingId: BINDING_ID,
    });

    expect(result).toEqual({
      bindingId: BINDING_ID,
      resourceType: 'manufacturing-order',
      resourceKey: 'order-7',
      relationType: 'dispatch-source',
      fileId: FILE_ID,
      fileVersion: 3,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).not.toHaveProperty('alias');
    expect(result).not.toHaveProperty('note');
    expect(result).not.toHaveProperty('attributes');
    expect(auditSave).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'binding.resolve-active',
        result: 'success',
        fileId: FILE_ID,
        bindingId: BINDING_ID,
      })
    );
    expect(JSON.stringify(auditSave.mock.calls)).not.toMatch(
      /browser-must-not-copy|private-note/u
    );
  });

  it('binding 输入拒绝浏览器关系元数据，解绑和版本漂移均 fail-closed', async () => {
    const invalid = fixture();
    await expect(
      invalid.adapter.resolveActiveBinding({
        ownerModuleId: OWNER,
        bindingId: BINDING_ID,
        resourceType: 'browser-value',
      } as any)
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', statusCode: 400 });
    expect(invalid.findBinding).not.toHaveBeenCalled();

    const inactive = fixture({ binding: binding('unbound') });
    await expect(
      inactive.adapter.resolveActiveBinding({
        ownerModuleId: OWNER,
        bindingId: BINDING_ID,
      })
    ).rejects.toMatchObject({ code: 'INACTIVE', statusCode: 409 });
    expect(inactive.findOne).not.toHaveBeenCalled();

    const staleBinding = { ...binding(), fileVersion: 2 };
    const conflict = fixture({ binding: staleBinding });
    await expect(
      conflict.adapter.resolveActiveBinding({
        ownerModuleId: OWNER,
        bindingId: BINDING_ID,
      })
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT', statusCode: 409 });
    expect(conflict.auditSave).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'failed',
        detail: {
          reason: 'binding-file-version-conflict',
          bindingFileVersion: 2,
          descriptorVersion: 3,
        },
      })
    );
  });
});
