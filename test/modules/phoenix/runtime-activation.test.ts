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
import { PahPluginManifest } from '../../../src/modules/phoenix/interface/plugin';
import {
  inspectPahPluginActivation,
  pahPluginActivationReceiptFile,
  PahPluginRuntimeActivationService,
} from '../../../src/modules/phoenix/service/runtime-activation';

const roots: string[] = [];
const originalNodeRoot = process.env.PHOENIX_ADMIN_NODE_ROOT;
const originalVueRoot = process.env.PHOENIX_ADMIN_VUE_ROOT;

function manifest(moduleId: string): PahPluginManifest {
  return {
    formatVersion: 2,
    moduleId,
    name: 'Fixture Plugin',
    version: '1.0.0',
    publisher: 'Fixture',
    license: 'MIT',
    hostCompatibility: '>=0.2.2 <0.3.0',
    activationMode: 'restart',
    routePrefix: `/${moduleId}`,
    entrypoints: {
      node: `midway/${moduleId}/config.ts`,
      web: `vue/${moduleId}/config.ts`,
    },
    routes: [],
    navigation: {
      preferredGroupId: 'pah-group-business',
      preferredGroupLabel: '业务',
      modules: [],
    },
    apiPrefix: `/admin/${moduleId}/`,
    capabilities: [],
    resourcePolicies: [],
    auditCategories: [],
    migrations: [],
    healthChecks: [],
    hostReuse: [],
    dataOwnership: { tables: [], retainedOnUninstall: true },
    uninstall: {
      retainDataByDefault: true,
      requiresBackup: false,
      purgeCapability: `${moduleId}:data:purge`,
    },
  };
}

function fixture(moduleId = 'fixture-plugin') {
  const root = mkdtempSync(path.join(tmpdir(), 'pah-activation-'));
  roots.push(root);
  const nodeRoot = path.join(root, 'node');
  const vueRoot = path.join(root, 'vue');
  for (const [hostRoot, name] of [
    [nodeRoot, 'phoenix-admin-node'],
    [vueRoot, 'phoenix-admin-vue'],
  ]) {
    mkdirSync(path.join(hostRoot, 'src', 'modules', moduleId), {
      recursive: true,
    });
    writeFileSync(
      path.join(hostRoot, 'package.json'),
      JSON.stringify({ name })
    );
    writeFileSync(
      path.join(hostRoot, 'src', 'modules', moduleId, 'config.ts'),
      'export default () => ({});\n'
    );
  }
  process.env.PHOENIX_ADMIN_NODE_ROOT = nodeRoot;
  process.env.PHOENIX_ADMIN_VUE_ROOT = vueRoot;
  return { nodeRoot, vueRoot, moduleId };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  if (originalNodeRoot === undefined) delete process.env.PHOENIX_ADMIN_NODE_ROOT;
  else process.env.PHOENIX_ADMIN_NODE_ROOT = originalNodeRoot;
  if (originalVueRoot === undefined) delete process.env.PHOENIX_ADMIN_VUE_ROOT;
  else process.env.PHOENIX_ADMIN_VUE_ROOT = originalVueRoot;
});

describe('Phoenix 插件可信激活收据', () => {
  it('启用时绑定双端 payload；字节变化后 fail-closed', () => {
    const value = fixture();
    const service = new PahPluginRuntimeActivationService();
    service.recordVerifiedPackage(
      manifest(value.moduleId),
      'a'.repeat(64)
    );
    const rollback = service.activate({
      moduleId: value.moduleId,
      version: '1.0.0',
      manifest: manifest(value.moduleId),
    } as any);

    for (const hostRoot of [value.nodeRoot, value.vueRoot]) {
      expect(
        existsSync(
          pahPluginActivationReceiptFile(hostRoot, value.moduleId)
        )
      ).toBe(true);
    }
    expect(
      inspectPahPluginActivation(
        value.nodeRoot,
        value.moduleId,
        'node',
        path.join(value.nodeRoot, 'src', 'modules', value.moduleId)
      )
    ).toMatchObject({ valid: true });

    writeFileSync(
      path.join(
        value.nodeRoot,
        'src',
        'modules',
        value.moduleId,
        'config.ts'
      ),
      'export default () => ({ tampered: true });\n'
    );
    expect(
      inspectPahPluginActivation(
        value.nodeRoot,
        value.moduleId,
        'node',
        path.join(value.nodeRoot, 'src', 'modules', value.moduleId)
      )
    ).toMatchObject({
      valid: false,
      detail: expect.stringContaining('不匹配'),
    });

    rollback();
    expect(
      existsSync(
        pahPluginActivationReceiptFile(value.nodeRoot, value.moduleId)
      )
    ).toBe(false);
  });

  it('停用撤销收据，生命周期失败时可恢复原始字节', () => {
    const value = fixture();
    const service = new PahPluginRuntimeActivationService();
    service.recordVerifiedPackage(
      manifest(value.moduleId),
      'a'.repeat(64)
    );
    service.activate({
      moduleId: value.moduleId,
      version: '1.0.0',
      manifest: manifest(value.moduleId),
    } as any);
    const receiptFile = pahPluginActivationReceiptFile(
      value.nodeRoot,
      value.moduleId
    );
    const before = readFileSync(receiptFile);

    const rollback = service.deactivate(value.moduleId);
    expect(existsSync(receiptFile)).toBe(false);
    rollback();
    expect(readFileSync(receiptFile)).toEqual(before);
  });

  it('验包后 payload 被修改时拒绝生成激活收据', () => {
    const value = fixture();
    const service = new PahPluginRuntimeActivationService();
    const pluginManifest = manifest(value.moduleId);
    service.recordVerifiedPackage(pluginManifest, 'a'.repeat(64));
    writeFileSync(
      path.join(
        value.vueRoot,
        'src',
        'modules',
        value.moduleId,
        'config.ts'
      ),
      'export default () => ({ changedAfterVerify: true });\n'
    );

    expect(() =>
      service.activate({
        moduleId: value.moduleId,
        version: '1.0.0',
        manifest: pluginManifest,
      } as any)
    ).toThrow('与已验证插件包不匹配');
    expect(
      existsSync(
        pahPluginActivationReceiptFile(value.nodeRoot, value.moduleId)
      )
    ).toBe(false);
  });
});
