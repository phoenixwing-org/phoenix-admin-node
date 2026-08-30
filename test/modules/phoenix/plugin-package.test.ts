import { createHash } from 'crypto';
import * as fs from 'fs';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { PAH_PLUGIN_FORMAT_VERSION } from '../../../src/modules/phoenix/interface/plugin';
import { PahLocalPluginBackupService } from '../../../src/modules/phoenix/service/local-backup';
import {
  PahPluginPackageService,
  resolvePahHostRoots,
} from '../../../src/modules/phoenix/service/package';
import {
  pahPluginActivationCandidateFile,
  PahPluginRuntimeActivationService,
} from '../../../src/modules/phoenix/service/runtime-activation';

const MODULE_ID = 'example-plugin';

function sha256(content: Buffer) {
  return createHash('sha256').update(content).digest('hex');
}

function createPackage(output: string) {
  const AdmZip = require('adm-zip');
  const manifest = {
    formatVersion: PAH_PLUGIN_FORMAT_VERSION,
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
        icon: 'pnw:list',
        moduleId: 'example-plugin-workbench',
        capability: 'example-plugin:item:read',
        viewPath: 'modules/example-plugin/views/items.vue',
      },
    ],
    navigation: {
      preferredGroupId: 'pah-group-business',
      preferredGroupLabel: '业务',
      modules: [
        {
          id: 'example-plugin-workbench',
          label: '示例工作台',
          icon: 'pnw:folder',
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
    migrations: [],
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
  const metadata = {
    kind: 'pah-business-module',
    moduleId: MODULE_ID,
    version: manifest.version,
    manifest: 'manifest.json',
    integrity: 'integrity.json',
    source: { commit: 'a'.repeat(40), dirty: false },
    installerCompatibility: {
      pahBusinessModule: true,
      coolNativeHook: false,
    },
    payloads: [
      {
        runtime: 'node',
        source: `payload/node/${MODULE_ID}`,
        target: `src/modules/${MODULE_ID}`,
      },
      {
        runtime: 'vue',
        source: `payload/vue/${MODULE_ID}`,
        target: `src/modules/${MODULE_ID}`,
      },
    ],
  };
  const files = new Map<string, Buffer>([
    ['plugin.json', Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`)],
    ['manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)],
    [
      `payload/node/${MODULE_ID}/config.ts`,
      Buffer.from('export default { module: "example-plugin" };\n'),
    ],
    [
      `payload/node/${MODULE_ID}/entity/item.ts`,
      Buffer.from('export class ExamplePluginItem {}\n'),
    ],
    [
      `payload/vue/${MODULE_ID}/config.ts`,
      Buffer.from('export default { module: "example-plugin" };\n'),
    ],
  ]);
  const integrity = {
    formatVersion: 1,
    algorithm: 'sha256',
    files: [...files.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([filePath, content]) => ({
        path: filePath,
        size: content.length,
        sha256: sha256(content),
      })),
  };
  const zip = new AdmZip();
  for (const [filePath, content] of files) zip.addFile(filePath, content);
  zip.addFile(
    'integrity.json',
    Buffer.from(`${JSON.stringify(integrity, null, 2)}\n`)
  );
  zip.writeZip(output);
}

describe('Phoenix 插件包本地装配', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalNodeRoot = process.env.PHOENIX_ADMIN_NODE_ROOT;
  const originalVueRoot = process.env.PHOENIX_ADMIN_VUE_ROOT;
  const originalDatabase = process.env.PAH_DB_DATABASE;
  const originalSynchronize = process.env.PAH_DB_SYNCHRONIZE;
  const originalInitialize = process.env.PAH_DB_INITIALIZE;
  const originalLocalPackageMode = process.env.PAH_LOCAL_PACKAGE_MODE;
  const postgresEnvironmentKeys = [
    'PAH_POSTGRES_SERVER_MAJOR',
    'PAH_POSTGRES_BIN',
    'PAH_PSQL_BIN',
    'PAH_PG_DUMP_BIN',
    'PAH_PG_RESTORE_BIN',
    'PAH_CREATEDB_BIN',
    'PAH_DROPDB_BIN',
    'PAH_DB_PASSWORD',
  ] as const;
  const originalPostgresEnvironment = new Map(
    postgresEnvironmentKeys.map(key => [key, process.env[key]])
  );
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'phoenix-plugin-package-'));
    for (const runtime of ['node', 'vue']) {
      const runtimeRoot = path.join(root, runtime);
      mkdirSync(runtimeRoot, { recursive: true });
      mkdirSync(path.join(runtimeRoot, '.git', 'info'), { recursive: true });
      writeFileSync(
        path.join(runtimeRoot, '.git', 'info', 'exclude'),
        '# local excludes\n'
      );
      writeFileSync(
        path.join(runtimeRoot, 'package.json'),
        JSON.stringify({ name: `phoenix-admin-${runtime}` })
      );
    }
    const nodeRoot = path.join(root, 'node');
    mkdirSync(path.join(nodeRoot, 'scripts'), { recursive: true });
    fs.copyFileSync(
      path.join(process.cwd(), 'scripts', 'pah-sync-runtime-entities.cjs'),
      path.join(nodeRoot, 'scripts', 'pah-sync-runtime-entities.cjs')
    );
    mkdirSync(path.join(nodeRoot, 'src', 'modules'), { recursive: true });
    writeFileSync(
      path.join(nodeRoot, 'src', 'entities.ts'),
      `import { pluginEntities } from './entities.plugin';\n` +
        `export const entities = [...pluginEntities];\n`
    );
    process.env.NODE_ENV = 'local';
    process.env.PHOENIX_ADMIN_NODE_ROOT = path.join(root, 'node');
    process.env.PHOENIX_ADMIN_VUE_ROOT = path.join(root, 'vue');
    process.env.PAH_DB_DATABASE = 'phoenix_admin_plugin_package_test';
    process.env.PAH_DB_SYNCHRONIZE = 'false';
    process.env.PAH_DB_INITIALIZE = 'false';
    delete process.env.PAH_LOCAL_PACKAGE_MODE;
    for (const key of postgresEnvironmentKeys) delete process.env[key];
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    process.env.NODE_ENV = originalNodeEnv;
    process.env.PHOENIX_ADMIN_NODE_ROOT = originalNodeRoot;
    process.env.PHOENIX_ADMIN_VUE_ROOT = originalVueRoot;
    process.env.PAH_DB_DATABASE = originalDatabase;
    process.env.PAH_DB_SYNCHRONIZE = originalSynchronize;
    process.env.PAH_DB_INITIALIZE = originalInitialize;
    if (originalLocalPackageMode === undefined) {
      delete process.env.PAH_LOCAL_PACKAGE_MODE;
    } else {
      process.env.PAH_LOCAL_PACKAGE_MODE = originalLocalPackageMode;
    }
    for (const [key, value] of originalPostgresEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function packageService() {
    const register = jest.fn().mockResolvedValue({
      moduleId: MODULE_ID,
      state: 'verified',
    });
    const service = new PahPluginPackageService();
    Object.assign(service, {
      pahPluginService: { register },
      pahPublicLoginBrandingService: {
        recordVerifiedPackage: jest.fn().mockReturnValue({ recorded: false }),
        removeVerifiedPackageReceipt: jest.fn(),
      },
      pahPluginRuntimeActivationService:
        new PahPluginRuntimeActivationService(),
      logger: { info: jest.fn(), error: jest.fn() },
    });
    return { service, register };
  }

  it('自动识别具名 worktree 中并列的 phoenix-admin-vue Host', () => {
    const namedNodeRoot = path.join(root, 'phoenix-admin-node');
    const namedVueRoot = path.join(root, 'phoenix-admin-vue');
    fs.renameSync(path.join(root, 'node'), namedNodeRoot);
    fs.renameSync(path.join(root, 'vue'), namedVueRoot);
    process.env.PHOENIX_ADMIN_NODE_ROOT = namedNodeRoot;
    delete process.env.PHOENIX_ADMIN_VUE_ROOT;

    expect(resolvePahHostRoots()).toEqual({
      nodeRoot: fs.realpathSync(namedNodeRoot),
      vueRoot: fs.realpathSync(namedVueRoot),
    });
  });

  it('只接受 .phoenix.cool 并装配 Node/Vue 后登记 manifest', async () => {
    const packagePath = path.join(root, 'example-plugin.phoenix.cool');
    createPackage(packagePath);
    const { service, register } = packageService();

    const result = await service.installLocalPackage({
      data: packagePath,
      filename: path.basename(packagePath),
    });

    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ moduleId: MODULE_ID, version: '0.1.0' })
    );
    expect(result).toEqual(
      expect.objectContaining({
        moduleId: MODULE_ID,
        version: '0.1.0',
        fileCount: 6,
        restartRequired: true,
        validationChecks: expect.arrayContaining([
          expect.objectContaining({ id: 'archive-safety' }),
          expect.objectContaining({ id: 'root-contract' }),
          expect.objectContaining({ id: 'identity-manifest' }),
          expect.objectContaining({ id: 'integrity-migrations' }),
          expect.objectContaining({ id: 'runtime-payloads' }),
          expect.objectContaining({ id: 'host-stage-register' }),
        ]),
      })
    );
    expect(
      existsSync(path.join(root, 'node', 'src/modules', MODULE_ID, 'config.ts'))
    ).toBe(true);
    expect(
      existsSync(path.join(root, 'vue', 'src/modules', MODULE_ID, 'config.ts'))
    ).toBe(true);
    for (const runtime of ['node', 'vue']) {
      expect(
        readFileSync(
          path.join(root, runtime, '.git', 'info', 'exclude'),
          'utf8'
        )
      ).toContain(`/src/modules/${MODULE_ID}\n`);
      expect(
        readdirSync(
          path.join(root, runtime, '.runtime', 'phoenix-plugin-stage')
        )
      ).toEqual([]);
    }
    expect(
      readFileSync(path.join(root, 'node', 'src', 'entities.plugin.ts'), 'utf8')
    ).not.toContain(`./modules/${MODULE_ID}/entity/item`);
    expect(
      JSON.parse(
        readFileSync(
          pahPluginActivationCandidateFile(
            path.join(root, 'node'),
            MODULE_ID
          ),
          'utf8'
        )
      ).packageSha256
    ).toBe(result.packageSha256);
  });

  it('根目录契约一次报告缺失文件和旧 payload 布局', async () => {
    const packagePath = path.join(root, 'legacy-layout.phoenix.cool');
    createPackage(packagePath);
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(packagePath);
    zip.deleteFile('manifest.json');
    zip.addFile(
      `payload/midway/${MODULE_ID}/config.ts`,
      Buffer.from('export default {};\n')
    );
    zip.writeZip(packagePath);
    const { service, register } = packageService();

    await expect(
      service.installLocalPackage({
        data: packagePath,
        filename: path.basename(packagePath),
      })
    ).rejects.toThrow(
      /失败阶段：根目录契约.*已通过：运行模式、上传边界、ZIP 与路径安全.*缺少根文件：manifest\.json.*包含旧布局：payload\/midway/
    );
    expect(register).not.toHaveBeenCalled();
  });

  it('明确拒绝旧 .pah.cool 后缀且不写入 Host', async () => {
    const packagePath = path.join(root, 'example-plugin.pah.cool');
    createPackage(packagePath);
    const { service, register } = packageService();

    await expect(
      service.installLocalPackage({
        data: packagePath,
        filename: path.basename(packagePath),
      })
    ).rejects.toThrow('旧插件后缀不兼容');

    expect(register).not.toHaveBeenCalled();
    expect(existsSync(path.join(root, 'node', 'src/modules', MODULE_ID))).toBe(
      false
    );
    expect(existsSync(path.join(root, 'vue', 'src/modules', MODULE_ID))).toBe(
      false
    );
    expect(
      existsSync(path.join(root, 'node', 'src', 'entities.plugin.ts'))
    ).toBe(false);
  });

  it('production 仅在显式安全安装器模式允许本机包接口', async () => {
    const packagePath = path.join(root, 'example-plugin.phoenix.cool');
    createPackage(packagePath);
    process.env.NODE_ENV = 'production';
    const blocked = packageService();

    await expect(
      blocked.service.installLocalPackage({
        data: packagePath,
        filename: path.basename(packagePath),
      })
    ).rejects.toThrow('正式环境必须通过受控部署编排');

    process.env.PAH_LOCAL_PACKAGE_MODE = 'true';
    const controlled = packageService();
    await expect(
      controlled.service.installLocalPackage({
        data: packagePath,
        filename: path.basename(packagePath),
      })
    ).resolves.toEqual(
      expect.objectContaining({ moduleId: MODULE_ID, version: '0.1.0' })
    );
  });

  it('重复选择同一不可变插件包时复用本机装配', async () => {
    const packagePath = path.join(root, 'example-plugin.phoenix.cool');
    createPackage(packagePath);
    const first = packageService();
    await first.service.installLocalPackage({
      data: packagePath,
      filename: path.basename(packagePath),
    });
    const second = packageService();

    await expect(
      second.service.installLocalPackage({
        data: packagePath,
        filename: path.basename(packagePath),
      })
    ).resolves.toEqual(expect.objectContaining({ moduleId: MODULE_ID }));
  });

  it('local 环境只在双端开发 symlink 与不可变包逐字节一致时登记', async () => {
    const packagePath = path.join(root, 'example-plugin.phoenix.cool');
    createPackage(packagePath);
    const externalRoot = path.join(root, 'external-product');
    const payloads = {
      node: {
        'config.ts': 'export default { module: "example-plugin" };\n',
        'entity/item.ts': 'export class ExamplePluginItem {}\n',
      },
      vue: {
        'config.ts': 'export default { module: "example-plugin" };\n',
      },
    } as const;
    for (const runtime of ['node', 'vue'] as const) {
      const source = path.join(externalRoot, runtime, MODULE_ID);
      for (const [name, content] of Object.entries(payloads[runtime])) {
        const file = path.join(source, name);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, content);
      }
      const modules = path.join(root, runtime, 'src', 'modules');
      mkdirSync(modules, { recursive: true });
      symlinkSync(source, path.join(modules, MODULE_ID));
    }
    const { service, register } = packageService();

    const result = await service.installLocalPackage({
      data: packagePath,
      filename: path.basename(packagePath),
    });

    expect(register).toHaveBeenCalledTimes(1);
    expect(result.restartRequired).toBe(true);
    const receipt = JSON.parse(
      readFileSync(
        pahPluginActivationCandidateFile(path.join(root, 'node'), MODULE_ID),
        'utf8'
      )
    );
    expect(receipt.payloadMode).toBe('development');
    expect(fs.lstatSync(path.join(root, 'node', 'src/modules', MODULE_ID)).isSymbolicLink()).toBe(
      true
    );
  });

  it('登记失败时精确清理本次新建的品牌收据与 Host payload', async () => {
    const packagePath = path.join(root, 'example-plugin.phoenix.cool');
    createPackage(packagePath);
    const removeVerifiedPackageReceipt = jest.fn();
    const service = new PahPluginPackageService();
    Object.assign(service, {
      pahPluginService: {
        register: jest.fn().mockRejectedValue(new Error('register failed')),
      },
      pahPublicLoginBrandingService: {
        recordVerifiedPackage: jest.fn().mockReturnValue({
          recorded: true,
          receiptCreated: true,
        }),
        removeVerifiedPackageReceipt,
      },
      pahPluginRuntimeActivationService:
        new PahPluginRuntimeActivationService(),
      logger: { info: jest.fn(), error: jest.fn() },
    });

    await expect(
      service.installLocalPackage({
        data: packagePath,
        filename: path.basename(packagePath),
      })
    ).rejects.toThrow('register failed');

    expect(removeVerifiedPackageReceipt).toHaveBeenCalledWith(
      MODULE_ID,
      '0.1.0',
      expect.stringMatching(/^[a-f0-9]{64}$/)
    );
    expect(existsSync(path.join(root, 'node', 'src/modules', MODULE_ID))).toBe(
      false
    );
    expect(existsSync(path.join(root, 'vue', 'src/modules', MODULE_ID))).toBe(
      false
    );
    expect(
      existsSync(
        pahPluginActivationCandidateFile(path.join(root, 'node'), MODULE_ID)
      )
    ).toBe(false);
  });

  it('清理已验证包后移除 Node/Vue 装配并允许重新选择', async () => {
    for (const runtime of ['node', 'vue']) {
      const target = path.join(root, runtime, 'src/modules', MODULE_ID);
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, 'config.ts'), 'export default {};\n');
    }
    const discardVerifiedPackage = jest.fn().mockResolvedValue({
      moduleId: MODULE_ID,
      state: 'uninstalled',
    });
    const service = new PahPluginPackageService();
    Object.assign(service, {
      pahPluginService: {
        getByModuleId: jest.fn().mockResolvedValue({
          moduleId: MODULE_ID,
          version: '0.1.0',
          state: 'verified',
        }),
        discardVerifiedPackage,
      },
      logger: { info: jest.fn(), error: jest.fn() },
    });

    await expect(service.discardLocalPackage(MODULE_ID)).resolves.toEqual(
      expect.objectContaining({
        moduleId: MODULE_ID,
        removedPayloads: ['node', 'vue'],
      })
    );
    expect(discardVerifiedPackage).toHaveBeenCalledWith(MODULE_ID);
    expect(existsSync(path.join(root, 'node', 'src/modules', MODULE_ID))).toBe(
      false
    );
    expect(existsSync(path.join(root, 'vue', 'src/modules', MODULE_ID))).toBe(
      false
    );
  });

  it('清理状态提交失败时恢复两个 Host payload', async () => {
    for (const runtime of ['node', 'vue']) {
      const target = path.join(root, runtime, 'src/modules', MODULE_ID);
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, 'config.ts'), 'export default {};\n');
    }
    const service = new PahPluginPackageService();
    Object.assign(service, {
      pahPluginService: {
        getByModuleId: jest.fn().mockResolvedValue({
          moduleId: MODULE_ID,
          version: '0.1.0',
          state: 'verified',
        }),
        discardVerifiedPackage: jest
          .fn()
          .mockRejectedValue(new Error('state changed')),
      },
      logger: { info: jest.fn(), error: jest.fn() },
    });

    await expect(service.discardLocalPackage(MODULE_ID)).rejects.toThrow(
      'state changed'
    );
    for (const runtime of ['node', 'vue']) {
      expect(
        existsSync(
          path.join(root, runtime, 'src/modules', MODULE_ID, 'config.ts')
        )
      ).toBe(true);
    }
  });

  it('拒绝清理开发者 symlink 挂载并保持外部源码不变', async () => {
    const external = path.join(root, 'external-plugin');
    mkdirSync(external, { recursive: true });
    writeFileSync(path.join(external, 'config.ts'), 'export default {};\n');
    const moduleParent = path.join(root, 'node', 'src/modules');
    mkdirSync(moduleParent, { recursive: true });
    symlinkSync(external, path.join(moduleParent, MODULE_ID));
    const service = new PahPluginPackageService();
    Object.assign(service, {
      pahPluginService: {
        getByModuleId: jest.fn().mockResolvedValue({
          moduleId: MODULE_ID,
          version: '0.1.0',
          state: 'verified',
        }),
        discardVerifiedPackage: jest.fn(),
      },
      logger: { info: jest.fn(), error: jest.fn() },
    });

    await expect(service.discardLocalPackage(MODULE_ID)).rejects.toThrow(
      '不是安装器管理的普通目录'
    );
    expect(existsSync(path.join(external, 'config.ts'))).toBe(true);
  });

  it('受控卸载事务式移除 Node/Vue payload 并要求重启 Host', async () => {
    for (const runtime of ['node', 'vue']) {
      const target = path.join(root, runtime, 'src/modules', MODULE_ID);
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, 'config.ts'), 'export default {};\n');
    }
    const uninstall = jest.fn().mockResolvedValue({
      moduleId: MODULE_ID,
      state: 'uninstalled',
      retainedTables: ['example_plugin_item'],
      purgedTables: [],
    });
    const removeVerifiedPackageReceiptsForLifecycle = jest
      .fn()
      .mockReturnValue(jest.fn());
    const service = new PahPluginPackageService();
    Object.assign(service, {
      pahPluginService: {
        getByModuleId: jest.fn().mockResolvedValue({
          moduleId: MODULE_ID,
          version: '0.1.0',
          state: 'disabled',
        }),
        uninstall,
      },
      pahPublicLoginBrandingService: {
        removeVerifiedPackageReceiptsForLifecycle,
      },
      logger: { info: jest.fn(), error: jest.fn() },
    });

    await expect(service.controlledUninstallLocal(MODULE_ID)).resolves.toEqual(
      expect.objectContaining({
        moduleId: MODULE_ID,
        version: '0.1.0',
        removedPayloads: ['node', 'vue'],
        restartRequired: true,
        cleanupPendingPayloads: [],
        installation: expect.objectContaining({
          state: 'uninstalled',
          retainedTables: ['example_plugin_item'],
          purgedTables: [],
        }),
      })
    );
    expect(uninstall).toHaveBeenCalledWith(MODULE_ID);
    expect(removeVerifiedPackageReceiptsForLifecycle).toHaveBeenCalledWith(
      MODULE_ID,
      '0.1.0'
    );
    expect(
      readFileSync(path.join(root, 'node', 'src', 'entities.plugin.ts'), 'utf8')
    ).toContain('export const pluginEntities = [];');
    for (const runtime of ['node', 'vue']) {
      expect(
        existsSync(path.join(root, runtime, 'src/modules', MODULE_ID))
      ).toBe(false);
      expect(
        readdirSync(
          path.join(
            root,
            runtime,
            '.runtime',
            'phoenix-plugin-recycle',
            'uninstall'
          )
        )
      ).toEqual([]);
    }
  });

  it('受控卸载状态提交失败时恢复两个 Host payload', async () => {
    for (const runtime of ['node', 'vue']) {
      const target = path.join(root, runtime, 'src/modules', MODULE_ID);
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, 'config.ts'), 'export default {};\n');
    }
    const restoreBrandingReceipts = jest.fn();
    const service = new PahPluginPackageService();
    Object.assign(service, {
      pahPluginService: {
        getByModuleId: jest.fn().mockResolvedValue({
          moduleId: MODULE_ID,
          version: '0.1.0',
          state: 'installed',
        }),
        uninstall: jest.fn().mockRejectedValue(new Error('state changed')),
      },
      pahPublicLoginBrandingService: {
        removeVerifiedPackageReceiptsForLifecycle: jest
          .fn()
          .mockReturnValue(restoreBrandingReceipts),
      },
      logger: { info: jest.fn(), error: jest.fn() },
    });

    await expect(service.controlledUninstallLocal(MODULE_ID)).rejects.toThrow(
      'state changed'
    );
    expect(restoreBrandingReceipts).toHaveBeenCalledTimes(1);
    for (const runtime of ['node', 'vue']) {
      expect(
        existsSync(
          path.join(root, runtime, 'src/modules', MODULE_ID, 'config.ts')
        )
      ).toBe(true);
    }
  });

  it('受控卸载回滚先预检双端目标，遇到并发占用时不产生半恢复', async () => {
    for (const runtime of ['node', 'vue']) {
      const target = path.join(root, runtime, 'src/modules', MODULE_ID);
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, 'config.ts'), 'export default {};\n');
    }
    const nodeTarget = path.join(root, 'node', 'src/modules', MODULE_ID);
    const service = new PahPluginPackageService();
    Object.assign(service, {
      pahPluginService: {
        getByModuleId: jest.fn().mockResolvedValue({
          moduleId: MODULE_ID,
          version: '0.1.0',
          state: 'disabled',
        }),
        uninstall: jest.fn().mockImplementation(async () => {
          mkdirSync(nodeTarget, { recursive: true });
          writeFileSync(path.join(nodeTarget, 'collision.txt'), 'occupied');
          throw new Error('state changed');
        }),
      },
      logger: { info: jest.fn(), error: jest.fn() },
    });

    await expect(service.controlledUninstallLocal(MODULE_ID)).rejects.toThrow(
      'payload 或实体清单自动恢复失败'
    );
    expect(existsSync(path.join(nodeTarget, 'collision.txt'))).toBe(true);
    expect(existsSync(path.join(root, 'vue', 'src/modules', MODULE_ID))).toBe(
      false
    );
    for (const runtime of ['node', 'vue']) {
      const recycleRoot = path.join(
        root,
        runtime,
        '.runtime',
        'phoenix-plugin-recycle',
        'uninstall'
      );
      const operations = readdirSync(recycleRoot);
      expect(operations).toHaveLength(1);
      expect(
        existsSync(
          path.join(recycleRoot, operations[0], MODULE_ID, 'config.ts')
        )
      ).toBe(true);
    }
  });

  it('受控卸载提交成功后回收清理异常不误报失败并返回残留', async () => {
    for (const runtime of ['node', 'vue']) {
      const target = path.join(root, runtime, 'src/modules', MODULE_ID);
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, 'config.ts'), 'export default {};\n');
    }
    const logger = { info: jest.fn(), error: jest.fn() };
    const service = new PahPluginPackageService();
    Object.assign(service, {
      pahPluginService: {
        getByModuleId: jest.fn().mockResolvedValue({
          moduleId: MODULE_ID,
          version: '0.1.0',
          state: 'disabled',
        }),
        uninstall: jest.fn().mockResolvedValue({
          moduleId: MODULE_ID,
          state: 'uninstalled',
        }),
      },
      logger,
    });
    const originalRmSync = fs.rmSync;
    const rmSpy = jest
      .spyOn(fs, 'rmSync')
      .mockImplementation((target, options) => {
        if (String(target).includes('phoenix-plugin-recycle/uninstall/')) {
          throw new Error('archive is busy');
        }
        return originalRmSync(target, options);
      });

    try {
      await expect(
        service.controlledUninstallLocal(MODULE_ID)
      ).resolves.toEqual(
        expect.objectContaining({
          removedPayloads: ['node', 'vue'],
          restartRequired: true,
          cleanupPendingPayloads: ['node', 'vue'],
          installation: expect.objectContaining({ state: 'uninstalled' }),
        })
      );
    } finally {
      rmSpy.mockRestore();
    }
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('archive cleanup pending')
    );
    for (const runtime of ['node', 'vue']) {
      expect(
        existsSync(path.join(root, runtime, 'src/modules', MODULE_ID))
      ).toBe(false);
      expect(
        readdirSync(
          path.join(
            root,
            runtime,
            '.runtime',
            'phoenix-plugin-recycle',
            'uninstall'
          )
        )
      ).toHaveLength(1);
    }
  });

  it('受控卸载拒绝开发者 symlink payload 且不提交状态', async () => {
    const external = path.join(root, 'external-uninstall-plugin');
    mkdirSync(external, { recursive: true });
    writeFileSync(path.join(external, 'config.ts'), 'export default {};\n');
    const moduleParent = path.join(root, 'node', 'src/modules');
    mkdirSync(moduleParent, { recursive: true });
    symlinkSync(external, path.join(moduleParent, MODULE_ID));
    const uninstall = jest.fn();
    const service = new PahPluginPackageService();
    Object.assign(service, {
      pahPluginService: {
        getByModuleId: jest.fn().mockResolvedValue({
          moduleId: MODULE_ID,
          version: '0.1.0',
          state: 'disabled',
        }),
        uninstall,
      },
      logger: { info: jest.fn(), error: jest.fn() },
    });

    await expect(service.controlledUninstallLocal(MODULE_ID)).rejects.toThrow(
      '不是安装器管理的普通目录'
    );
    expect(uninstall).not.toHaveBeenCalled();
    expect(existsSync(path.join(external, 'config.ts'))).toBe(true);
  });

  it('受控卸载拒绝越界的 modules symlink 与非法模块 ID', async () => {
    const externalModules = path.join(root, 'external-modules');
    const externalPayload = path.join(externalModules, MODULE_ID);
    mkdirSync(externalPayload, { recursive: true });
    writeFileSync(
      path.join(externalPayload, 'config.ts'),
      'export default {};\n'
    );
    const sourceRoot = path.join(root, 'node', 'src');
    mkdirSync(sourceRoot, { recursive: true });
    rmSync(path.join(sourceRoot, 'modules'), { recursive: true, force: true });
    symlinkSync(externalModules, path.join(sourceRoot, 'modules'));
    const uninstall = jest.fn();
    const service = new PahPluginPackageService();
    Object.assign(service, {
      pahPluginService: {
        getByModuleId: jest.fn().mockResolvedValue({
          moduleId: MODULE_ID,
          version: '0.1.0',
          state: 'disabled',
        }),
        uninstall,
      },
      logger: { info: jest.fn(), error: jest.fn() },
    });

    await expect(service.controlledUninstallLocal(MODULE_ID)).rejects.toThrow(
      '不是安装器管理的普通目录'
    );
    expect(uninstall).not.toHaveBeenCalled();
    expect(existsSync(path.join(externalPayload, 'config.ts'))).toBe(true);

    service.pahPluginService.getByModuleId = jest.fn().mockResolvedValue({
      moduleId: '../outside',
      version: '0.1.0',
      state: 'disabled',
    });
    await expect(service.controlledUninstallLocal(MODULE_ID)).rejects.toThrow(
      '插件模块 ID 不安全'
    );
    expect(uninstall).not.toHaveBeenCalled();
  });

  it('无落盘 payload 时仍提交卸载但不误报重启', async () => {
    const uninstall = jest.fn().mockResolvedValue({
      moduleId: MODULE_ID,
      state: 'uninstalled',
    });
    const service = new PahPluginPackageService();
    Object.assign(service, {
      pahPluginService: {
        getByModuleId: jest.fn().mockResolvedValue({
          moduleId: MODULE_ID,
          version: '0.1.0',
          state: 'disabled',
        }),
        uninstall,
      },
      logger: { info: jest.fn(), error: jest.fn() },
    });

    await expect(service.controlledUninstallLocal(MODULE_ID)).resolves.toEqual(
      expect.objectContaining({
        removedPayloads: [],
        restartRequired: false,
      })
    );
    expect(uninstall).toHaveBeenCalledWith(MODULE_ID);
  });

  it('有待执行 DDL 时先创建可信备份再绑定一次性计划', async () => {
    const service = new PahPluginPackageService();
    const migrationPlan = jest.fn().mockResolvedValue({
      planId: 'server-plan',
      backupRequired: true,
      items: [{ state: 'pending' }, { state: 'applied' }],
    });
    const installCompiled = jest.fn().mockResolvedValue({ state: 'installed' });
    const proof = {
      backupId: 'backup-example',
      moduleId: MODULE_ID,
      pluginVersion: '0.1.0',
      dataSourceName: 'default',
      createdAt: new Date().toISOString(),
      restoreProcedure: 'verified restore rehearsal',
    } as const;
    const createVerifiedBackup = jest.fn().mockResolvedValue({
      proof,
      backup: { backupId: proof.backupId, sha256: 'a'.repeat(64), size: 42 },
    });
    Object.assign(service, {
      pahPluginService: {
        getByModuleId: jest.fn().mockResolvedValue({
          moduleId: MODULE_ID,
          version: '0.1.0',
          state: 'verified',
        }),
        migrationPlan,
        installCompiled,
      },
      pahLocalPluginBackupService: {
        latestProof: jest.fn(),
        createVerifiedBackup,
      },
      logger: { info: jest.fn(), error: jest.fn() },
    });

    const result = await service.controlledInstallLocal(MODULE_ID);

    expect(migrationPlan).toHaveBeenCalledWith(MODULE_ID);
    expect(createVerifiedBackup).toHaveBeenCalledWith(MODULE_ID, '0.1.0');
    expect(installCompiled).toHaveBeenCalledWith(
      MODULE_ID,
      'server-plan',
      proof
    );
    expect(
      service.pahLocalPluginBackupService.latestProof
    ).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        appliedMigrations: 1,
        backup: expect.objectContaining({ backupId: proof.backupId }),
      })
    );
  });

  it('无待执行 DDL 时直接完成受控安装', async () => {
    const installCompiled = jest.fn().mockResolvedValue({ state: 'installed' });
    const latestProof = jest.fn();
    const createVerifiedBackup = jest.fn();
    const service = new PahPluginPackageService();
    Object.assign(service, {
      pahPluginService: {
        getByModuleId: jest.fn().mockResolvedValue({
          moduleId: MODULE_ID,
          version: '0.1.0',
          state: 'verified',
        }),
        migrationPlan: jest.fn().mockResolvedValue({
          planId: 'server-plan',
          backupRequired: false,
          items: [{ state: 'applied' }],
        }),
        installCompiled,
      },
      pahLocalPluginBackupService: { latestProof, createVerifiedBackup },
      logger: { info: jest.fn(), error: jest.fn() },
    });

    await expect(service.controlledInstallLocal(MODULE_ID)).resolves.toEqual(
      expect.objectContaining({
        appliedMigrations: 0,
      })
    );
    expect(latestProof).not.toHaveBeenCalled();
    expect(createVerifiedBackup).not.toHaveBeenCalled();
    expect(installCompiled).toHaveBeenCalledWith(
      MODULE_ID,
      'server-plan',
      undefined
    );
  });

  it('API 重启检查只由服务端解析运行制品，不接收浏览器路径', async () => {
    const service = new PahPluginPackageService();
    const migrationPlan = jest.fn().mockResolvedValue({
      items: [{ state: 'pending' }, { state: 'applied' }],
    });
    Object.assign(service, {
      pahPluginService: {
        getByModuleId: jest.fn().mockResolvedValue({
          moduleId: MODULE_ID,
          version: '0.1.0',
          state: 'verified',
        }),
        migrationPlan,
      },
    });

    await expect(service.localRuntimeStatus(MODULE_ID)).resolves.toEqual({
      moduleId: MODULE_ID,
      version: '0.1.0',
      ready: true,
      migrations: 2,
      pendingMigrations: 1,
    });
    expect(migrationPlan).toHaveBeenCalledWith(MODULE_ID);
  });

  it('本地备份实际经过 dump、list、恢复和临时库清理四段命令', async () => {
    process.env.PAH_PSQL_BIN = 'test-psql';
    process.env.PAH_PG_DUMP_BIN = 'test-pg-dump';
    process.env.PAH_PG_RESTORE_BIN = 'test-pg-restore';
    process.env.PAH_CREATEDB_BIN = 'test-createdb';
    process.env.PAH_DROPDB_BIN = 'test-dropdb';
    const service = new PahLocalPluginBackupService();
    const commands: Array<{ command: string; args: string[] }> = [];
    Object.assign(service, {
      backupGate: { registerVerifier: jest.fn() },
      commandRunner: jest.fn(async (command: string, args: string[]) => {
        commands.push({ command, args });
        if (args.length === 1 && args[0] === '--version') {
          return { stdout: `${command} (PostgreSQL) 16.10\n`, stderr: '' };
        }
        if (command === 'test-psql') {
          return { stdout: '160010\n', stderr: '' };
        }
        const fileIndex = args.indexOf('--file');
        if (fileIndex >= 0) {
          writeFileSync(args[fileIndex + 1], Buffer.from('verified-backup'));
        }
        return { stdout: '', stderr: '' };
      }),
    });
    service.init();

    const result = await service.createVerifiedBackup(MODULE_ID, '0.1.0');

    expect(result.backup.size).toBeGreaterThan(0);
    expect(result.backup.postgresMajor).toBe(16);
    expect(result.backup.postgresToolSource).toBe('individual-command');
    expect(commands.map(item => item.command)).toEqual([
      'test-psql',
      'test-psql',
      'test-pg-dump',
      'test-pg-restore',
      'test-createdb',
      'test-dropdb',
      'test-pg-dump',
      'test-pg-restore',
      'test-createdb',
      'test-pg-restore',
      'test-dropdb',
    ]);
    expect(
      commands.slice(0, 6).filter(item => item.args.includes('--version'))
    ).toHaveLength(5);
    expect(service.latestProof(MODULE_ID, '0.1.0')).toEqual(result.proof);
  });

  it('Windows 支持含空格的 bin 路径并在备份前检查五件套 exe', async () => {
    const postgresBin = path.join(root, 'PostgreSQL 16', 'bin');
    mkdirSync(postgresBin, { recursive: true });
    for (const name of [
      'psql',
      'pg_dump',
      'pg_restore',
      'createdb',
      'dropdb',
    ]) {
      writeFileSync(path.join(postgresBin, `${name}.exe`), 'test');
    }
    process.env.PAH_POSTGRES_BIN = postgresBin;
    const commands: Array<{ command: string; args: string[] }> = [];
    const service = new PahLocalPluginBackupService();
    Object.assign(service, {
      platform: 'win32',
      backupGate: { registerVerifier: jest.fn() },
      commandRunner: jest.fn(async (command: string, args: string[]) => {
        commands.push({ command, args });
        if (args.length === 1 && args[0] === '--version') {
          return { stdout: `${path.basename(command)} (PostgreSQL) 16.10` };
        }
        if (path.basename(command) === 'psql.exe') {
          return { stdout: '160010\n' };
        }
        const fileIndex = args.indexOf('--file');
        if (fileIndex >= 0) {
          writeFileSync(args[fileIndex + 1], Buffer.from('windows-backup'));
        }
        return { stdout: '', stderr: '' };
      }),
    });
    service.init();

    const result = await service.createVerifiedBackup(MODULE_ID, '0.1.0');

    expect(result.backup.postgresToolSource).toBe('configured-bin');
    expect(
      commands
        .filter(item => item.args.includes('--version'))
        .map(item => path.basename(item.command))
    ).toEqual([
      'psql.exe',
      'pg_dump.exe',
      'pg_restore.exe',
      'createdb.exe',
      'dropdb.exe',
    ]);
    expect(JSON.stringify(result)).not.toContain(postgresBin);
  });

  it('psql 缺失时在执行备份前给出脱敏且可操作的 Windows 提示', async () => {
    const secretPath = path.join(root, 'secret postgres', 'psql.exe');
    process.env.PAH_PSQL_BIN = secretPath;
    process.env.PAH_DB_PASSWORD = 'never-print-this-password';
    const commandRunner = jest.fn(async () => {
      const error = new Error(`spawn ${secretPath} ENOENT`);
      Object.assign(error, { code: 'ENOENT' });
      throw error;
    });
    const service = new PahLocalPluginBackupService();
    Object.assign(service, {
      backupGate: { registerVerifier: jest.fn() },
      commandRunner,
    });
    service.init();

    let message = '';
    try {
      await service.createVerifiedBackup(MODULE_ID, '0.1.0');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('PostgreSQL CLI 前置检查失败：psql 不可用');
    expect(message).toContain('PAH_POSTGRES_BIN');
    expect(message).toContain('PAH_PSQL_BIN');
    expect(message).not.toContain(secretPath);
    expect(message).not.toContain('ENOENT');
    expect(message).not.toContain('never-print-this-password');
    expect(commandRunner).toHaveBeenCalledTimes(1);
  });

  it('Windows 配置目录不完整时仅报告缺失工具名且零命令执行', async () => {
    const postgresBin = path.join(root, 'Private PostgreSQL', 'bin');
    mkdirSync(postgresBin, { recursive: true });
    for (const name of ['psql', 'pg_dump']) {
      writeFileSync(path.join(postgresBin, `${name}.exe`), 'test');
    }
    process.env.PAH_POSTGRES_BIN = postgresBin;
    const commandRunner = jest.fn();
    const service = new PahLocalPluginBackupService();
    Object.assign(service, {
      platform: 'win32',
      backupGate: { registerVerifier: jest.fn() },
      commandRunner,
    });
    service.init();

    let message = '';
    try {
      await service.createVerifiedBackup(MODULE_ID, '0.1.0');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('pg_restore、createdb、dropdb');
    expect(message).not.toContain(postgresBin);
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it('任一 PostgreSQL 客户端主版本不匹配时在 pg_dump 前失败', async () => {
    process.env.PAH_PSQL_BIN = 'test-psql';
    process.env.PAH_PG_DUMP_BIN = 'test-pg-dump';
    process.env.PAH_PG_RESTORE_BIN = 'test-pg-restore';
    process.env.PAH_CREATEDB_BIN = 'test-createdb';
    process.env.PAH_DROPDB_BIN = 'test-dropdb';
    const commands: string[] = [];
    const service = new PahLocalPluginBackupService();
    Object.assign(service, {
      backupGate: { registerVerifier: jest.fn() },
      commandRunner: jest.fn(async (command: string, args: string[]) => {
        commands.push(`${command} ${args.join(' ')}`);
        if (args.includes('--command')) return { stdout: '160010\n' };
        if (command === 'test-pg-restore') {
          return { stdout: 'pg_restore (PostgreSQL) 17.5' };
        }
        return { stdout: `${command} (PostgreSQL) 16.10` };
      }),
    });
    service.init();

    await expect(
      service.createVerifiedBackup(MODULE_ID, '0.1.0')
    ).rejects.toThrow('pg_restore 主版本 17 与服务端主版本 16 不一致');
    expect(commands.some(command => command.includes('--format=custom'))).toBe(
      false
    );
  });

  it('备份子命令失败时不回显底层路径、口令或 ENOENT', async () => {
    process.env.PAH_PSQL_BIN = 'test-psql';
    process.env.PAH_PG_DUMP_BIN = 'test-pg-dump';
    process.env.PAH_PG_RESTORE_BIN = 'test-pg-restore';
    process.env.PAH_CREATEDB_BIN = 'test-createdb';
    process.env.PAH_DROPDB_BIN = 'test-dropdb';
    process.env.PAH_DB_PASSWORD = 'never-print-this-password';
    const service = new PahLocalPluginBackupService();
    Object.assign(service, {
      backupGate: { registerVerifier: jest.fn() },
      commandRunner: jest.fn(async (command: string, args: string[]) => {
        if (args.includes('--command')) return { stdout: '160010\n' };
        if (args.length === 1 && args[0] === '--version') {
          return { stdout: `${command} (PostgreSQL) 16.10` };
        }
        throw new Error(
          `spawn /private/secret/${command} ENOENT never-print-this-password`
        );
      }),
    });
    service.init();

    let message = '';
    try {
      await service.createVerifiedBackup(MODULE_ID, '0.1.0');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('创建 PostgreSQL 自定义格式备份');
    expect(message).not.toContain('/private/secret');
    expect(message).not.toContain('ENOENT');
    expect(message).not.toContain('never-print-this-password');
  });
});

const realPostgresBackupTest =
  process.env.PAH_REAL_POSTGRES_BACKUP_TEST === '1' ? it : it.skip;

describe('PostgreSQL 真实可信备份门禁', () => {
  realPostgresBackupTest(
    '在显式隔离数据库完成五件套预检、dump 和真实恢复',
    async () => {
      const database = process.env.PAH_REAL_POSTGRES_DATABASE?.trim();
      const allowedDatabase =
        process.env.PAH_REAL_POSTGRES_ALLOWED_DATABASE?.trim();
      const postgresBin = process.env.PAH_REAL_POSTGRES_BIN?.trim();
      const host = process.env.PAH_REAL_POSTGRES_HOST?.trim();
      const port = process.env.PAH_REAL_POSTGRES_PORT?.trim();
      const username = process.env.PAH_REAL_POSTGRES_USERNAME?.trim();
      if (
        !database ||
        database !== allowedDatabase ||
        ['postgres', 'phoenix_admin', 'template0', 'template1'].includes(
          database
        ) ||
        !postgresBin ||
        !host ||
        !['127.0.0.1', '::1', 'localhost'].includes(host) ||
        !port ||
        !username
      ) {
        throw new Error(
          '真实备份测试要求显式 loopback、端口、用户、隔离数据库双重确认和 PostgreSQL bin'
        );
      }
      const originalEnvironment = new Map(
        [
          'NODE_ENV',
          'PHOENIX_ADMIN_NODE_ROOT',
          'PAH_DB_HOST',
          'PAH_DB_PORT',
          'PAH_DB_USERNAME',
          'PAH_DB_PASSWORD',
          'PAH_DB_DATABASE',
          'PAH_DB_SYNCHRONIZE',
          'PAH_DB_INITIALIZE',
          'PAH_POSTGRES_BIN',
          'PAH_POSTGRES_SERVER_MAJOR',
        ].map(key => [key, process.env[key]])
      );
      const testRoot = mkdtempSync(
        path.join(tmpdir(), 'phoenix-real-postgres-backup-')
      );
      try {
        process.env.NODE_ENV = 'local';
        process.env.PHOENIX_ADMIN_NODE_ROOT = testRoot;
        process.env.PAH_DB_HOST = host;
        process.env.PAH_DB_PORT = port;
        process.env.PAH_DB_USERNAME = username;
        process.env.PAH_DB_PASSWORD =
          process.env.PAH_REAL_POSTGRES_PASSWORD || '';
        process.env.PAH_DB_DATABASE = database;
        process.env.PAH_DB_SYNCHRONIZE = 'false';
        process.env.PAH_DB_INITIALIZE = 'false';
        process.env.PAH_POSTGRES_BIN = postgresBin;
        process.env.PAH_POSTGRES_SERVER_MAJOR =
          process.env.PAH_REAL_POSTGRES_SERVER_MAJOR || '16';
        const service = new PahLocalPluginBackupService();
        Object.assign(service, {
          backupGate: { registerVerifier: jest.fn() },
        });
        service.init();

        const result = await service.createVerifiedBackup(MODULE_ID, '0.1.0');

        expect(result.backup).toEqual(
          expect.objectContaining({
            size: expect.any(Number),
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            postgresMajor: 16,
            postgresToolSource: 'configured-bin',
          })
        );
        expect(result.backup.size).toBeGreaterThan(0);
        expect(JSON.stringify(result)).not.toContain(postgresBin);
        expect(service.latestProof(MODULE_ID, '0.1.0')).toEqual(result.proof);
      } finally {
        rmSync(testRoot, { recursive: true, force: true });
        for (const [key, value] of originalEnvironment) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    },
    120000
  );
});
