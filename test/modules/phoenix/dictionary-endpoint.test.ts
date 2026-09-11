import { PahPluginController } from '../../../src/modules/phoenix/controller/admin/plugin';
import { PahPluginService } from '../../../src/modules/phoenix/service/plugin';

const MODULE_ID = 'example-plugin';

function dictionaryManifest() {
  return {
    moduleId: MODULE_ID,
    dictionaryContributions: [
      {
        id: 'example-plugin-status',
        typeKey: 'example-plugin.status',
        typeName: '示例状态',
        policyVersion: 1,
        retainOnUninstall: true,
        items: [
          {
            value: 'open',
            name: '打开',
            orderNum: 0,
            itemClass: 'core',
          },
        ],
      },
    ],
  };
}

describe('Pah 独立字典补全入口', () => {
  it('控制器只转发 module、确认指纹与 confirmed 到 service', async () => {
    const dictionaryReconcile = jest.fn().mockResolvedValue({ dryRun: true });
    const controller = new PahPluginController();
    Object.assign(controller, {
      pahPluginService: { dictionaryReconcile },
      ok: (value: unknown) => value,
    });

    await expect(
      controller.dictionaryReconcile(MODULE_ID, 'confirmed-plan', true)
    ).resolves.toEqual({ dryRun: true });
    expect(dictionaryReconcile).toHaveBeenCalledWith(
      MODULE_ID,
      'confirmed-plan',
      true
    );
  });

  it('只有 root、已启用且已确认的插件可按指纹补全', async () => {
    const findOne = jest.fn().mockResolvedValue({
      id: 1,
      moduleId: MODULE_ID,
      state: 'enabled',
      manifest: dictionaryManifest(),
    });
    const reconcile = jest.fn().mockResolvedValue({ fingerprint: 'next' });
    const service = new PahPluginService();
    Object.assign(service, {
      ctx: { admin: { username: 'admin' } },
      pluginInstallationEntity: { findOne },
      pahDictionaryService: { reconcile },
    });

    await expect(
      service.dictionaryReconcile(MODULE_ID, 'confirmed-plan', false)
    ).rejects.toThrow('执行字典补全前必须确认当前 dry-run 计划');
    expect(findOne).not.toHaveBeenCalled();

    await expect(
      service.dictionaryReconcile(MODULE_ID, 'confirmed-plan', true)
    ).resolves.toEqual({ fingerprint: 'next' });
    expect(reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ moduleId: MODULE_ID, state: 'enabled' }),
      'confirmed-plan'
    );

    (service as any).ctx = { admin: { username: 'operator' } };
    await expect(
      service.dictionaryReconcile(MODULE_ID, 'confirmed-plan', true)
    ).rejects.toThrow('只有 Host 管理员可以维护业务插件');

    (service as any).ctx = { admin: { username: 'admin' } };
    findOne.mockResolvedValueOnce({
      id: 1,
      moduleId: MODULE_ID,
      state: 'disabled',
      manifest: dictionaryManifest(),
    });
    await expect(
      service.dictionaryReconcile(MODULE_ID, 'confirmed-plan', true)
    ).rejects.toThrow('只有已启用插件可以独立补全字典');
  });
});
