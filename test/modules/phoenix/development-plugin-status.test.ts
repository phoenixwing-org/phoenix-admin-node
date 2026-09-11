import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import * as path from 'path';
import { PAH_PLUGIN_FORMAT_VERSION } from '../../../src/modules/phoenix/interface/plugin';
import { PahDevelopmentPluginStatusService } from '../../../src/modules/phoenix/service/development-plugin-status';
import { retainVerifiedPluginPackage } from '../../../src/modules/phoenix/service/package-store';
import * as startupHealth from '../../../src/modules/phoenix/service/startup-health';

const MODULE_ID = 'example-plugin';

function manifest() {
  return {
    formatVersion: PAH_PLUGIN_FORMAT_VERSION,
    moduleId: MODULE_ID,
    name: 'Example Plugin',
    version: '0.1.0',
    publisher: 'Example Publisher',
    license: 'MIT',
    hostCompatibility: '>=0.2.2 <0.3.0',
    activationMode: 'restart' as const,
    entrypoints: {
      web: `vue/${MODULE_ID}/config.ts`,
      node: `midway/${MODULE_ID}/config.ts`,
    },
    routes: [
      {
        id: 'example-items',
        path: '/example/items',
        title: '示例',
        moduleId: 'example-workbench',
        capability: 'example:item:read',
        viewPath: `modules/${MODULE_ID}/views/items.vue`,
      },
    ],
    navigation: {
      preferredGroupId: 'pah-group-business',
      preferredGroupLabel: '业务',
      modules: [
        {
          id: 'example-workbench',
          label: '示例',
          routeIds: ['example-items'],
        },
      ],
    },
    apiPrefix: '/admin/example/',
    capabilities: [
      {
        id: 'example:item:read',
        description: '查看示例',
        risk: 'read' as const,
      },
    ],
    resourcePolicies: [],
    auditCategories: [],
    migrations: [],
    healthChecks: [],
    hostReuse: [],
    dataOwnership: { tables: [], retainedOnUninstall: true },
    uninstall: {
      retainDataByDefault: true,
      requiresBackup: true,
      purgeCapability: 'example:data:purge',
    },
  };
}

describe('开发插件就绪检测', () => {
  const originalNodeRoot = process.env.PHOENIX_ADMIN_NODE_ROOT;
  const originalVueRoot = process.env.PHOENIX_ADMIN_VUE_ROOT;
  let root: string;
  let nodeRoot: string;
  let vueRoot: string;
  let webSource: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'pah-development-status-'));
    nodeRoot = path.join(root, 'node');
    vueRoot = path.join(root, 'vue');
    webSource = path.join(root, 'product', 'vue', MODULE_ID);
    for (const [directory, name] of [
      [nodeRoot, 'phoenix-admin-node'],
      [vueRoot, 'phoenix-admin-vue'],
    ]) {
      mkdirSync(path.join(directory, 'src', 'modules'), { recursive: true });
      writeFileSync(
        path.join(directory, 'package.json'),
        JSON.stringify({ name })
      );
    }
    mkdirSync(webSource, { recursive: true });
    writeFileSync(path.join(webSource, 'config.ts'), 'export default {};\n');
    symlinkSync(webSource, path.join(vueRoot, 'src', 'modules', MODULE_ID));
    process.env.PHOENIX_ADMIN_NODE_ROOT = nodeRoot;
    process.env.PHOENIX_ADMIN_VUE_ROOT = vueRoot;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
    process.env.PHOENIX_ADMIN_NODE_ROOT = originalNodeRoot;
    process.env.PHOENIX_ADMIN_VUE_ROOT = originalVueRoot;
  });

  function service(
    installation: any = null,
    options: { complete?: boolean } = {}
  ) {
    const value = manifest();
    jest.spyOn(startupHealth, 'inspectPhoenixPluginModules').mockReturnValue({
      plugins: [
        {
          moduleId: MODULE_ID,
          origin: 'development',
          state: 'action-required',
          detail: '开发挂载已验证',
          pluginType: undefined,
          manifest: value,
          sourceCommit: 'a'.repeat(40),
          webSource,
          nodeSource: path.join(root, 'product', 'node', MODULE_ID),
        },
      ],
      ignoredModuleIds: [],
      ignoredDetectorPatterns: [],
    });
    const expectedContributions = [
      {
        moduleId: MODULE_ID,
        contributionKey: 'navigation.module:example-workbench',
        menuId: 10,
      },
      {
        moduleId: MODULE_ID,
        contributionKey: 'route:example-items',
        menuId: 11,
      },
      {
        moduleId: MODULE_ID,
        contributionKey: 'capability:example:item:read',
        menuId: 12,
      },
    ];
    const contributions = options.complete
      ? expectedContributions
      : expectedContributions.slice(0, 1);
    const result = new PahDevelopmentPluginStatusService();
    Object.assign(result, {
      ctx: { admin: { username: 'admin', roleIds: [1] } },
      pluginInstallationEntity: {
        find: jest.fn().mockResolvedValue(installation ? [installation] : []),
      },
      pluginMigrationRecordEntity: { find: jest.fn().mockResolvedValue([]) },
      pluginMenuContributionEntity: {
        find: jest.fn().mockResolvedValue(contributions),
      },
      navigationAssignmentEntity: {
        findBy: jest
          .fn()
          .mockResolvedValue(
            options.complete
              ? [{ targetKey: `plugin:${MODULE_ID}:example-workbench` }]
              : []
          ),
      },
      baseSysMenuEntity: {
        findBy: jest
          .fn()
          .mockResolvedValue(contributions.map(item => ({ id: item.menuId }))),
      },
      baseSysRoleMenuEntity: { findBy: jest.fn().mockResolvedValue([]) },
    });
    return result;
  }

  it('把双端挂载但无插件中心记录判定为待选择不可变包', async () => {
    const result = await service().inspect();

    expect(result.authority).toBe('pah-node');
    expect(result.plugins[0]).toEqual(
      expect.objectContaining({
        moduleId: MODULE_ID,
        readiness: expect.objectContaining({
          state: 'mounted-unregistered',
          nextAction: 'choose-package',
          reason: '开发源码已挂载，但 Phoenix 插件中心尚未登记该插件',
        }),
      })
    );
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it('已保留匹配开发源码的包时返回文件名和恢复启用动作', async () => {
    const packageBytes = Buffer.from('verified phoenix package');
    const packageSha256 = createHash('sha256')
      .update(packageBytes)
      .digest('hex');
    retainVerifiedPluginPackage({
      moduleId: MODULE_ID,
      version: '0.1.0',
      filename: 'example-plugin-0.1.0.phoenix.cool',
      packageSha256,
      packageBytes,
      sourceCommit: 'a'.repeat(40),
    });
    const otherPackageBytes = Buffer.from('other verified phoenix package');
    retainVerifiedPluginPackage({
      moduleId: MODULE_ID,
      version: '0.1.0',
      filename: 'example-plugin-0.1.0-other.phoenix.cool',
      packageSha256: createHash('sha256')
        .update(otherPackageBytes)
        .digest('hex'),
      packageBytes: otherPackageBytes,
      sourceCommit: 'b'.repeat(40),
    });

    const result = await service().inspect();

    expect(result.plugins[0]).toEqual(
      expect.objectContaining({
        retainedPackage: expect.objectContaining({
          filename: 'example-plugin-0.1.0.phoenix.cool',
          packageSha256,
          matchesMount: true,
        }),
        readiness: expect.objectContaining({
          state: 'mounted-unregistered',
          nextAction: 'restore-package',
        }),
      })
    );
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it('已启用但菜单或 assignment 缺失时只建议受控重物化', async () => {
    const value = manifest();
    const result = await service({
      moduleId: MODULE_ID,
      name: value.name,
      version: value.version,
      state: 'enabled',
      manifest: value,
    }).inspect();

    expect(result.plugins[0].readiness).toEqual(
      expect.objectContaining({
        state: 'enabled-contributions-missing',
        nextAction: 'repair',
      })
    );
    expect(result.plugins[0].contributions).toEqual(
      expect.objectContaining({ expected: 3, actual: 1 })
    );
  });

  it('Ribbon 已物化但当前角色无路由授权时明确标记权限过滤', async () => {
    const value = manifest();
    mkdirSync(path.join(nodeRoot, '.runtime'), { recursive: true });
    writeFileSync(
      path.join(nodeRoot, '.runtime', 'pah-plugin-health.json'),
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        plugins: [
          { moduleId: MODULE_ID, state: 'ready', version: value.version },
        ],
      })
    );
    const target = service(
      {
        moduleId: MODULE_ID,
        name: value.name,
        version: value.version,
        state: 'enabled',
        manifest: value,
      },
      { complete: true }
    );
    target.ctx = { admin: { username: 'reviewer', roleIds: [2] } } as any;

    const result = await target.inspect();

    expect(result.plugins[0].readiness).toEqual(
      expect.objectContaining({
        state: 'enabled-permission-filtered',
        nextAction: 'grant',
      })
    );
    expect(result.plugins[0].permissions).toEqual({
      accessibleVisibleRoutes: 0,
      filteredVisibleRoutes: 1,
    });
  });
});
