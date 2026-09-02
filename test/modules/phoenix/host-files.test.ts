import { createHash } from 'crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { PahFilesService } from '../../../src/modules/phoenix/service/files';
import {
  inspectPahUpload,
  safePahFileName,
} from '../../../src/modules/phoenix/service/files-inspection';
import { PahLocalFileProvider } from '../../../src/modules/phoenix/provider/file';
import {
  PAH_FILES_CAPABILITY_ENDPOINTS,
  pahFilesCapabilityId,
} from '../../../src/modules/phoenix/interface/files';

const OWNER = 'example-plugin';

function installation(
  moduleId = OWNER,
  state = 'enabled',
  hostReuse: string[] = ['files']
) {
  return {
    moduleId,
    state,
    manifest: {
      hostReuse,
      capabilities: [
        {
          id: pahFilesCapabilityId(moduleId, 'read'),
          risk: 'read',
          endpoints: [...PAH_FILES_CAPABILITY_ENDPOINTS.read],
        },
      ],
    },
  };
}

function listService(options: {
  plugin?: any;
  username?: string;
  permissions?: string[];
  rows?: any[];
}) {
  const auditSave = jest.fn().mockResolvedValue(undefined);
  const service = new PahFilesService();
  Object.assign(service, {
    ctx: {
      admin: {
        userId: 7,
        username: options.username ?? 'operator',
        roleIds: [2],
      },
      get: jest.fn().mockReturnValue('request-fixture'),
    },
    pluginInstallationEntity: {
      findOne: jest.fn().mockResolvedValue(options.plugin ?? installation()),
    },
    baseSysMenuService: {
      getPerms: jest.fn().mockResolvedValue(
        options.permissions ?? [pahFilesCapabilityId(OWNER, 'read')]
      ),
    },
    fileDescriptorEntity: {
      findAndCount: jest
        .fn()
        .mockResolvedValue([options.rows ?? [], (options.rows ?? []).length]),
    },
    fileAuditRecordEntity: { save: auditSave },
  });
  return { service, auditSave };
}

describe('Phoenix Host Files v1', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'pah-files-v1-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('流式计算 JSON SHA/MIME，文件名只保留安全 basename', async () => {
    const source = path.join(root, 'source.json');
    const content = Buffer.from('{"fixture":true}\n');
    writeFileSync(source, content);
    await expect(inspectPahUpload(source)).resolves.toEqual({
      size: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
      mime: 'application/json',
    });
    expect(safePahFileName('../../report.json')).toBe('report.json');
    expect(() => safePahFileName('bad\nname')).toThrow('文件名');
  });

  it('local Provider 使用 0700/0600 内容寻址并显式报告去重', async () => {
    const providerRoot = path.join(root, 'provider');
    const source = path.join(root, 'source.txt');
    const content = Buffer.from('hello Host Files');
    writeFileSync(source, content);
    const digest = createHash('sha256').update(content).digest('hex');
    const provider = new PahLocalFileProvider(providerRoot);

    const first = await provider.put(source, digest, content.length);
    const second = await provider.put(source, digest, content.length);
    expect(first).toEqual(
      expect.objectContaining({
        providerId: 'local',
        storageIdentity: `sha256:${digest}`,
        deduplicated: false,
      })
    );
    expect(second.deduplicated).toBe(true);
    expect(statSync(providerRoot).mode & 0o777).toBe(0o700);
    const firstReceipt = path.join(
      providerRoot,
      '.pending',
      `${first.writeReceiptId}.json`
    );
    expect(statSync(firstReceipt).mode & 0o777).toBe(0o600);
    expect(statSync(path.join(providerRoot, first.storageKey)).mode & 0o777).toBe(
      0o600
    );
    const chunks: Buffer[] = [];
    for await (const chunk of await provider.open(
      first.storageKey,
      digest,
      content.length
    )) {
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks)).toEqual(content);
    await provider.commitWrite(first.writeReceiptId);
    await provider.commitWrite(second.writeReceiptId);
    expect(existsSync(firstReceipt)).toBe(false);
  });

  it('local Provider 对内容损坏、symlink 语义和越界 key fail-closed', async () => {
    const providerRoot = path.join(root, 'provider');
    const source = path.join(root, 'source.txt');
    const content = Buffer.from('immutable');
    writeFileSync(source, content);
    const digest = createHash('sha256').update(content).digest('hex');
    const provider = new PahLocalFileProvider(providerRoot);
    const stored = await provider.put(source, digest, content.length);
    writeFileSync(path.join(providerRoot, stored.storageKey), 'tampered');
    chmodSync(path.join(providerRoot, stored.storageKey), 0o600);
    await expect(
      provider.open(stored.storageKey, digest, content.length)
    ).rejects.toThrow('完整性冲突');
    rmSync(path.join(providerRoot, stored.storageKey));
    symlinkSync(source, path.join(providerRoot, stored.storageKey));
    await expect(
      provider.open(stored.storageKey, digest, content.length)
    ).rejects.toThrow('无法安全读取');
    await expect(provider.open('../escape', digest, content.length)).rejects.toThrow(
      'storage key 不合法'
    );
  });

  it('local Provider 并发发布相同内容时使用 no-replace 且明确标记一次去重', async () => {
    const providerRoot = path.join(root, 'provider-concurrent');
    const source = path.join(root, 'concurrent.txt');
    const content = Buffer.from('concurrent immutable content');
    writeFileSync(source, content);
    const digest = createHash('sha256').update(content).digest('hex');
    const provider = new PahLocalFileProvider(providerRoot);

    const results = await Promise.all([
      provider.put(source, digest, content.length),
      provider.put(source, digest, content.length),
    ]);
    expect(results.map(result => result.deduplicated).sort()).toEqual([
      false,
      true,
    ]);
    expect(results[0].storageKey).toBe(results[1].storageKey);
    await Promise.all(
      results.map(result => provider.commitWrite(result.writeReceiptId))
    );
  });

  it('非管理员必须持有目标 owner 的语义 capability，拒绝结果写入审计', async () => {
    const denied = listService({
      plugin: installation('other-plugin'),
      permissions: [pahFilesCapabilityId(OWNER, 'read')],
    });
    await expect(
      denied.service.listFiles('other-plugin', {})
    ).rejects.toThrow('没有目标插件');
    expect(denied.auditSave).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerModuleId: 'other-plugin',
        result: 'denied',
      })
    );
  });

  it('插件 disabled 或未声明 hostReuse 时 root 管理员也不能绕过 owner 门禁', async () => {
    const disabled = listService({
      plugin: installation(OWNER, 'disabled'),
      username: 'admin',
    });
    await expect(disabled.service.listFiles(OWNER, {})).rejects.toThrow(
      '未启用 Host Files'
    );
    expect(disabled.auditSave).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerModuleId: OWNER,
        result: 'denied',
        detail: { reason: 'plugin-files-disabled' },
      })
    );

    const noReuse = listService({
      plugin: installation(OWNER, 'enabled', []),
      username: 'admin',
    });
    await expect(noReuse.service.listFiles(OWNER, {})).rejects.toThrow(
      '未启用 Host Files'
    );
  });

  it('成功读取列表只返回公开 DTO 并产生无内容审计', async () => {
    const rows = [
      {
        fileId: '11111111-1111-4111-8111-111111111111',
        version: 1,
        sha256: 'a'.repeat(64),
        mime: 'application/json',
        originalName: 'fixture.json',
        size: '12',
        providerId: 'local',
        storageIdentity: `sha256:${'a'.repeat(64)}`,
        storageKey: 'aa/private-path',
        status: 'active',
        ownerModuleId: OWNER,
        createdBy: 7,
        createTime: '2026-09-01 00:00:00',
        updatedBy: null,
        updateTime: '2026-09-01 00:00:00',
        deletedBy: null,
        deletedAt: null,
      },
    ];
    const allowed = listService({ rows });
    const result = await allowed.service.listFiles(OWNER, {});
    expect(result.list[0]).not.toHaveProperty('storageKey');
    expect(result.list[0]).toEqual(
      expect.objectContaining({ fileId: rows[0].fileId, size: 12 })
    );
    expect(allowed.auditSave).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'file.list', result: 'success' })
    );
    expect(JSON.stringify(allowed.auditSave.mock.calls)).not.toContain(
      'private-path'
    );
  });

  it('写事务失败会留下有限 failed 审计，不记录请求体或路径', async () => {
    const auditSave = jest.fn().mockResolvedValue(undefined);
    const service = new PahFilesService();
    Object.assign(service, {
      ctx: {
        admin: { userId: 7, username: 'admin', roleIds: [1] },
        get: jest.fn().mockReturnValue('write-fixture'),
      },
      pluginInstallationEntity: {
        findOne: jest.fn().mockResolvedValue({
          moduleId: OWNER,
          state: 'enabled',
          manifest: {
            hostReuse: ['files'],
            capabilities: [
              {
                id: pahFilesCapabilityId(OWNER, 'write'),
                risk: 'write',
                endpoints: [...PAH_FILES_CAPABILITY_ENDPOINTS.write],
              },
            ],
          },
        }),
      },
      fileAuditRecordEntity: { save: auditSave },
      dataSource: {
        transaction: jest.fn().mockRejectedValue(new Error('private-db-path')),
      },
    });

    await expect(
      service.updateFile(
        OWNER,
        '11111111-1111-4111-8111-111111111111',
        { originalName: 'safe.txt', private: '/must/not/audit' }
      )
    ).rejects.toThrow('private-db-path');
    expect(auditSave).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'file.update',
        result: 'failed',
        detail: { reason: 'internal-error' },
      })
    );
    expect(JSON.stringify(auditSave.mock.calls)).not.toMatch(
      /private-db-path|must\/not\/audit/u
    );
  });
});
