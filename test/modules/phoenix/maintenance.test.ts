import { readFileSync } from 'fs';
import * as path from 'path';
import { PhoenixMaintenanceService } from '../../../src/modules/phoenix/service/maintenance';

type MenuRow = {
  id: number;
  name: string;
  router: string | null;
  viewPath: string | null;
};

function harness(initialRows: MenuRow[], username = 'admin') {
  const rows = initialRows.map(item => ({ ...item }));
  const repository = {
    find: jest.fn(async (options?: { where?: unknown }) => {
      const where = JSON.stringify(options?.where ?? null);
      const selected = where.includes('/helper/plugins')
        ? rows.filter(row => row.router === '/helper/plugins')
        : rows.filter(
            row =>
              row.router === '/pah/dictionary-maintenance' ||
              row.viewPath === 'modules/pah/views/dictionary-maintenance.vue'
          );
      return selected.sort((left, right) => left.id - right.id);
    }),
    update: jest.fn(async (id: number, patch: Partial<MenuRow>) => {
      Object.assign(
        rows.find(item => item.id === id),
        patch
      );
      return { affected: 1 };
    }),
  };
  const service = new PhoenixMaintenanceService();
  Object.assign(service, {
    ctx: { admin: { username } },
    baseSysMenuEntity: repository,
    dataSource: {
      transaction: jest.fn(async (_isolation: string, callback: any) =>
        callback({ getRepository: () => repository })
      ),
    },
  });
  return { service, repository, rows };
}

describe('Phoenix 系统维护 Registry', () => {
  it('Controller 只暴露受控 read/plan/apply，不接收 SQL 或路径', () => {
    const source = readFileSync(
      path.resolve(
        __dirname,
        '../../../src/modules/phoenix/controller/admin/maintenance.ts'
      ),
      'utf8'
    );
    expect(source).toContain("@CoolController('/admin/phoenix/maintenance')");
    expect(source).toContain("@Get('/read'");
    expect(source).toContain("@Post('/plan'");
    expect(source).toContain("@Post('/apply'");
    expect(source).not.toMatch(/Body\(['\"](?:sql|script|path)/i);
  });

  it('检测旧字典菜单路径并生成稳定的受控计划', async () => {
    const { service } = harness([
      {
        id: 7,
        name: '字典维护',
        router: '/pah/dictionary-maintenance',
        viewPath: 'modules/pah/views/dictionary-maintenance.vue',
      },
    ]);

    const plan = await service.plan('phoenix-dictionary-menu-route-v1');
    expect(plan).toMatchObject({
      state: 'action-required',
      affectedRecords: 1,
    });
    expect(plan.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(plan.changes[0]).toMatchObject({
      recordId: 7,
      router: { target: '/phoenix/dictionary-maintenance' },
      viewPath: {
        target: 'modules/phoenix/views/dictionary-maintenance.vue',
      },
    });
  });

  it('在串行事务中执行一次并允许重复等幂复检', async () => {
    const { service, repository, rows } = harness([
      {
        id: 9,
        name: '字典维护',
        router: '/pah/dictionary-maintenance',
        viewPath: 'modules/pah/views/dictionary-maintenance.vue',
      },
    ]);
    const plan = await service.plan('phoenix-dictionary-menu-route-v1');
    const first = await service.apply(
      'phoenix-dictionary-menu-route-v1',
      plan.fingerprint
    );
    expect(first).toMatchObject({
      applied: true,
      updatedRecords: 1,
      plan: { state: 'healthy' },
    });
    expect(rows[0]).toMatchObject({
      router: '/phoenix/dictionary-maintenance',
      viewPath: 'modules/phoenix/views/dictionary-maintenance.vue',
    });

    const healthy = await service.plan('phoenix-dictionary-menu-route-v1');
    const second = await service.apply(
      'phoenix-dictionary-menu-route-v1',
      healthy.fingerprint
    );
    expect(second).toMatchObject({ applied: false, updatedRecords: 0 });
    expect(repository.update).toHaveBeenCalledTimes(1);
  });

  it('把扩展入口名称等幂升级为扩展中心', async () => {
    const { service, repository, rows } = harness([
      {
        id: 10,
        name: '插件列表',
        router: '/helper/plugins',
        viewPath: 'modules/helper/views/plugins.vue',
      },
    ]);
    const plan = await service.plan(
      'phoenix-extension-center-menu-name-v1'
    );
    expect(plan).toMatchObject({
      title: '统一扩展中心名称',
      state: 'action-required',
      affectedRecords: 1,
      changes: [
        {
          label: { current: '插件列表', target: '扩展中心' },
          router: { current: '/helper/plugins', target: '/helper/plugins' },
        },
      ],
    });

    const result = await service.apply(
      'phoenix-extension-center-menu-name-v1',
      plan.fingerprint
    );
    expect(result).toMatchObject({
      applied: true,
      updatedRecords: 1,
      plan: { state: 'healthy' },
    });
    expect(rows[0].name).toBe('扩展中心');
    expect(repository.update).toHaveBeenCalledWith(10, {
      name: '扩展中心',
    });
  });

  it('拒绝过期计划、未知 operation 与非根管理员', async () => {
    const current = harness([
      {
        id: 11,
        name: '字典维护',
        router: '/pah/dictionary-maintenance',
        viewPath: null,
      },
    ]);
    await expect(
      current.service.apply(
        'phoenix-dictionary-menu-route-v1',
        `sha256:${'0'.repeat(64)}`
      )
    ).rejects.toThrow('维护计划已变化，请重新检测');
    await expect(current.service.plan('arbitrary-sql')).rejects.toThrow(
      '未知的系统维护项'
    );

    const operator = harness([], 'operator');
    await expect(operator.service.read()).rejects.toThrow(
      '只有 Host 管理员可以执行系统维护'
    );
  });
});
