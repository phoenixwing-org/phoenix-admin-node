import { PahPluginManifest } from '../../../src/modules/pah/interface/plugin';
import { DictInfoEntity } from '../../../src/modules/dict/entity/info';
import { DictTypeEntity } from '../../../src/modules/dict/entity/type';
import { PahDictionaryReconcileRecordEntity } from '../../../src/modules/pah/entity/dictionary-reconcile-record';
import {
  PahDictionaryService,
  PahDictionarySnapshot,
  planPahDictionaryReconcile,
} from '../../../src/modules/pah/service/dictionary';

function manifest(): PahPluginManifest {
  return {
    moduleId: 'example-plugin',
    version: '0.2.0',
    dictionaryContributions: [
      {
        id: 'example-plugin-status',
        typeKey: 'example-plugin.status',
        typeName: '示例状态',
        policyVersion: 2,
        retainOnUninstall: true,
        installPresets: ['general'],
        items: [
          {
            value: 'open',
            name: '打开',
            orderNum: 0,
            itemClass: 'core',
            customizable: ['name'],
          },
          {
            value: 'closed',
            name: '关闭',
            orderNum: 1,
            itemClass: 'default',
            presets: ['general'],
          },
          {
            value: 'special',
            name: '专项',
            orderNum: 2,
            itemClass: 'default',
            presets: ['optional'],
          },
        ],
      },
    ],
  } as PahPluginManifest;
}

describe('Pah 插件字典 reconcile 计划', () => {
  it('只补缺失项并保留管理员名称、排序和未知自定义项', () => {
    const plan = planPahDictionaryReconcile(manifest(), {
      types: [{ id: 7, key: 'example-plugin.status', name: '管理员类型名' }],
      items: [
        {
          id: 8,
          typeId: 7,
          value: 'open',
          name: '管理员显示名',
          orderNum: 9,
        },
        {
          id: 9,
          typeId: 7,
          value: 'custom',
          name: '自定义',
          orderNum: 10,
        },
      ],
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.dryRun).toBe(true);
    expect(plan.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.types[0]).toEqual(
      expect.objectContaining({
        action: 'preserve',
        typeName: '管理员类型名',
        preservedCustomItems: 1,
      })
    );
    expect(plan.types[0].items).toEqual([
      expect.objectContaining({
        value: 'open',
        name: '管理员显示名',
        orderNum: 9,
        action: 'preserve',
      }),
      expect.objectContaining({ value: 'closed', action: 'create' }),
    ]);
    expect(plan.totals).toEqual({
      createTypes: 0,
      createItems: 1,
      preserveItems: 1,
      preserveCustomItems: 1,
    });
  });

  it('数据库中可写相关快照变化会改变确认指纹', () => {
    const before = planPahDictionaryReconcile(manifest(), {
      types: [{ id: 7, key: 'example-plugin.status', name: '示例状态' }],
      items: [{ id: 8, typeId: 7, value: 'open', name: '打开', orderNum: 0 }],
    });
    const after = planPahDictionaryReconcile(manifest(), {
      types: [{ id: 7, key: 'example-plugin.status', name: '示例状态' }],
      items: [
        { id: 8, typeId: 7, value: 'open', name: '管理员名称', orderNum: 9 },
      ],
    });

    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  it('重复 reconcile 已完整物化的 catalog 时没有新增动作', () => {
    const plan = planPahDictionaryReconcile(manifest(), {
      types: [{ id: 7, key: 'example-plugin.status', name: '示例状态' }],
      items: [
        { id: 8, typeId: 7, value: 'open', name: '打开', orderNum: 0 },
        { id: 9, typeId: 7, value: 'closed', name: '关闭', orderNum: 1 },
      ],
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.totals).toEqual({
      createTypes: 0,
      createItems: 0,
      preserveItems: 2,
      preserveCustomItems: 0,
    });
  });

  it('对重复 type/value 安全拒绝而不是猜测合并', () => {
    const duplicateType = planPahDictionaryReconcile(manifest(), {
      types: [
        { id: 1, key: 'example-plugin.status', name: 'A' },
        { id: 2, key: 'example-plugin.status', name: 'B' },
      ],
      items: [],
    });
    expect(duplicateType.conflicts).toEqual([
      '字典类型 example-plugin.status 存在 2 条重复记录',
    ]);

    const duplicateValue = planPahDictionaryReconcile(manifest(), {
      types: [{ id: 1, key: 'example-plugin.status', name: 'A' }],
      items: [
        { id: 3, typeId: 1, value: 'open', name: 'A', orderNum: 0 },
        { id: 4, typeId: 1, value: 'open', name: 'B', orderNum: 1 },
      ],
    });
    expect(duplicateValue.conflicts).toEqual([
      '字典项 example-plugin.status:open 存在 2 条重复记录',
    ]);

    const duplicateCustomValue = planPahDictionaryReconcile(manifest(), {
      types: [{ id: 1, key: 'example-plugin.status', name: 'A' }],
      items: [
        { id: 5, typeId: 1, value: 'custom', name: 'A', orderNum: 0 },
        { id: 6, typeId: 1, value: 'custom', name: 'B', orderNum: 1 },
      ],
    });
    expect(duplicateCustomValue.conflicts).toEqual([
      '字典项 example-plugin.status:custom 存在 2 条重复记录',
    ]);
  });
});

describe('Pah 插件字典 reconcile 事务', () => {
  function fixture(
    initialSnapshot: PahDictionarySnapshot,
    transactionSnapshot: PahDictionarySnapshot = initialSnapshot
  ) {
    const typeSave = jest.fn().mockResolvedValue({ id: 17 });
    const itemSave = jest.fn(async value => value);
    const successRecordUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    const failureRecordUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    const recordSave = jest.fn().mockResolvedValue({ id: 41 });
    const transactionTypes = {
      find: jest.fn().mockResolvedValue(transactionSnapshot.types),
      create: jest.fn(value => value),
      save: typeSave,
    };
    const transactionItems = {
      find: jest.fn().mockResolvedValue(transactionSnapshot.items),
      create: jest.fn(value => value),
      save: itemSave,
    };
    const manager = {
      getRepository: jest.fn(entity => {
        if (entity === DictTypeEntity) return transactionTypes;
        if (entity === DictInfoEntity) return transactionItems;
        if (entity === PahDictionaryReconcileRecordEntity) {
          return { update: successRecordUpdate };
        }
        throw new Error('unexpected repository');
      }),
    };
    const transaction = jest.fn(async (isolation, callback) => {
      expect(isolation).toBe('SERIALIZABLE');
      return callback(manager);
    });
    const service = new PahDictionaryService();
    Object.assign(service, {
      ctx: { admin: { username: 'admin', userId: 7 } },
      dataSource: { transaction },
      dictTypeEntity: {
        find: jest.fn().mockResolvedValue(initialSnapshot.types),
      },
      dictInfoEntity: {
        find: jest.fn().mockResolvedValue(initialSnapshot.items),
      },
      reconcileRecordEntity: {
        save: recordSave,
        update: failureRecordUpdate,
      },
    });
    return {
      service,
      transaction,
      typeSave,
      itemSave,
      successRecordUpdate,
      failureRecordUpdate,
      recordSave,
    };
  }

  function installation() {
    return {
      moduleId: 'example-plugin',
      version: '0.2.0',
      manifest: manifest(),
    } as any;
  }

  it('在 SERIALIZABLE 事务内补齐缺失项并原子写成功 ledger', async () => {
    const harness = fixture({ types: [], items: [] });
    const plan = await harness.service.dryRun(installation());

    await expect(
      harness.service.reconcile(installation(), plan.fingerprint)
    ).resolves.toEqual(
      expect.objectContaining({ fingerprint: plan.fingerprint })
    );

    expect(harness.transaction).toHaveBeenCalledTimes(1);
    expect(harness.typeSave).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'example-plugin.status' })
    );
    expect(harness.itemSave).toHaveBeenCalledWith([
      expect.objectContaining({ typeId: 17, value: 'open', name: '打开' }),
      expect.objectContaining({ typeId: 17, value: 'closed', name: '关闭' }),
    ]);
    expect(harness.successRecordUpdate).toHaveBeenCalledWith(41, {
      status: 'succeeded',
      detail: {
        plan,
        result: expect.objectContaining({ fingerprint: plan.fingerprint }),
      },
    });
    expect(harness.failureRecordUpdate).not.toHaveBeenCalled();
  });

  it('事务内快照变化时拒绝旧指纹且不写字典', async () => {
    const harness = fixture(
      { types: [], items: [] },
      {
        types: [{ id: 17, key: 'example-plugin.status', name: '管理员已创建' }],
        items: [],
      }
    );
    const plan = await harness.service.dryRun(installation());

    await expect(
      harness.service.reconcile(installation(), plan.fingerprint)
    ).rejects.toThrow('字典数据已变化，请重新生成 dry-run 并确认');

    expect(harness.typeSave).not.toHaveBeenCalled();
    expect(harness.itemSave).not.toHaveBeenCalled();
    expect(harness.successRecordUpdate).not.toHaveBeenCalled();
    expect(harness.failureRecordUpdate).toHaveBeenCalledWith(41, {
      status: 'failed',
      error: '字典数据已变化，请重新生成 dry-run 并确认',
    });
  });

  it('成功 ledger 写入失败时整体 reconcile 失败并登记错误', async () => {
    const harness = fixture({ types: [], items: [] });
    harness.successRecordUpdate.mockRejectedValueOnce(
      new Error('ledger write failed')
    );
    const plan = await harness.service.dryRun(installation());

    await expect(
      harness.service.reconcile(installation(), plan.fingerprint)
    ).rejects.toThrow('ledger write failed');

    expect(harness.successRecordUpdate).toHaveBeenCalled();
    expect(harness.failureRecordUpdate).toHaveBeenCalledWith(41, {
      status: 'failed',
      error: 'ledger write failed',
    });
  });
});

describe('Pah 插件字典 reconcile 审计查询', () => {
  it('仅分页返回审计元数据，不暴露 plan/result detail', async () => {
    const findAndCount = jest.fn().mockResolvedValue([
      [
        {
          id: 41,
          moduleId: 'example-plugin',
          pluginVersion: '0.2.0',
          catalogHash: 'a'.repeat(64),
          actorId: '7',
          status: 'failed',
          error: 'x'.repeat(800),
          detail: { secret: 'catalog plan and result' },
          createTime: new Date('2026-08-03T00:00:00.000Z'),
          updateTime: new Date('2026-08-03T00:01:00.000Z'),
        },
      ],
      1,
    ]);
    const service = new PahDictionaryService();
    Object.assign(service, {
      ctx: { admin: { username: 'admin', userId: 7 } },
      reconcileRecordEntity: { findAndCount },
    });

    const result = await service.records('example-plugin', '2', '25');

    expect(findAndCount).toHaveBeenCalledWith({
      select: {
        id: true,
        moduleId: true,
        pluginVersion: true,
        catalogHash: true,
        actorId: true,
        status: true,
        error: true,
        createTime: true,
        updateTime: true,
      },
      where: { moduleId: 'example-plugin' },
      order: { createTime: 'DESC', id: 'DESC' },
      skip: 25,
      take: 25,
    });
    expect(result).toMatchObject({ page: 2, size: 25, total: 1 });
    expect(result.list[0]).toEqual({
      id: 41,
      moduleId: 'example-plugin',
      pluginVersion: '0.2.0',
      catalogHash: 'a'.repeat(64),
      actorId: '7',
      status: 'failed',
      error: 'x'.repeat(500),
      createTime: new Date('2026-08-03T00:00:00.000Z'),
      updateTime: new Date('2026-08-03T00:01:00.000Z'),
    });
    expect(result.list[0]).not.toHaveProperty('detail');
  });

  it('非 Host 根管理员不能读取审计或发起查询', async () => {
    const findAndCount = jest.fn();
    const service = new PahDictionaryService();
    Object.assign(service, {
      ctx: { admin: { username: 'operator', userId: 8 } },
      reconcileRecordEntity: { findAndCount },
    });

    await expect(service.records('example-plugin', 1, 20)).rejects.toThrow(
      '只有 Host 管理员可以维护插件字典'
    );
    expect(findAndCount).not.toHaveBeenCalled();
  });
});
