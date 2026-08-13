import { createHash } from 'crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { PAH_PLUGIN_FORMAT_VERSION } from '../../../src/modules/pah/interface/plugin';
import {
  inspectPhoenixPluginModules,
  PhoenixPluginStartupHealthService,
} from '../../../src/modules/pah/service/startup-health';

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

function manifest(moduleId: string, options: { branding?: boolean } = {}) {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const asset = (name: string) => ({
    path: `vue/${moduleId}/assets/${name}.svg`,
    sha256: sha256(svg),
    mime: 'image/svg+xml',
    size: svg.length,
  });
  return {
    formatVersion: PAH_PLUGIN_FORMAT_VERSION,
    ...(options.branding ? { pluginType: 'phoenix.admin.branding' } : {}),
    moduleId,
    name: options.branding ? 'Acme 品牌插件' : 'Example Plugin',
    version: '0.1.0',
    publisher: 'PhoenixWing',
    license: 'MIT',
    hostCompatibility: '>=0.2.2 <0.3.0',
    activationMode: 'restart',
    routePrefix: `/${moduleId}`,
    entrypoints: {
      web: `vue/${moduleId}/config.ts`,
      node: `midway/${moduleId}/config.ts`,
    },
    routes: [],
    navigation: {
      preferredGroupId: 'pah-group-business',
      preferredGroupLabel: '业务',
      modules: [],
    },
    apiPrefix: `/admin/${moduleId}/`,
    capabilities: [
      {
        id: `${moduleId}:data:purge`,
        description: '永久清理',
        risk: 'admin',
      },
    ],
    resourcePolicies: [],
    auditCategories: [],
    migrations: [],
    healthChecks: [],
    hostReuse: [],
    ...(options.branding
      ? {
          uiContributions: {
            contractVersion: 1,
            login: {
              id: `${moduleId}-login`,
              mode: 'host-auth-shell',
              eyebrow: 'ACME',
              title: 'Acme Workspace',
              subtitle: '统一工作区',
              prompt: '使用管理员账号登录。',
              presentation: 'split',
            },
            brand: {
              id: `${moduleId}-brand`,
              appName: 'Acme Workspace',
              titleTemplate: '%s · Acme Workspace',
              favicon: asset('favicon'),
              logo: asset('logo'),
              logoDark: asset('logo-dark'),
              compactLogo: asset('logo-compact'),
              compactLogoDark: asset('logo-compact-dark'),
            },
          },
        }
      : {}),
    dataOwnership: { tables: [], retainedOnUninstall: true },
    uninstall: {
      retainDataByDefault: true,
      requiresBackup: true,
      purgeCapability: `${moduleId}:data:purge`,
    },
  };
}

interface Fixture {
  root: string;
  hostRoot: string;
  productRoot: string;
  manifestFile: string;
  nodeSource: string;
  webSource: string;
  sourceCommit: string;
}

function fixture(
  moduleId: string,
  options: { branding?: boolean; entry?: boolean } = {}
): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'phoenix-plugin-health-'));
  const hostRoot = path.join(root, 'host');
  const productRoot = path.join(root, 'product');
  const packageRoot = path.join(productRoot, 'packages', 'admin-plugin');
  const nodeSource = path.join(packageRoot, 'midway', moduleId);
  const webSource = path.join(packageRoot, 'vue', moduleId);
  const manifestFile = path.join(packageRoot, 'manifest.json');
  mkdirSync(path.join(hostRoot, 'src', 'modules'), { recursive: true });
  mkdirSync(nodeSource, { recursive: true });
  mkdirSync(path.join(webSource, 'assets'), { recursive: true });
  if (options.entry !== false) {
    writeFileSync(
      path.join(nodeSource, 'config.ts'),
      'export default () => ({});\n'
    );
  }
  writeFileSync(
    path.join(webSource, 'config.ts'),
    'export default () => ({});\n'
  );
  const value = manifest(moduleId, options);
  writeFileSync(manifestFile, `${JSON.stringify(value, null, 2)}\n`);
  for (const declaration of Object.values(
    (value as any).uiContributions?.brand || {}
  ) as Array<{ path?: string }>) {
    if (!declaration?.path) continue;
    const target = path.join(packageRoot, declaration.path.slice('vue/'.length));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  }
  execFileSync('git', ['init', '-q'], { cwd: productRoot });
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: productRoot });
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], {
    cwd: productRoot,
  });
  execFileSync('git', ['add', '.'], { cwd: productRoot });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: productRoot });
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: productRoot,
    encoding: 'utf8',
  }).trim();
  symlinkSync(nodeSource, path.join(hostRoot, 'src', 'modules', moduleId), 'dir');
  return {
    root,
    hostRoot,
    productRoot,
    manifestFile,
    nodeSource,
    webSource,
    sourceCommit,
  };
}

function mergeFixture(target: Fixture, moduleId: string, source: Fixture) {
  symlinkSync(
    source.nodeSource,
    path.join(target.hostRoot, 'src', 'modules', moduleId),
    'dir'
  );
}

describe('Phoenix 插件启动健康检查', () => {
  const roots: string[] = [];
  const originalNodeEnv = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'local';
  });
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('无需 Hub marker，从真实 symlink 产品仓发布安全品牌预览', async () => {
    const value = fixture('phoenix-branding', { branding: true });
    roots.push(value.root);
    const branding = {
      publishDevelopmentPreview: jest.fn(() => ({ mode: 'plugin' })),
      publishDevelopmentFallback: jest.fn(),
    };
    const service = new PhoenixPluginStartupHealthService();
    Object.assign(service, {
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      pluginInstallationEntity: { findOne: jest.fn() },
      pluginMigrationRecordEntity: { find: jest.fn() },
      pahPublicLoginBrandingService: branding,
    });

    const report = inspectPhoenixPluginModules(value.hostRoot);
    expect(report.plugins[0]).toEqual(
      expect.objectContaining({
        moduleId: 'phoenix-branding',
        origin: 'development',
        state: 'ready',
        sourceCommit: value.sourceCommit,
        sourceIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
    );
    expect(report.ignoredDetectorPatterns).toEqual([
      '**/modules/phoenix-branding/**',
    ]);
    expect(report.ignoredModuleIds).toEqual(['phoenix-branding']);
    const result = await service.inspectOnStartup(value.hostRoot);
    expect(result.state).toBe('ready');
    expect(branding.publishDevelopmentPreview).toHaveBeenCalledWith(
      expect.objectContaining({ moduleId: 'phoenix-branding' }),
      report.plugins[0].sourceIdentitySha256,
      expect.stringMatching(/packages\/admin-plugin\/vue\/phoenix-branding$/)
    );
    expect((service as any).pluginInstallationEntity.findOne).not.toHaveBeenCalled();
    expect((service as any).pluginMigrationRecordEntity.find).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        readFileSync(
          path.join(value.hostRoot, '.runtime', 'pah-plugin-health.json'),
          'utf8'
        )
      ).state
    ).toBe('ready');
  });

  it.each([
    ['endpoint', (value: any) => (value.capabilities[0].endpoints = [{ method: 'GET', path: `/admin/${value.moduleId}/status` }])],
    ['ddl', (value: any) => value.migrations.push({ id: `${value.moduleId}-ddl`, version: 1, checksum: `sha256:${'a'.repeat(64)}`, description: 'unsafe', artifact: { format: 'sql', path: 'migrations/0001.sql' } })],
    ['table', (value: any) => value.dataOwnership.tables.push('unsafe_table')],
    ['health', (value: any) => value.healthChecks.push({ id: `${value.moduleId}-health`, path: `/admin/${value.moduleId}/health` })],
  ])('品牌包含 %s 运行时能力时隔离并回退默认', async (_label, mutate) => {
    const value = fixture(`brand-${_label}`, { branding: true });
    roots.push(value.root);
    const input = JSON.parse(readFileSync(value.manifestFile, 'utf8'));
    mutate(input);
    writeFileSync(value.manifestFile, `${JSON.stringify(input)}\n`);
    execFileSync('git', ['add', '.'], { cwd: value.productRoot });
    execFileSync('git', ['commit', '-qm', `unsafe ${_label}`], {
      cwd: value.productRoot,
    });
    const report = inspectPhoenixPluginModules(value.hostRoot);
    expect(report.plugins[0]).toEqual(
      expect.objectContaining({
        pluginType: 'phoenix.admin.branding',
        state: 'quarantined',
      })
    );
    expect(report.ignoredDetectorPatterns).toContain(
      `**/modules/brand-${_label}/**`
    );
    const branding = {
      publishDevelopmentPreview: jest.fn(),
      publishDevelopmentFallback: jest.fn(),
    };
    const service = new PhoenixPluginStartupHealthService();
    Object.assign(service, {
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      pluginInstallationEntity: { findOne: jest.fn() },
      pluginMigrationRecordEntity: { find: jest.fn() },
      pahPublicLoginBrandingService: branding,
    });
    await service.inspectOnStartup(value.hostRoot);
    expect(branding.publishDevelopmentPreview).not.toHaveBeenCalled();
    expect(branding.publishDevelopmentFallback).toHaveBeenCalledTimes(1);
  });

  it('品牌 manifest 未归档、无效或缺双端入口时隔离并回退 Host 默认', async () => {
    const dirty = fixture('brand-dirty', { branding: true });
    const invalid = fixture('brand-invalid', { branding: true });
    const missing = fixture('brand-missing', {
      branding: true,
      entry: false,
    });
    roots.push(dirty.root, invalid.root, missing.root);
    writeFileSync(
      dirty.manifestFile,
      `${readFileSync(dirty.manifestFile, 'utf8')}\n`
    );
    const invalidManifest = JSON.parse(readFileSync(invalid.manifestFile, 'utf8'));
    invalidManifest.apiPrefix = '/admin/outside/';
    writeFileSync(invalid.manifestFile, JSON.stringify(invalidManifest));

    expect(inspectPhoenixPluginModules(dirty.hostRoot).plugins[0]).toEqual(
      expect.objectContaining({
        state: 'quarantined',
        detail: '开发挂载 manifest 或双端 payload 存在未归档修改',
      })
    );
    expect(inspectPhoenixPluginModules(invalid.hostRoot).plugins[0]).toEqual(
      expect.objectContaining({ state: 'quarantined' })
    );
    expect(inspectPhoenixPluginModules(missing.hostRoot).plugins[0]).toEqual(
      expect.objectContaining({
        state: 'quarantined',
        detail: '开发挂载缺少 Node/Vue config.ts 入口',
      })
    );

    const branding = {
      publishDevelopmentPreview: jest.fn(),
      publishDevelopmentFallback: jest.fn(),
    };
    const service = new PhoenixPluginStartupHealthService();
    Object.assign(service, {
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      pluginInstallationEntity: { findOne: jest.fn() },
      pluginMigrationRecordEntity: { find: jest.fn() },
      pahPublicLoginBrandingService: branding,
    });
    await service.inspectOnStartup(dirty.hostRoot);
    expect(branding.publishDevelopmentPreview).not.toHaveBeenCalled();
    expect(branding.publishDevelopmentFallback).toHaveBeenCalledTimes(1);
  });

  it('多个品牌开发 symlink 一律隔离，不隐式选择', () => {
    const first = fixture('brand-alpha', { branding: true });
    const second = fixture('brand-beta', { branding: true });
    roots.push(first.root, second.root);
    mergeFixture(first, 'brand-beta', second);

    const report = inspectPhoenixPluginModules(first.hostRoot);
    expect(report.plugins).toHaveLength(2);
    expect(report.plugins.every(item => item.state === 'quarantined')).toBe(true);
    expect(report.plugins[0].detail).toContain('多个开发品牌插件');
  });

  it('普通开发 symlink 为 action-required；无启动收据的正式目录在 detector 前隔离', () => {
    const value = fixture('development-plugin');
    roots.push(value.root);
    mkdirSync(path.join(value.hostRoot, 'src', 'modules', 'release-plugin'));
    writeFileSync(
      path.join(value.hostRoot, 'src', 'modules', 'release-plugin', 'config.js'),
      'module.exports = () => ({});'
    );

    const report = inspectPhoenixPluginModules(value.hostRoot);
    expect(report.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          moduleId: 'development-plugin',
          origin: 'development',
          state: 'action-required',
        }),
        expect.objectContaining({
          moduleId: 'release-plugin',
          origin: 'release',
          state: 'quarantined',
          detail: expect.stringContaining('Host 激活收据'),
        }),
      ])
    );
    expect(report.ignoredDetectorPatterns).toContain(
      '**/modules/release-plugin/**'
    );
  });

  it('目录在 readdir 与 lstat 之间消失时 fail-closed 而不抛出', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'phoenix-plugin-race-'));
    roots.push(root);
    const modulesRoot = path.join(root, 'src', 'modules');
    mkdirSync(path.join(modulesRoot, 'race-plugin'), { recursive: true });

    expect(() =>
      inspectPhoenixPluginModules(root, {
        readdir: () => ['race-plugin'],
        lstat: () => {
          throw Object.assign(new Error('removed'), { code: 'ENOENT' });
        },
      })
    ).not.toThrow();
    const report = inspectPhoenixPluginModules(root, {
      readdir: () => ['race-plugin'],
      lstat: () => {
        throw Object.assign(new Error('removed'), { code: 'ENOENT' });
      },
    });
    expect(report.plugins[0]).toEqual(
      expect.objectContaining({
        moduleId: 'race-plugin',
        state: 'quarantined',
        detail: '模块目录在扫描期间发生变化，已隔离',
      })
    );
    expect(report.ignoredDetectorPatterns).toEqual([
      '**/modules/race-plugin/**',
    ]);
  });

  it('普通目录不会先被 detector 导入，DB/ledger 正常也只报告 action-required', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'phoenix-plugin-health-release-'));
    roots.push(root);
    mkdirSync(path.join(root, 'src', 'modules', 'broken-plugin'), {
      recursive: true,
    });
    mkdirSync(path.join(root, 'src', 'modules', 'ready-plugin'), {
      recursive: true,
    });
    for (const moduleId of ['broken-plugin', 'ready-plugin']) {
      writeFileSync(
        path.join(root, 'src', 'modules', moduleId, 'config.js'),
        'module.exports = () => ({});'
      );
    }
    const installations = {
      'ready-plugin': {
        moduleId: 'ready-plugin',
        state: 'enabled',
        manifest: manifest('ready-plugin'),
      },
    } as const;
    const service = new PhoenixPluginStartupHealthService();
    Object.assign(service, {
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      pahPublicLoginBrandingService: {},
      pluginInstallationEntity: {
        findOne: jest
          .fn()
          .mockRejectedValueOnce(new Error('boom'))
          .mockResolvedValueOnce(installations['ready-plugin']),
      },
      pluginMigrationRecordEntity: { find: jest.fn(async () => []) },
    });

    const result = await service.inspectOnStartup(root);
    expect(result.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          moduleId: 'broken-plugin',
          state: 'quarantined',
        }),
        expect.objectContaining({
          moduleId: 'ready-plugin',
          state: 'action-required',
          detail: expect.stringContaining('仍缺 detector 前 Host 激活收据'),
        }),
      ])
    );
    const beforeReady = inspectPhoenixPluginModules(root);
    expect(beforeReady.ignoredDetectorPatterns).toEqual([
      '**/modules/broken-plugin/**',
      '**/modules/ready-plugin/**',
    ]);
  });
});
