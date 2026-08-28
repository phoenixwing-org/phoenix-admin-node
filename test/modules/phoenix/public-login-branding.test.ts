import { createHash } from 'crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import {
  PahPublicLoginBrandingAssetDeclaration,
  serializePahPublicLoginBrandingBootstrap,
  validatePahPublicLoginBrandingContributions,
  validatePahPublicLoginBrandingSnapshot,
  withPahPublicLoginBrandingRevision,
} from '../../../src/modules/phoenix/interface/public-login-branding';
import {
  PAH_PLUGIN_FORMAT_VERSION,
  PahPluginManifest,
} from '../../../src/modules/phoenix/interface/plugin';
import { PahPublicLoginBrandingService } from '../../../src/modules/phoenix/service/public-login-branding';

const MODULE_ID = 'phoenix-branding';

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex');
}

function asset(
  name: string,
  content: Buffer,
  mime: PahPublicLoginBrandingAssetDeclaration['mime'] = 'image/svg+xml'
): PahPublicLoginBrandingAssetDeclaration {
  return {
    path: `vue/${MODULE_ID}/assets/${name}`,
    sha256: sha256(content),
    mime,
    size: content.length,
  };
}

function contribution(value: PahPublicLoginBrandingAssetDeclaration) {
  return {
    contractVersion: 1 as const,
    login: {
      id: `${MODULE_ID}-login`,
      mode: 'host-auth-shell' as const,
      eyebrow: 'ACME OPERATIONS',
      title: 'Acme Workspace',
      subtitle: '统一工作区',
      prompt: '使用管理员分配的账号安全登录。',
      presentation: 'split' as const,
    },
    brand: {
      id: `${MODULE_ID}-brand`,
      appName: 'Acme Workspace',
      titleTemplate: '%s · Acme Workspace',
      favicon: value,
      logo: value,
      logoDark: value,
      compactLogo: value,
      compactLogoDark: value,
    },
  };
}

function contributionV2(value: PahPublicLoginBrandingAssetDeclaration) {
  return {
    ...contribution(value),
    contractVersion: 2 as const,
    workbench: {
      title: 'Acme Workspace',
      subtitle: { mode: 'text' as const, text: '统一工作区' },
      logoVariant: 'compact' as const,
    },
  };
}

function manifest(value: PahPublicLoginBrandingAssetDeclaration) {
  return {
    formatVersion: PAH_PLUGIN_FORMAT_VERSION,
    moduleId: MODULE_ID,
    name: 'Acme 品牌插件',
    version: '0.1.0',
    publisher: 'PhoenixWing',
    license: 'MIT',
    pluginType: 'phoenix.admin.branding',
    hostCompatibility: '>=0.2.2 <0.3.0',
    activationMode: 'restart',
    routePrefix: `/${MODULE_ID}`,
    entrypoints: {
      web: `vue/${MODULE_ID}/config.ts`,
      node: `midway/${MODULE_ID}/config.ts`,
    },
    routes: [],
    navigation: {
      preferredGroupId: 'pah-group-business',
      preferredGroupLabel: '业务',
      modules: [],
    },
    apiPrefix: `/admin/${MODULE_ID}/`,
    capabilities: [
      {
        id: `${MODULE_ID}:data:purge`,
        description: '永久清理',
        risk: 'admin',
      },
    ],
    resourcePolicies: [],
    auditCategories: [],
    migrations: [],
    healthChecks: [],
    hostReuse: [],
    uiContributions: contribution(value),
    dataOwnership: { tables: [], retainedOnUninstall: true },
    uninstall: {
      retainDataByDefault: true,
      requiresBackup: true,
      purgeCapability: `${MODULE_ID}:data:purge`,
    },
  } as PahPluginManifest;
}

describe('Public Login Branding Snapshot', () => {
  it('内部同步脚本使用无扩展路由，避免 EPS 生成非法声明名', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/modules/base/controller/admin/open.ts'),
      'utf8'
    );
    expect(source).toContain("@Get('/public-login-branding'");
    expect(source).not.toContain("@Get('/public-login-branding.js'");
  });

  it('只接受品牌插件、严格字段与扩展名匹配的 MIME', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const valid = contribution(asset('logo.svg', svg));
    expect(
      validatePahPublicLoginBrandingContributions(
        MODULE_ID,
        'phoenix.admin.branding',
        valid
      )
    ).toEqual({ valid: true, errors: [] });

    const wrongMime = contribution(asset('logo.svg', svg, 'image/png'));
    expect(
      validatePahPublicLoginBrandingContributions(
        MODULE_ID,
        'phoenix.admin.branding',
        wrongMime
      ).errors
    ).toContain('uiContributions.brand.favicon.mime 与文件扩展名不匹配');
    expect(
      validatePahPublicLoginBrandingContributions(MODULE_ID, undefined, valid)
        .errors
    ).toContain('公开登录品牌贡献只允许 phoenix.admin.branding 插件声明');

    expect(
      validatePahPublicLoginBrandingContributions(
        MODULE_ID,
        'phoenix.admin.branding',
        contributionV2(asset('logo.svg', svg))
      )
    ).toEqual({ valid: true, errors: [] });
  });

  it('管理员配置 Host 工作台品牌后只发布静态 v2 快照', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-workbench-branding-'));
    const previousRoot = process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT;
    try {
      process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT = path.join(root, 'runtime');
      const rows = new Map<string, any>();
      let nextId = 1;
      const parameterRepository = {
        findOneBy: jest.fn(async ({ keyName }) => rows.get(keyName) || null),
        insert: jest.fn(async value => {
          if (rows.has(value.keyName)) throw new Error('duplicate key');
          const row = { id: nextId++, ...value };
          rows.set(value.keyName, row);
          return { identifiers: [{ id: row.id }] };
        }),
        update: jest.fn(async (where, value) => {
          const row = Array.from(rows.values()).find(
            candidate =>
              candidate.id === where.id && candidate.data === where.data
          );
          if (!row) return { affected: 0 };
          rows.set(row.keyName, { ...row, ...value });
          return { affected: 1 };
        }),
      };
      const service = new PahPublicLoginBrandingService();
      Object.assign(service, {
        ctx: { admin: { username: 'admin' } },
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        baseSysParamEntity: parameterRepository,
        pluginInstallationEntity: { findOne: jest.fn() },
      });
      const initial = await service.hostWorkbenchBrandingStatus();
      expect(initial.config.title).toBe('Phoenix Admin');

      const logoFile = path.join(root, 'logo.svg');
      const logo = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h8v8H0z"/></svg>'
      );
      writeFileSync(logoFile, logo);
      const saved = await service.saveHostWorkbenchBranding(
        {
          title: 'Acme Workspace',
          subtitleMode: 'text',
          subtitleText: '统一工作区',
          expectedRevision: initial.config.revision,
        },
        { data: logoFile, filename: 'acme.svg' }
      );
      expect(saved.activeSnapshot).toMatchObject({
        schemaVersion: 2,
        mode: 'host-default',
        workbench: {
          title: 'Acme Workspace',
          subtitle: { mode: 'text', text: '统一工作区' },
          logo: { sha256: sha256(logo) },
        },
      });
      expect(
        service.readPublicAsset(sha256(logo), 'workbench-logo.svg').content
      ).toEqual(logo);
      const lookupsBeforeBootstrap =
        parameterRepository.findOneBy.mock.calls.length;
      expect(service.bootstrapScript()).toContain('Acme Workspace');
      expect(service.bootstrapScript()).toContain('统一工作区');
      expect(parameterRepository.findOneBy).toHaveBeenCalledTimes(
        lookupsBeforeBootstrap
      );

      const reset = await service.resetHostWorkbenchBranding(
        saved.config.revision
      );
      expect(reset.config).toMatchObject({
        title: 'Phoenix Admin',
        subtitle: { mode: 'web-origin' },
      });
      expect(reset.activeSnapshot).toMatchObject({
        schemaVersion: 2,
        mode: 'host-default',
        workbench: {
          title: 'Phoenix Admin',
          subtitle: { mode: 'web-origin' },
        },
      });
    } finally {
      if (previousRoot === undefined)
        delete process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT;
      else process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT = previousRoot;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('拒绝过期配置 revision 与含活动内容的工作台 SVG', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-workbench-unsafe-'));
    const previousRoot = process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT;
    try {
      process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT = path.join(root, 'runtime');
      const service = new PahPublicLoginBrandingService();
      Object.assign(service, {
        ctx: { admin: { username: 'admin' } },
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        baseSysParamEntity: {
          findOneBy: jest.fn().mockResolvedValue(null),
          insert: jest.fn(),
          update: jest.fn(),
        },
      });
      const status = await service.hostWorkbenchBrandingStatus();
      await expect(
        service.saveHostWorkbenchBranding({
          title: 'Acme Workspace',
          subtitleMode: 'web-origin',
          expectedRevision: '0'.repeat(64),
        })
      ).rejects.toThrow('工作台品牌配置已变化');

      const logoFile = path.join(root, 'unsafe.svg');
      writeFileSync(logoFile, '<svg><script>alert(1)</script></svg>');
      await expect(
        service.saveHostWorkbenchBranding(
          {
            title: 'Acme Workspace',
            subtitleMode: 'web-origin',
            expectedRevision: status.config.revision,
          },
          { data: logoFile, filename: 'unsafe.svg' }
        )
      ).rejects.toThrow('包含活动内容或外链');
    } finally {
      if (previousRoot === undefined)
        delete process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT;
      else process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT = previousRoot;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('生成确定性、不可重定义且会转义脚本文本的 Host wrapper', () => {
    const mark = {
      url: '/mark.svg',
      sha256: 'a'.repeat(64),
      mime: 'image/svg+xml' as const,
      size: 12,
    };
    const snapshot = withPahPublicLoginBrandingRevision({
      schemaVersion: 1,
      mode: 'host-default',
      plugin: null,
      appName: 'Phoenix Admin',
      titleTemplate: '%s · Phoenix Admin',
      favicon: mark,
      login: {
        eyebrow: 'PHOENIXWING',
        title: 'Phoenix Admin Host',
        subtitle: 'Host default',
        prompt: '请登录',
        presentation: 'split',
      },
      assets: {
        logo: mark,
        logoDark: mark,
        compactLogo: mark,
        compactLogoDark: mark,
      },
    });
    expect(validatePahPublicLoginBrandingSnapshot(snapshot)).toBe(true);
    const script = serializePahPublicLoginBrandingBootstrap(snapshot);
    expect(script).toContain('configurable:false,writable:false');
    expect(script).not.toContain('configurable:true');
    expect(script).not.toContain('</script>');
  });

  it('品牌插件 v2 把工作台贡献编译进同一份静态快照', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-public-branding-v2-'));
    const previousRoot = process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT;
    const previousEnvironment = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'local';
      process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT = path.join(root, 'runtime');
      const moduleRoot = path.join(root, 'vue', 'src', 'modules', MODULE_ID);
      mkdirSync(path.join(moduleRoot, 'assets'), { recursive: true });
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      writeFileSync(path.join(moduleRoot, 'assets', 'logo.svg'), svg);
      const declaration = asset('logo.svg', svg);
      const pluginManifest = {
        ...manifest(declaration),
        uiContributions: contributionV2(declaration),
      } as PahPluginManifest;
      const service = new PahPublicLoginBrandingService();
      const snapshot = service.publishDevelopmentPreview(
        pluginManifest,
        'f'.repeat(64),
        moduleRoot
      );
      expect(snapshot).toMatchObject({
        schemaVersion: 2,
        mode: 'plugin',
        workbench: {
          title: 'Acme Workspace',
          subtitle: { mode: 'text', text: '统一工作区' },
          logo: { sha256: declaration.sha256 },
          logoDark: { sha256: declaration.sha256 },
        },
      });
      expect(validatePahPublicLoginBrandingSnapshot(snapshot)).toBe(true);
    } finally {
      if (previousRoot === undefined)
        delete process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT;
      else process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT = previousRoot;
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('只从插件目录复制哈希匹配、无活动内容的包内资源', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-public-branding-'));
    const previousRoot = process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT;
    try {
      process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT = path.join(root, 'runtime');
      const moduleRoot = path.join(root, 'vue', 'src', 'modules', MODULE_ID);
      mkdirSync(path.join(moduleRoot, 'assets'), { recursive: true });
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      writeFileSync(path.join(moduleRoot, 'assets', 'logo.svg'), svg);
      const declaration = asset('logo.svg', svg);
      const service = new PahPublicLoginBrandingService();
      const result = service.recordVerifiedPackage(
        manifest(declaration),
        'b'.repeat(64),
        moduleRoot
      );
      expect(result.recorded).toBe(true);
      expect(
        readFileSync(
          path.join(root, 'runtime', 'assets', declaration.sha256, 'logo.svg')
        )
      ).toEqual(svg);

      writeFileSync(
        path.join(moduleRoot, 'assets', 'logo.svg'),
        '<svg><script>alert(1)</script></svg>'
      );
      expect(() =>
        service.recordVerifiedPackage(
          manifest({
            ...declaration,
            sha256: sha256('<svg><script>alert(1)</script></svg>'),
            size: Buffer.byteLength('<svg><script>alert(1)</script></svg>'),
          }),
          'c'.repeat(64),
          moduleRoot
        )
      ).toThrow('包含活动内容或外链');

      for (const unsafe of [
        '<svg><image href="/track" /></svg>',
        '<svg><image href="relative.svg" /></svg>',
        '<svg><style>.x{fill:url(/track)}</style></svg>',
        '<svg><style>@import "relative.css"</style></svg>',
      ]) {
        writeFileSync(path.join(moduleRoot, 'assets', 'logo.svg'), unsafe);
        expect(() =>
          service.recordVerifiedPackage(
            manifest({
              ...declaration,
              sha256: sha256(unsafe),
              size: Buffer.byteLength(unsafe),
            }),
            sha256(`package:${unsafe}`),
            moduleRoot
          )
        ).toThrow('包含活动内容或外链');
      }
    } finally {
      if (previousRoot === undefined)
        delete process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT;
      else process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT = previousRoot;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('卸载事务清理同版本品牌收据且失败时可原样回滚', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-public-receipts-'));
    const previousRoot = process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT;
    try {
      process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT = path.join(root, 'runtime');
      const directory = path.join(
        root,
        'runtime',
        'receipts',
        MODULE_ID,
        '0.1.0'
      );
      const receipts = ['a'.repeat(64), 'b'.repeat(64)].map(digest => ({
        file: path.join(directory, `${digest}.json`),
        content: JSON.stringify({ packageSha256: digest }),
      }));
      for (const receipt of receipts) {
        mkdirSync(path.dirname(receipt.file), { recursive: true });
        writeFileSync(receipt.file, receipt.content);
      }

      const service = new PahPublicLoginBrandingService();
      const rollback = service.removeVerifiedPackageReceiptsForLifecycle(
        MODULE_ID,
        '0.1.0'
      );
      expect(existsSync(directory)).toBe(false);

      rollback();
      for (const receipt of receipts) {
        expect(readFileSync(receipt.file, 'utf8')).toBe(receipt.content);
      }
    } finally {
      if (previousRoot === undefined)
        delete process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT;
      else process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT = previousRoot;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('管理员显式选择后发布快照，生命周期停用先切默认且可回滚', async () => {
    const root = mkdtempSync(
      path.join(tmpdir(), 'pah-public-branding-select-')
    );
    const previousRoot = process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT;
    try {
      process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT = path.join(root, 'runtime');
      const moduleRoot = path.join(root, 'vue', 'src', 'modules', MODULE_ID);
      mkdirSync(path.join(moduleRoot, 'assets'), { recursive: true });
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      writeFileSync(path.join(moduleRoot, 'assets', 'logo.svg'), svg);
      const declaration = asset('logo.svg', svg);
      const pluginManifest = manifest(declaration);
      const service = new PahPublicLoginBrandingService();
      let selection: any = null;
      const parameterRepository = {
        findOneBy: jest.fn(async () => selection),
        insert: jest.fn(async value => {
          selection = { id: 1, ...value };
          return { identifiers: [{ id: 1 }] };
        }),
        update: jest.fn(async (where, value) => {
          if (
            !selection ||
            where.id !== selection.id ||
            where.data !== selection.data
          ) {
            return { affected: 0 };
          }
          selection = { ...selection, ...value };
          return { affected: 1 };
        }),
      };
      Object.assign(service, {
        ctx: { admin: { username: 'admin' } },
        logger: { warn: jest.fn(), error: jest.fn() },
        baseSysParamEntity: parameterRepository,
        pluginInstallationEntity: {
          findOne: jest.fn().mockResolvedValue({
            moduleId: MODULE_ID,
            version: '0.1.0',
            state: 'enabled',
            manifest: pluginManifest,
          }),
        },
      });
      service.recordVerifiedPackage(pluginManifest, 'd'.repeat(64), moduleRoot);

      const selected = await service.select(
        MODULE_ID,
        service.currentStatus().revision
      );
      expect(selected.mode).toBe('plugin');
      expect(service.currentStatus().appName).toBe('Acme Workspace');
      expect(service.bootstrapScript()).not.toContain('Phoenix Admin Host');

      const restore = await service.deactivateForLifecycle(MODULE_ID);
      expect(service.currentStatus().mode).toBe('host-default');
      await restore();
      expect(service.currentStatus().mode).toBe('plugin');
    } finally {
      if (previousRoot === undefined)
        delete process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT;
      else process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT = previousRoot;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('CAS 写入失败时把 current.json 对账到数据库中的有效赢家', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-public-branding-cas-'));
    const previousRoot = process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT;
    try {
      process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT = path.join(root, 'runtime');
      const moduleRoot = path.join(root, 'vue', 'src', 'modules', MODULE_ID);
      mkdirSync(path.join(moduleRoot, 'assets'), { recursive: true });
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      writeFileSync(path.join(moduleRoot, 'assets', 'logo.svg'), svg);
      const pluginManifest = manifest(asset('logo.svg', svg));
      const service = new PahPublicLoginBrandingService();
      let selection: any = null;
      let rejectNextUpdate = false;
      const parameterRepository = {
        findOneBy: jest.fn(async () => selection),
        insert: jest.fn(async value => {
          selection = { id: 1, ...value };
          return { identifiers: [{ id: 1 }] };
        }),
        update: jest.fn(async (where, value) => {
          if (rejectNextUpdate) {
            rejectNextUpdate = false;
            return { affected: 0 };
          }
          if (
            !selection ||
            where.id !== selection.id ||
            where.data !== selection.data
          ) {
            return { affected: 0 };
          }
          selection = { ...selection, ...value };
          return { affected: 1 };
        }),
      };
      Object.assign(service, {
        ctx: { admin: { username: 'admin' } },
        logger: { warn: jest.fn(), error: jest.fn() },
        baseSysParamEntity: parameterRepository,
        pluginInstallationEntity: {
          findOne: jest.fn().mockResolvedValue({
            moduleId: MODULE_ID,
            version: '0.1.0',
            state: 'enabled',
            manifest: pluginManifest,
          }),
        },
      });
      service.recordVerifiedPackage(pluginManifest, 'd'.repeat(64), moduleRoot);
      const plugin = await service.select(
        MODULE_ID,
        service.currentStatus().revision
      );

      rejectNextUpdate = true;
      await expect(service.reset(plugin.revision)).rejects.toThrow(
        '品牌选择已被其他管理员修改'
      );
      expect(service.currentStatus().mode).toBe('plugin');
      expect(service.currentStatus().revision).toBe(plugin.revision);
    } finally {
      if (previousRoot === undefined)
        delete process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT;
      else process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT = previousRoot;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('生命周期回滚前管理员已改选时不覆盖新选择', async () => {
    const root = mkdtempSync(
      path.join(tmpdir(), 'pah-public-branding-rollback-')
    );
    const previousRoot = process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT;
    try {
      process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT = path.join(root, 'runtime');
      const moduleRoot = path.join(root, 'vue', 'src', 'modules', MODULE_ID);
      mkdirSync(path.join(moduleRoot, 'assets'), { recursive: true });
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      writeFileSync(path.join(moduleRoot, 'assets', 'logo.svg'), svg);
      const pluginManifest = manifest(asset('logo.svg', svg));
      const service = new PahPublicLoginBrandingService();
      let selection: any = null;
      const parameterRepository = {
        findOneBy: jest.fn(async () => selection),
        insert: jest.fn(async value => {
          selection = { id: 1, ...value };
          return { identifiers: [{ id: 1 }] };
        }),
        update: jest.fn(async (where, value) => {
          if (
            !selection ||
            where.id !== selection.id ||
            where.data !== selection.data
          ) {
            return { affected: 0 };
          }
          selection = { ...selection, ...value };
          return { affected: 1 };
        }),
      };
      Object.assign(service, {
        ctx: { admin: { username: 'admin' } },
        logger: { warn: jest.fn(), error: jest.fn() },
        baseSysParamEntity: parameterRepository,
        pluginInstallationEntity: {
          findOne: jest.fn().mockResolvedValue({
            moduleId: MODULE_ID,
            version: '0.1.0',
            state: 'enabled',
            manifest: pluginManifest,
          }),
        },
      });
      service.recordVerifiedPackage(pluginManifest, 'e'.repeat(64), moduleRoot);
      const first = await service.select(
        MODULE_ID,
        service.currentStatus().revision
      );
      const rollback = await service.deactivateForLifecycle(MODULE_ID);
      const fallback = service.currentStatus();
      expect(fallback.mode).toBe('host-default');

      const newlySelected = await service.select(MODULE_ID, fallback.revision);
      const updatesBeforeRollback =
        parameterRepository.update.mock.calls.length;
      await rollback();

      expect(parameterRepository.update).toHaveBeenCalledTimes(
        updatesBeforeRollback
      );
      expect(service.currentStatus().revision).toBe(newlySelected.revision);
      expect(service.currentStatus().revision).toBe(first.revision);
    } finally {
      if (previousRoot === undefined)
        delete process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT;
      else process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT = previousRoot;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
