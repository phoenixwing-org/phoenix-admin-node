import { createHash } from 'crypto';
import {
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
import { PahPluginManifest } from '../../../src/modules/phoenix/interface/plugin';
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

function manifest(value: PahPublicLoginBrandingAssetDeclaration) {
  return {
    moduleId: MODULE_ID,
    version: '0.1.0',
    pluginType: 'phoenix.admin.branding',
    uiContributions: contribution(value),
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
