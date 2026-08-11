import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { PahPluginInstallationEntity } from '../../../src/modules/pah/entity/plugin';
import { PahPluginMigrationRecordEntity } from '../../../src/modules/pah/entity/migration-record';
import {
  canTransitionPahPlugin,
  PAH_PLUGIN_FORMAT_VERSION,
  PahPluginLifecycleState,
  PahPluginManifest,
  validatePahPluginManifest,
} from '../../../src/modules/pah/interface/plugin';
import {
  PAH_BUILTIN_NAVIGATION_GROUPS,
  PAH_BUSINESS_NAVIGATION_GROUP_KEY,
  PahNavigationService,
} from '../../../src/modules/pah/service/navigation';
import {
  checksumPahSqlArtifact,
  PahCompiledPluginRegistry,
  PahMigrationBackupGate,
  PahPluginMigrationService,
} from '../../../src/modules/pah/service/migration';
import { PahPluginService } from '../../../src/modules/pah/service/plugin';

const MODULE_ID = 'example-plugin';
const MIGRATION_FIXTURE_ROOT = path.resolve(
  __dirname,
  '../../fixtures/example-plugin'
);
const FIRST_MIGRATION_PATH = 'migrations/0001-create-items.sql';
const SECOND_MIGRATION_PATH = 'migrations/0002-index-items.sql';
const RUNTIME_ARTIFACT_PATH = 'runtime/example-runtime.cjs';
const FIRST_MIGRATION_SQL = readFileSync(
  path.join(MIGRATION_FIXTURE_ROOT, FIRST_MIGRATION_PATH)
);
const SECOND_MIGRATION_SQL = readFileSync(
  path.join(MIGRATION_FIXTURE_ROOT, SECOND_MIGRATION_PATH)
);
const MIGRATION_CHECKSUM = checksumPahSqlArtifact(FIRST_MIGRATION_SQL);
const SECOND_MIGRATION_CHECKSUM = checksumPahSqlArtifact(SECOND_MIGRATION_SQL);

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
      preferredGroupId: PAH_BUSINESS_NAVIGATION_GROUP_KEY,
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
    migrations: [
      {
        id: 'example-plugin-bootstrap',
        version: 1,
        checksum: MIGRATION_CHECKSUM,
        description: '初始化示例数据',
        artifact: { format: 'sql', path: FIRST_MIGRATION_PATH },
      },
      {
        id: 'example-plugin-index-items',
        version: 2,
        checksum: SECOND_MIGRATION_CHECKSUM,
        description: '建立示例检索索引',
        artifact: { format: 'sql', path: SECOND_MIGRATION_PATH },
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

  it('旧 manifest 格式不会被静默按 SQL v1 新契约解释', () => {
    const input = manifest();
    input.formatVersion = 1;
    expect(validatePahPluginManifest(input).errors).toContain(
      'formatVersion 不受支持'
    );
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
    input.migrations = input.migrations.map(item => ({
      ...item,
      id: item.id.replace('example-plugin-', 'example-plugin-engine-'),
    }));
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

  it('只允许 manifest 持久化显式命名空间图标 ID', () => {
    const input = manifest();
    input.routes[0].icon = 'document';
    input.navigation.modules[0].icon = 'folder-opened';

    expect(validatePahPluginManifest(input).errors).toEqual(
      expect.arrayContaining([
        '路由图标必须使用显式命名空间：document',
        '导航模块图标必须使用显式命名空间：folder-opened',
      ])
    );

    input.routes[0].icon = 'vendor:issue.list';
    input.navigation.modules[0].icon = 'cool:folder';
    expect(validatePahPluginManifest(input)).toEqual({
      valid: true,
      errors: [],
    });
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
        artifact: { format: 'sql', path: '../unsafe.sql' },
      },
    ];
    const errors = validatePahPluginManifest(input).errors;
    expect(errors).toContain(
      '路由引用未声明能力码：example-plugin:item:unknown'
    );
    expect(errors).toContain('迁移 ID 越界：other-module-migration');
    expect(errors).toContain('迁移版本必须是正整数：other-module-migration');
    expect(errors).toContain('迁移校验和格式错误：other-module-migration');
    expect(errors).toContain('迁移制品路径不安全：../unsafe.sql');
  });

  it('拒绝重复或越界的 SQL 迁移制品路径', () => {
    const input = manifest();
    input.migrations[1].artifact.path = input.migrations[0].artifact.path;
    expect(validatePahPluginManifest(input).errors).toContain(
      `重复迁移制品路径：${FIRST_MIGRATION_PATH}`
    );

    input.migrations[1].artifact.path = '/tmp/migration.sql';
    expect(validatePahPluginManifest(input).errors).toContain(
      '迁移制品路径不安全：/tmp/migration.sql'
    );
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

  it('HTTP 安装不能绕过 dry-run 执行 DDL', async () => {
    const update = jest.fn();
    const service = new PahPluginService();
    Object.assign(service, {
      ctx: { admin: { username: 'admin' } },
      pluginInstallationEntity: {
        findOne: jest.fn().mockResolvedValue({
          id: 1,
          moduleId: MODULE_ID,
          state: 'verified',
          manifest: manifest(),
        }),
        update,
      },
    });

    await expect(service.install(MODULE_ID)).rejects.toThrow(
      '包含 DDL 的插件必须经受控发布流程 dry-run 并安装'
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('停用插件登记新版本时重新进入 verified 以执行升级门禁', async () => {
    const input = manifest();
    input.version = '0.2.0';
    const update = jest.fn().mockResolvedValue({ affected: 1 });
    const service = new PahPluginService();
    Object.assign(service, {
      ctx: { admin: { username: 'admin' } },
      pluginInstallationEntity: {
        findOne: jest
          .fn()
          .mockResolvedValueOnce({
            id: 1,
            moduleId: MODULE_ID,
            version: '0.1.0',
            state: 'disabled',
          })
          .mockResolvedValue({
            id: 1,
            moduleId: MODULE_ID,
            version: '0.2.0',
            state: 'verified',
            manifest: input,
          }),
        update,
      },
    });

    await service.register(input);

    expect(update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ version: '0.2.0', state: 'verified' })
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

  function navigationService(existingAssignment: any = null) {
    const assignmentSave = jest.fn();
    const groupFindOne = jest
      .fn()
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 2 })
      .mockResolvedValueOnce({ id: 3 })
      .mockResolvedValueOnce({ id: 3 });
    const service = new PahNavigationService();
    Object.assign(service, {
      navigationGroupEntity: {
        findOne: groupFindOne,
        save: jest.fn(),
      },
      navigationAssignmentEntity: {
        findOne: jest.fn().mockResolvedValue(existingAssignment),
        save: assignmentSave,
      },
      baseSysMenuEntity: { find: jest.fn().mockResolvedValue([]) },
      pluginInstallationEntity: { find: jest.fn().mockResolvedValue([]) },
    });
    return { service, assignmentSave, groupFindOne };
  }

  it('插件首次目标始终进入业务分组且不消费 manifest 建议组', async () => {
    const { service, assignmentSave, groupFindOne } = navigationService();

    await service.ensurePluginDefaultGroup(
      MODULE_ID,
      'example-plugin-workbench'
    );

    expect(assignmentSave).toHaveBeenCalledWith({
      targetKey: 'plugin:example-plugin:example-plugin-workbench',
      groupId: 3,
    });
    expect(groupFindOne).toHaveBeenCalledTimes(4);
  });

  it('插件升级或重新启用不覆盖管理员已有分配', async () => {
    const { service, assignmentSave, groupFindOne } = navigationService({
      id: 8,
      groupId: 99,
    });

    await service.ensurePluginDefaultGroup(
      MODULE_ID,
      'example-plugin-workbench'
    );

    expect(assignmentSave).not.toHaveBeenCalled();
    expect(groupFindOne).toHaveBeenCalledTimes(3);
  });
});

describe('Pah 菜单与角色贡献', () => {
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
      pahPublicLoginBrandingService: {
        deactivateForLifecycle: jest
          .fn()
          .mockResolvedValue(async () => undefined),
      },
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
    const ensurePluginDefaultGroup = jest.fn();
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
      pahNavigationService: { ensurePluginDefaultGroup },
    });

    await service.enable(MODULE_ID);

    expect(baseMenuSave).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ icon: 'pnw:folder' })
    );
    expect(baseMenuSave).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        router: '/example-plugin/items',
        perms: 'example-plugin:item:read',
        icon: 'pnw:list',
      })
    );
    expect(roleMenuSave).toHaveBeenCalledWith({ roleId: 4, menuId: 202 });
    expect(ensurePluginDefaultGroup).toHaveBeenCalledWith(
      MODULE_ID,
      'example-plugin-workbench'
    );
  });
});

describe('Pah 通用 SQL 迁移执行器', () => {
  function migrationService(
    records: any[] = [],
    rootDir = MIGRATION_FIXTURE_ROOT
  ) {
    const registry = new PahCompiledPluginRegistry();
    registry.register({
      moduleId: MODULE_ID,
      version: '0.1.0',
      rootDir,
    });
    const service = new PahPluginMigrationService();
    Object.assign(service, {
      compiledPluginRegistry: registry,
      pluginMigrationRecordEntity: {
        find: jest.fn().mockResolvedValue(records),
      },
    });
    return { service, registry };
  }

  function backupProof() {
    return {
      backupId: 'backup-example-1',
      moduleId: MODULE_ID,
      pluginVersion: '0.1.0',
      dataSourceName: 'default' as const,
      createdAt: '2026-08-02T00:00:00.000Z',
      restoreProcedure: 'restore-example-plugin-backup',
    };
  }

  it('构建装配器复制通用制品，并拒绝缺少 descriptor 的迁移目录', () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'pah-build-assembly-'));
    const sourceRoot = path.join(tempRoot, 'src/modules', MODULE_ID);
    const assembler = path.resolve(
      __dirname,
      '../../../scripts/copy-pah-plugin-artifacts.mjs'
    );
    mkdirSync(path.dirname(sourceRoot), { recursive: true });
    cpSync(MIGRATION_FIXTURE_ROOT, sourceRoot, { recursive: true });
    cpSync(
      path.resolve(__dirname, '../../../src/modules/pah'),
      path.join(tempRoot, 'src/modules/pah'),
      { recursive: true }
    );
    try {
      const assembled = spawnSync(process.execPath, [assembler], {
        cwd: tempRoot,
        encoding: 'utf8',
      });
      expect(assembled.status).toBe(0);
      expect(
        readFileSync(
          path.join(
            tempRoot,
            'dist/modules',
            MODULE_ID,
            'pah-plugin.artifacts.json'
          ),
          'utf8'
        )
      ).toBe(
        readFileSync(
          path.join(MIGRATION_FIXTURE_ROOT, 'pah-plugin.artifacts.json'),
          'utf8'
        )
      );
      expect(
        readFileSync(
          path.join(tempRoot, 'dist/modules', MODULE_ID, FIRST_MIGRATION_PATH)
        )
      ).toEqual(FIRST_MIGRATION_SQL);
      expect(
        readFileSync(
          path.join(tempRoot, 'dist/modules', MODULE_ID, RUNTIME_ARTIFACT_PATH)
        )
      ).toEqual(
        readFileSync(path.join(MIGRATION_FIXTURE_ROOT, RUNTIME_ARTIFACT_PATH))
      );

      rmSync(path.join(sourceRoot, 'pah-plugin.artifacts.json'));
      const missingDescriptor = spawnSync(process.execPath, [assembler], {
        cwd: tempRoot,
        encoding: 'utf8',
      });
      expect(missingDescriptor.status).not.toBe(0);
      expect(missingDescriptor.stderr).toContain(
        `Pah 插件 ${MODULE_ID} 缺少或无法解析 pah-plugin.artifacts.json`
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('构建装配器拒绝不可信 runtimeArtifacts，且不解析 Host ambient 依赖', () => {
    const assembler = path.resolve(
      __dirname,
      '../../../scripts/copy-pah-plugin-artifacts.mjs'
    );
    const runInvalidCase = (
      mutate: (context: {
        tempRoot: string;
        sourceRoot: string;
        descriptor: Record<string, any>;
        artifact: Record<string, any>;
        artifactPath: string;
      }) => void,
      expectedError: string
    ) => {
      const tempRoot = mkdtempSync(path.join(tmpdir(), 'pah-runtime-invalid-'));
      const sourceRoot = path.join(tempRoot, 'src/modules', MODULE_ID);
      mkdirSync(path.dirname(sourceRoot), { recursive: true });
      cpSync(MIGRATION_FIXTURE_ROOT, sourceRoot, { recursive: true });
      const descriptorPath = path.join(sourceRoot, 'pah-plugin.artifacts.json');
      const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'));
      const artifact = descriptor.runtimeArtifacts[0];
      const artifactPath = path.join(sourceRoot, RUNTIME_ARTIFACT_PATH);
      try {
        mutate({
          tempRoot,
          sourceRoot,
          descriptor,
          artifact,
          artifactPath,
        });
        writeFileSync(
          descriptorPath,
          `${JSON.stringify(descriptor, null, 2)}\n`
        );
        const result = spawnSync(process.execPath, [assembler], {
          cwd: tempRoot,
          encoding: 'utf8',
        });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(expectedError);
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    };
    const replaceArtifact = (
      context: {
        artifact: Record<string, any>;
        artifactPath: string;
      },
      content: string
    ) => {
      writeFileSync(context.artifactPath, content);
      const bytes = Buffer.from(content);
      context.artifact.size = bytes.byteLength;
      context.artifact.sha256 = createHash('sha256')
        .update(bytes)
        .digest('hex');
    };

    runInvalidCase(({ artifactPath }) => rmSync(artifactPath), '文件不存在');
    runInvalidCase(({ artifact }) => {
      artifact.size += 1;
    }, 'size 不匹配');
    runInvalidCase(({ artifact }) => {
      artifact.sha256 = '0'.repeat(64);
    }, 'sha256 不匹配');
    runInvalidCase(({ artifact }) => {
      artifact.path = '/tmp/runtime.cjs';
    }, 'path 必须是安全的 POSIX 相对路径');
    runInvalidCase(({ artifact }) => {
      artifact.path = '../runtime.cjs';
    }, 'path 不合法或会覆盖受保护制品');
    runInvalidCase(({ artifact }) => {
      artifact.runtime = 'browser';
    }, '只允许 node/commonjs');
    runInvalidCase(({ artifact }) => {
      artifact.format = 'module';
    }, '只允许 node/commonjs');
    runInvalidCase(({ artifact }) => {
      artifact.postinstall = 'node install.js';
    }, '只能声明固定字段');
    runInvalidCase(context => {
      const outside = path.join(context.tempRoot, 'outside-runtime.cjs');
      writeFileSync(outside, readFileSync(context.artifactPath));
      rmSync(context.artifactPath);
      symlinkSync(outside, context.artifactPath);
    }, 'path 不得包含 symlink');
    runInvalidCase(({ sourceRoot }) => {
      writeFileSync(
        path.join(sourceRoot, 'runtime/undeclared-runtime.cjs'),
        'module.exports = {};\n'
      );
    }, '包含未声明的 runtime 文件 runtime/undeclared-runtime.cjs');
    runInvalidCase(context => {
      replaceArtifact(context, "module.exports = require('left-pad');\n");
    }, '引用了未声明的运行时依赖 left-pad');
    runInvalidCase(context => {
      replaceArtifact(context, "module.exports = require('./other.cjs');\n");
    }, '引用了未声明的运行时依赖 ./other.cjs');
    runInvalidCase(context => {
      replaceArtifact(
        context,
        'module.exports = require(process.env.RUNTIME);\n'
      );
    }, '不得使用动态 require');
  });

  it('按通用 descriptor 自动装配，不要求插件导入 Host 源码', async () => {
    const tempParent = mkdtempSync(path.join(tmpdir(), 'pah-assembly-'));
    const compiledRoot = path.join(tempParent, 'dist/modules', MODULE_ID);
    cpSync(MIGRATION_FIXTURE_ROOT, compiledRoot, { recursive: true });
    try {
      const registry = new PahCompiledPluginRegistry();
      Object.assign(registry, {
        app: { getBaseDir: () => path.join(tempParent, 'dist') },
      });

      await expect(registry.require(MODULE_ID, '0.1.0')).resolves.toEqual({
        moduleId: MODULE_ID,
        version: '0.1.0',
        rootDir: compiledRoot,
      });

      writeFileSync(
        path.join(compiledRoot, 'pah-plugin.artifacts.json'),
        JSON.stringify({
          formatVersion: 1,
          moduleId: 'different-plugin',
          version: '0.1.0',
        })
      );
      const mismatched = new PahCompiledPluginRegistry();
      Object.assign(mismatched, {
        app: { getBaseDir: () => path.join(tempParent, 'dist') },
      });
      await expect(mismatched.require(MODULE_ID, '0.1.0')).rejects.toThrow(
        '编译制品描述符不匹配'
      );
    } finally {
      rmSync(tempParent, { recursive: true, force: true });
    }
  });

  it('dry-run 校验 SQL 制品并按版本排序且不执行 DDL', async () => {
    const input = manifest();
    input.migrations.reverse();
    const { service } = migrationService();

    const plan = await service.dryRun({
      moduleId: MODULE_ID,
      version: '0.1.0',
      manifest: input,
    } as PahPluginInstallationEntity);

    expect(plan).toEqual(
      expect.objectContaining({
        dryRun: true,
        planId: expect.any(String),
        expiresAt: expect.any(String),
        artifactsVerified: true,
        transaction: 'required',
        backupRequired: true,
      })
    );
    expect(plan.items.map(item => item.id)).toEqual([
      'example-plugin-bootstrap',
      'example-plugin-index-items',
    ]);
    expect(plan.items.every(item => item.state === 'pending')).toBe(true);
  });

  it('拒绝缺失声明、额外 SQL 和 checksum 不匹配', async () => {
    const missingDeclaration = manifest();
    missingDeclaration.migrations.pop();
    const { service } = migrationService();
    await expect(service.prepare(missingDeclaration)).rejects.toThrow(
      '迁移声明与 SQL 制品不是一一对应'
    );

    const changedChecksum = manifest();
    changedChecksum.migrations[0].checksum = `sha256:${'0'.repeat(64)}`;
    await expect(service.prepare(changedChecksum)).rejects.toThrow(
      '迁移制品校验和不匹配：example-plugin-bootstrap'
    );
  });

  it('拒绝空白或非 UTF-8 的 SQL 制品', async () => {
    const tempParent = mkdtempSync(path.join(tmpdir(), 'pah-migration-'));
    const tempRoot = path.join(tempParent, MODULE_ID);
    cpSync(MIGRATION_FIXTURE_ROOT, tempRoot, { recursive: true });
    try {
      const input = manifest();
      const firstPath = path.join(tempRoot, FIRST_MIGRATION_PATH);
      const invalidUtf8 = Buffer.from([0xff, 0xfe]);
      writeFileSync(firstPath, invalidUtf8);
      input.migrations[0].checksum = checksumPahSqlArtifact(invalidUtf8);
      await expect(
        migrationService([], tempRoot).service.prepare(input)
      ).rejects.toThrow('迁移制品不是有效 UTF-8：example-plugin-bootstrap');

      writeFileSync(firstPath, '  \n');
      input.migrations[0].checksum = checksumPahSqlArtifact('  \n');
      await expect(
        migrationService([], tempRoot).service.prepare(input)
      ).rejects.toThrow('迁移制品不能为空：example-plugin-bootstrap');
    } finally {
      rmSync(tempParent, { recursive: true, force: true });
    }
  });

  it('拒绝删除或篡改已经 applied 的历史声明', async () => {
    const { service } = migrationService([
      {
        moduleId: MODULE_ID,
        migrationId: 'example-plugin-bootstrap',
        version: 1,
        checksum: `sha256:${'f'.repeat(64)}`,
        state: 'applied',
      },
    ]);

    await expect(
      service.dryRun({
        moduleId: MODULE_ID,
        version: '0.1.0',
        manifest: manifest(),
      } as PahPluginInstallationEntity)
    ).rejects.toThrow('已应用迁移声明被篡改：example-plugin-bootstrap');

    const deletedHistory = migrationService([
      {
        moduleId: MODULE_ID,
        migrationId: 'example-plugin-removed',
        version: 3,
        checksum: `sha256:${'a'.repeat(64)}`,
        state: 'applied',
      },
    ]).service;
    await expect(
      deletedHistory.dryRun({
        moduleId: MODULE_ID,
        version: '0.1.0',
        manifest: manifest(),
      } as PahPluginInstallationEntity)
    ).rejects.toThrow('当前 manifest 删除了已应用迁移：example-plugin-removed');
  });

  it('备份证明必须绑定同一插件版本与数据源', async () => {
    const gate = new PahMigrationBackupGate();
    const verifier = jest.fn().mockResolvedValue(undefined);
    gate.registerVerifier(verifier);

    await expect(
      gate.verify(
        { ...backupProof(), dataSourceName: 'other' as any },
        {
          moduleId: MODULE_ID,
          pluginVersion: '0.1.0',
          dataSourceName: 'default',
          migrations: [],
        }
      )
    ).rejects.toThrow('迁移备份证明与执行计划不匹配');
    expect(verifier).not.toHaveBeenCalled();
  });

  it('事务内跳过已应用迁移、执行待办并由 Host 写台账', async () => {
    const appliedRecord = {
      moduleId: MODULE_ID,
      migrationId: 'example-plugin-bootstrap',
      version: 1,
      checksum: MIGRATION_CHECKSUM,
      state: 'applied',
    };
    const { service } = migrationService([appliedRecord]);
    const plan = await service.dryRun({
      moduleId: MODULE_ID,
      version: '0.1.0',
      manifest: manifest(),
    } as PahPluginInstallationEntity);
    const prepared = service.claimPlan(MODULE_ID, '0.1.0', plan.planId);
    const installation = {
      id: 1,
      moduleId: MODULE_ID,
      version: '0.1.0',
      state: 'staged',
      manifest: manifest(),
    };
    const installationUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    const migrationSave = jest.fn().mockResolvedValue(undefined);
    const query = jest.fn().mockResolvedValue(undefined);
    const manager = {
      getRepository: jest.fn(entity =>
        entity === PahPluginInstallationEntity
          ? {
              findOne: jest.fn().mockResolvedValue(installation),
              update: installationUpdate,
            }
          : {
              find: jest.fn().mockResolvedValue([appliedRecord]),
              save: migrationSave,
            }
      ),
      query,
    };
    const transaction = jest.fn(callback => callback(manager));
    jest
      .spyOn(service, 'getOrmManager')
      .mockReturnValue({ transaction } as any);

    const result = await service.executeClaimed(MODULE_ID, prepared);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(SECOND_MIGRATION_SQL.toString('utf8'));
    expect(migrationSave).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleId: MODULE_ID,
        migrationId: 'example-plugin-index-items',
        version: 2,
        checksum: SECOND_MIGRATION_CHECKSUM,
        importBatchId: expect.any(String),
        state: 'applied',
      })
    );
    expect(installationUpdate).toHaveBeenNthCalledWith(
      1,
      { id: 1, state: 'staged' },
      expect.objectContaining({ state: 'migrated' })
    );
    expect(installationUpdate).toHaveBeenNthCalledWith(
      2,
      { id: 1, state: 'migrated' },
      expect.objectContaining({ state: 'installed' })
    );
    expect(result.state).toBe('installed');
  });

  it('dry-run 后台账变化会在事务锁内阻断执行', async () => {
    const { service } = migrationService();
    const plan = await service.dryRun({
      moduleId: MODULE_ID,
      version: '0.1.0',
      manifest: manifest(),
    } as PahPluginInstallationEntity);
    const prepared = service.claimPlan(MODULE_ID, '0.1.0', plan.planId);
    const query = jest.fn();
    const manager = {
      getRepository: jest.fn(entity =>
        entity === PahPluginInstallationEntity
          ? {
              findOne: jest.fn().mockResolvedValue({
                id: 1,
                moduleId: MODULE_ID,
                version: '0.1.0',
                state: 'staged',
                manifest: manifest(),
              }),
            }
          : {
              find: jest.fn().mockResolvedValue([
                {
                  moduleId: MODULE_ID,
                  migrationId: 'example-plugin-bootstrap',
                  version: 1,
                  checksum: MIGRATION_CHECKSUM,
                  state: 'applied',
                },
              ]),
            }
      ),
      query,
    };
    jest.spyOn(service, 'getOrmManager').mockReturnValue({
      transaction: jest.fn(callback => callback(manager)),
    } as any);

    await expect(service.executeClaimed(MODULE_ID, prepared)).rejects.toThrow(
      '迁移台账已变化，请重新执行 dry-run'
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('DDL 失败时不写 applied 台账也不提交安装状态', async () => {
    const { service } = migrationService();
    const plan = await service.dryRun({
      moduleId: MODULE_ID,
      version: '0.1.0',
      manifest: manifest(),
    } as PahPluginInstallationEntity);
    const prepared = service.claimPlan(MODULE_ID, '0.1.0', plan.planId);
    const installationUpdate = jest.fn();
    const migrationSave = jest.fn();
    const manager = {
      getRepository: jest.fn(entity =>
        entity === PahPluginInstallationEntity
          ? {
              findOne: jest.fn().mockResolvedValue({
                id: 1,
                moduleId: MODULE_ID,
                version: '0.1.0',
                state: 'staged',
                manifest: manifest(),
              }),
              update: installationUpdate,
            }
          : {
              find: jest.fn().mockResolvedValue([]),
              save: migrationSave,
            }
      ),
      query: jest.fn().mockRejectedValue(new Error('ddl failed')),
    };
    jest.spyOn(service, 'getOrmManager').mockReturnValue({
      transaction: jest.fn(callback => callback(manager)),
    } as any);

    await expect(service.executeClaimed(MODULE_ID, prepared)).rejects.toThrow(
      'ddl failed'
    );
    expect(migrationSave).not.toHaveBeenCalled();
    expect(installationUpdate).not.toHaveBeenCalled();
  });
});
