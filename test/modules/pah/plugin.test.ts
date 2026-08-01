import {
  canTransitionPahPlugin,
  PahPluginLifecycleState,
  PahPluginManifest,
  validatePahPluginManifest,
} from '../../../src/modules/pah/interface/plugin';
import {
  PAH_BUILTIN_NAVIGATION_GROUPS,
  PAH_BUSINESS_NAVIGATION_GROUP_KEY,
  PahNavigationService,
} from '../../../src/modules/pah/service/navigation';
import { PahPluginService } from '../../../src/modules/pah/service/plugin';

const MODULE_ID = 'example-plugin';
const MIGRATION_CHECKSUM = `sha256:${'0'.repeat(64)}`;

function lifecycleService(state: PahPluginLifecycleState) {
  const contributionFind = jest.fn();
  const service = new PahPluginService();
  Object.assign(service, {
    ctx: { admin: { username: 'admin' } },
    pluginInstallationEntity: {
      findOne: jest.fn().mockResolvedValue({
        id: 1,
        moduleId: MODULE_ID,
        state,
      }),
    },
    pluginMenuContributionEntity: { find: contributionFind },
  });
  return { service, contributionFind };
}

function manifest(): PahPluginManifest {
  return {
    formatVersion: 1,
    moduleId: MODULE_ID,
    name: 'Example Plugin',
    version: '0.1.0',
    publisher: 'Example Publisher',
    license: 'MIT',
    hostCompatibility: '>=0.1.0 <0.2.0',
    activationMode: 'restart',
    entrypoints: { web: 'web/index.mjs', node: 'node/index.mjs' },
    routes: [
      {
        id: 'example-plugin-items',
        path: '/example-plugin/items',
        title: '示例列表',
        moduleId: 'example-plugin-workbench',
        capability: 'example-plugin:item:read',
        viewPath: 'modules/example-plugin/views/items.vue',
      },
    ],
    navigation: {
      preferredGroupId: PAH_BUSINESS_NAVIGATION_GROUP_KEY,
      preferredGroupLabel: '业务',
      modules: [
        {
          id: 'example-plugin-workbench',
          label: '示例工作台',
          routeIds: ['example-plugin-items'],
        },
      ],
    },
    apiPrefix: '/admin/example-plugin/',
    capabilities: [
      {
        id: 'example-plugin:item:read',
        description: '查看示例',
        risk: 'read',
      },
      {
        id: 'example-plugin:data:purge',
        description: '清除示例数据',
        risk: 'admin',
      },
    ],
    resourcePolicies: [],
    auditCategories: [],
    migrations: [
      {
        id: 'example-plugin-bootstrap',
        version: 1,
        checksum: MIGRATION_CHECKSUM,
        description: '初始化示例数据',
      },
    ],
    healthChecks: [
      {
        id: 'example-plugin-ready',
        path: '/admin/example-plugin/health',
      },
    ],
    hostReuse: [
      'identity',
      'users',
      'departments',
      'roles',
      'menus',
      'dictionary',
      'files',
      'tasks',
      'audit',
      'parameters',
      'backup',
    ],
    dataOwnership: {
      tables: ['example_plugin_item'],
      retainedOnUninstall: true,
    },
    uninstall: {
      retainDataByDefault: true,
      requiresBackup: true,
      purgeCapability: 'example-plugin:data:purge',
    },
  };
}

describe('Pah 插件契约', () => {
  it('接受边界正确的 example-plugin manifest 与完整 Host reuse 声明', () => {
    expect(validatePahPluginManifest(manifest())).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('拒绝未知 Host reuse 能力', () => {
    const input = manifest();
    input.hostReuse.push('shell' as any);
    expect(validatePahPluginManifest(input).errors).toContain(
      '未知 Host 复用能力：shell'
    );
  });

  it('拒绝越过插件命名空间的路由', () => {
    const input = manifest();
    input.routes[0].path = '/sys/user';
    const result = validatePahPluginManifest(input);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('路由路径越界：/sys/user');
  });

  it('允许唯一技术 moduleId 声明较短的通用路由前缀', () => {
    const input = manifest();
    input.moduleId = 'example-plugin-engine';
    input.routePrefix = '/example';
    input.apiPrefix = '/admin/example-plugin-engine/';
    input.routes[0] = {
      ...input.routes[0],
      id: 'example-plugin-engine-items',
      path: '/example/items',
      moduleId: 'example-plugin-engine-workbench',
      capability: 'example-plugin-engine:item:read',
      viewPath: 'modules/example-plugin-engine/views/items.vue',
    };
    input.navigation.modules[0] = {
      ...input.navigation.modules[0],
      id: 'example-plugin-engine-workbench',
      routeIds: ['example-plugin-engine-items'],
    };
    input.capabilities = input.capabilities.map(item => ({
      ...item,
      id: item.id.replace('example-plugin:', 'example-plugin-engine:'),
    }));
    input.migrations[0].id = 'example-plugin-engine-bootstrap';
    input.healthChecks[0] = {
      id: 'example-plugin-engine-ready',
      path: '/admin/example-plugin-engine/health',
    };
    input.uninstall.purgeCapability = 'example-plugin-engine:data:purge';

    expect(validatePahPluginManifest(input)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('拒绝多段或畸形路由前缀', () => {
    const input = manifest();
    input.routePrefix = '/example/admin';
    expect(validatePahPluginManifest(input).errors).toContain(
      'routePrefix 必须是单段安全路径：/example/admin'
    );
  });

  it('拒绝默认清除业务数据', () => {
    const input = manifest();
    input.dataOwnership.retainedOnUninstall = false;
    expect(validatePahPluginManifest(input).errors).toContain(
      '卸载必须默认保留业务数据'
    );
  });

  it('拒绝路由引用未声明能力以及畸形迁移', () => {
    const input = manifest();
    input.routes[0].capability = 'example-plugin:item:unknown';
    input.migrations = [
      {
        id: 'other-module-migration',
        version: 0,
        checksum: 'plain-text',
        description: '',
      },
    ];
    const errors = validatePahPluginManifest(input).errors;
    expect(errors).toContain(
      '路由引用未声明能力码：example-plugin:item:unknown'
    );
    expect(errors).toContain('迁移 ID 越界：other-module-migration');
    expect(errors).toContain('迁移版本必须是正整数：other-module-migration');
    expect(errors).toContain('迁移校验和格式错误：other-module-migration');
  });

  it('只允许显式生命周期迁移', () => {
    expect(canTransitionPahPlugin('verified', 'staged')).toBe(true);
    expect(canTransitionPahPlugin('verified', 'enabled')).toBe(false);
    expect(canTransitionPahPlugin('enabled', 'uninstalled')).toBe(false);
  });

  it('重复启用或停用时不触碰菜单贡献', async () => {
    const enabled = lifecycleService('enabled');
    await expect(enabled.service.enable(MODULE_ID)).rejects.toThrow(
      '插件状态不能从 enabled 转换到 enabled'
    );
    expect(enabled.contributionFind).not.toHaveBeenCalled();

    const disabled = lifecycleService('disabled');
    await expect(disabled.service.disable(MODULE_ID)).rejects.toThrow(
      '插件状态不能从 disabled 转换到 disabled'
    );
    expect(disabled.contributionFind).not.toHaveBeenCalled();
  });

  it('拒绝非 Host 管理员变更插件生命周期', async () => {
    const { service } = lifecycleService('verified');
    (service as any).ctx = { admin: { username: 'operator' } };
    await expect(service.install(MODULE_ID)).rejects.toThrow(
      '只有 Host 管理员可以维护业务插件'
    );
  });

  it('把畸形 HTTP JSON 转成校验错误而不是运行时异常', () => {
    expect(() =>
      validatePahPluginManifest({ formatVersion: 1, moduleId: MODULE_ID })
    ).not.toThrow();
    const result = validatePahPluginManifest({
      formatVersion: 1,
      moduleId: MODULE_ID,
      routes: [{ id: 123, path: null }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Web 入口必须是包内安全相对路径');
  });
});

describe('Pah 导航分组', () => {
  it('内置第三分组使用通用业务分组', () => {
    expect(PAH_BUILTIN_NAVIGATION_GROUPS[2]).toEqual({
      groupKey: PAH_BUSINESS_NAVIGATION_GROUP_KEY,
      label: '业务',
      orderNum: 30,
    });
  });

  it('插件建议组不存在时回退到业务分组', async () => {
    const assignmentSave = jest.fn();
    const groupFindOne = jest
      .fn()
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 2 })
      .mockResolvedValueOnce({ id: 3 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 3 });
    const service = new PahNavigationService();
    Object.assign(service, {
      navigationGroupEntity: {
        findOne: groupFindOne,
        save: jest.fn(),
      },
      navigationAssignmentEntity: {
        findOne: jest.fn().mockResolvedValue(null),
        save: assignmentSave,
      },
      baseSysMenuEntity: { find: jest.fn().mockResolvedValue([]) },
      pluginInstallationEntity: { find: jest.fn().mockResolvedValue([]) },
    });

    await service.ensurePluginPreferredGroup(
      MODULE_ID,
      'example-plugin-workbench',
      'pah-group-missing'
    );

    expect(assignmentSave).toHaveBeenCalledWith({
      targetKey: 'plugin:example-plugin:example-plugin-workbench',
      groupId: 3,
    });
  });
});

describe('Pah 菜单、角色与迁移台账', () => {
  it('停用时按稳定贡献键保存角色并刷新权限缓存', async () => {
    const roleGrantSave = jest.fn();
    const refreshPerms = jest.fn();
    const installationFindOne = jest
      .fn()
      .mockResolvedValueOnce({ id: 1, moduleId: MODULE_ID, state: 'enabled' })
      .mockResolvedValue({ id: 1, moduleId: MODULE_ID, state: 'disabled' });
    const contributions = [
      {
        moduleId: MODULE_ID,
        contributionKey: 'route:example-plugin-items',
        menuId: 101,
      },
    ];
    const service = new PahPluginService();
    Object.assign(service, {
      ctx: { admin: { username: 'admin' } },
      pluginInstallationEntity: {
        findOne: installationFindOne,
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      },
      pluginMenuContributionEntity: {
        find: jest.fn().mockResolvedValue(contributions),
        delete: jest.fn(),
      },
      pluginRoleGrantEntity: {
        delete: jest.fn(),
        save: roleGrantSave,
      },
      baseSysRoleMenuEntity: {
        find: jest.fn().mockResolvedValue([{ roleId: 4, menuId: 101 }]),
        delete: jest.fn(),
      },
      baseSysMenuEntity: { delete: jest.fn() },
      baseSysUserRoleEntity: {
        find: jest.fn().mockResolvedValue([{ userId: 9, roleId: 4 }]),
      },
      baseSysPermsService: { refreshPerms },
    });

    await service.disable(MODULE_ID);

    expect(roleGrantSave).toHaveBeenCalledWith([
      {
        moduleId: MODULE_ID,
        roleId: 4,
        contributionKey: 'route:example-plugin-items',
      },
    ]);
    expect(refreshPerms).toHaveBeenCalledWith(9);
  });

  it('重新启用时物化菜单并按稳定贡献键恢复角色', async () => {
    const contributions: any[] = [];
    let menuId = 200;
    const baseMenuSave = jest.fn(async data => ({ ...data, id: ++menuId }));
    const roleMenuSave = jest.fn();
    const ensurePluginPreferredGroup = jest.fn();
    const installationFindOne = jest
      .fn()
      .mockResolvedValueOnce({
        id: 1,
        moduleId: MODULE_ID,
        state: 'disabled',
        manifest: manifest(),
      })
      .mockResolvedValue({
        id: 1,
        moduleId: MODULE_ID,
        state: 'enabled',
        manifest: manifest(),
      });
    const service = new PahPluginService();
    Object.assign(service, {
      ctx: { admin: { username: 'admin' } },
      pluginInstallationEntity: {
        findOne: installationFindOne,
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      },
      pluginMenuContributionEntity: {
        find: jest.fn(async () => [...contributions]),
        save: jest.fn(async contribution => {
          contributions.push({ ...contribution, id: contributions.length + 1 });
          return contribution;
        }),
      },
      pluginRoleGrantEntity: {
        find: jest.fn().mockResolvedValue([
          {
            roleId: 4,
            contributionKey: 'route:example-plugin-items',
          },
        ]),
      },
      baseSysMenuEntity: { save: baseMenuSave },
      baseSysRoleMenuEntity: { save: roleMenuSave },
      baseSysUserRoleEntity: {
        find: jest.fn().mockResolvedValue([{ userId: 9, roleId: 4 }]),
      },
      baseSysPermsService: { refreshPerms: jest.fn() },
      pahNavigationService: { ensurePluginPreferredGroup },
    });

    await service.enable(MODULE_ID);

    expect(baseMenuSave).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        router: '/example-plugin/items',
        perms: 'example-plugin:item:read',
      })
    );
    expect(roleMenuSave).toHaveBeenCalledWith({ roleId: 4, menuId: 202 });
    expect(ensurePluginPreferredGroup).toHaveBeenCalledWith(
      MODULE_ID,
      'example-plugin-workbench',
      PAH_BUSINESS_NAVIGATION_GROUP_KEY
    );
  });

  it('按声明记录迁移应用与批次回滚', async () => {
    const migrationSave = jest.fn();
    const migrationUpdate = jest.fn();
    const service = new PahPluginService();
    Object.assign(service, {
      ctx: { admin: { username: 'admin' } },
      pluginInstallationEntity: {
        findOne: jest.fn().mockResolvedValue({
          id: 1,
          moduleId: MODULE_ID,
          manifest: manifest(),
        }),
      },
      pluginMigrationRecordEntity: {
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn().mockResolvedValue([]),
        save: migrationSave,
        update: migrationUpdate,
      },
    });

    await service.recordMigrationApplied(
      MODULE_ID,
      'example-plugin-bootstrap',
      'batch-1',
      { imported: 3 }
    );
    await service.recordMigrationRollback(MODULE_ID, 'batch-1');

    expect(migrationSave).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleId: MODULE_ID,
        migrationId: 'example-plugin-bootstrap',
        version: 1,
        checksum: MIGRATION_CHECKSUM,
        importBatchId: 'batch-1',
        state: 'applied',
        detail: '{"imported":3}',
      })
    );
    expect(migrationUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ state: 'rolled-back' })
    );
  });
});
