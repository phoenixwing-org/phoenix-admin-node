import { PahPluginMigrationService } from '../../../src/modules/phoenix/service/migration';

describe('Pah DDL 备份绑定', () => {
  function service(backupRequired: boolean) {
    const value = new PahPluginMigrationService();
    const verify = jest.fn().mockResolvedValue(undefined);
    Object.assign(value, { backupGate: { verify } });
    (value as any).plans.set('plan-1', {
      expiresAt: Date.now() + 60_000,
      prepared: {
        moduleId: 'example-plugin',
        pluginVersion: '0.1.0',
        manifestSignature: 'manifest',
        appliedSignature: 'applied',
        backupRequired,
        items: [
          {
            declaration: {
              id: 'example-bootstrap',
              version: 1,
              checksum: `sha256:${'a'.repeat(64)}`,
            },
            sql: 'SELECT 1;',
          },
        ],
      },
    });
    return { value, verify };
  }

  it('待执行 DDL 没有可信备份证明时 fail-closed', async () => {
    const { value, verify } = service(true);

    await expect(
      value.claimPlanForExecution('example-plugin', '0.1.0', 'plan-1')
    ).rejects.toThrow('缺少当前插件版本的可信备份证明');
    expect(verify).not.toHaveBeenCalled();
  });

  it('可信备份证明与当前版本和迁移清单绑定', async () => {
    const { value, verify } = service(true);
    const proof = {
      backupId: 'backup-1',
      moduleId: 'example-plugin',
      pluginVersion: '0.1.0',
      dataSourceName: 'default' as const,
      createdAt: new Date().toISOString(),
      restoreProcedure: 'verified restore rehearsal',
    };

    const prepared = await value.claimPlanForExecution(
      'example-plugin',
      '0.1.0',
      'plan-1',
      proof
    );

    expect(verify).toHaveBeenCalledWith(
      proof,
      expect.objectContaining({
        moduleId: 'example-plugin',
        pluginVersion: '0.1.0',
        migrations: [
          expect.objectContaining({ id: 'example-bootstrap', version: 1 }),
        ],
      })
    );
    expect(prepared.backupProof).toEqual(proof);
  });
});
