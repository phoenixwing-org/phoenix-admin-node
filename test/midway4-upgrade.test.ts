import { readFileSync } from 'fs';
import { join } from 'path';

describe('Midway 4 compatibility baseline', () => {
  it('locks the runtime to one Midway 4 core line', () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8')
    );
    const lockfile = readFileSync(
      join(process.cwd(), 'pnpm-lock.yaml'),
      'utf8'
    );

    expect(packageJson.engines.node).toBe('>=20.0.0');
    expect(packageJson.name).toBe('phoenix-admin-node');
    expect(packageJson.version).toBe('0.2.2');
    const midwayDependencies = Object.entries(packageJson.dependencies).filter(
      ([name]) => name.startsWith('@midwayjs/')
    );
    midwayDependencies.push([
      '@midwayjs/mock',
      packageJson.devDependencies['@midwayjs/mock'],
    ]);

    expect(midwayDependencies.length).toBeGreaterThan(0);
    for (const [name, version] of midwayDependencies) {
      expect({ name, version }).toEqual({
        name,
        version: expect.stringMatching(/^\^4\./),
      });
    }
    expect(
      packageJson.pnpm.overrides['@cool-midway/core>@midwayjs/cache-manager']
    ).toBe('^4.2.1');
    expect(lockfile).not.toMatch(/@midwayjs\/[^:\n]+@3\./);
  });

  it('keeps the Cool compatibility changes reproducible', () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8')
    );
    const corePatch = readFileSync(
      join(process.cwd(), 'patches/@cool-midway__core@8.0.8.patch'),
      'utf8'
    );
    const rpcPatch = readFileSync(
      join(process.cwd(), 'patches/@cool-midway__rpc@8.0.2.patch'),
      'utf8'
    );

    expect(packageJson.pnpm.patchedDependencies).toEqual({
      '@cool-midway/rpc@8.0.2': 'patches/@cool-midway__rpc@8.0.2.patch',
      '@cool-midway/core@8.0.8': 'patches/@cool-midway__core@8.0.8.patch',
    });
    expect(corePatch).toContain('CommonJSFileDetector');
    expect(corePatch).toContain('getPropertyDataFromClass');
    expect(rpcPatch).not.toContain('+const camelCase_1');
    expect(rpcPatch).toContain('_.camelCase(service)');
  });

  it('locks the PostgreSQL-only integration profile to its isolated database', () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8')
    );
    const config = readFileSync(
      join(process.cwd(), 'src/config/config.midway4.ts'),
      'utf8'
    );

    expect(packageJson.dependencies.pg).toBe('^8.22.0');
    expect(packageJson.devDependencies.sqlite3).toBeUndefined();
    expect(packageJson.scripts['dev:midway4']).toContain(
      'NODE_ENV=midway4'
    );
    expect(packageJson.scripts['dev:midway4']).not.toContain('cool check');
    expect(packageJson.scripts.typecheck).toContain('entities:sync');
    expect(packageJson.scripts.typecheck).toContain(
      '.runtime/tsconfig.phoenix.json'
    );
    expect(packageJson.scripts.dev).toContain('pah-sync-runtime-entities.cjs');
    expect(packageJson.scripts['dev:midway4']).toContain(
      'pah-sync-runtime-entities.cjs'
    );
    expect(packageJson.scripts.dev).toContain(
      '.runtime/tsconfig.phoenix.json'
    );
    expect(packageJson.scripts.build).toContain('pah-bundle-runtime.cjs');
    expect(config).toContain("type: 'postgres'");
    expect(config).toContain("hostname: '127.0.0.1'");
    expect(config).toContain("randomBytes(32).toString('hex')");
    expect(config).toContain("database !== 'cool_admin_midway4_validation'");
    expect(config).toContain('只允许 loopback PostgreSQL');
    expect(config).toContain('synchronize: true');
    expect(config).toContain('initDB: true');
    expect(config).toContain('initMenu: true');
    const runtimeGate = readFileSync(
      join(process.cwd(), 'scripts/verify-midway4-runtime.js'),
      'utf8'
    );
    expect(runtimeGate).toContain("type: 'postgres'");
    expect(runtimeGate).toContain('synchronize: false');
    expect(runtimeGate).not.toContain("type: 'sqlite'");
  });

  it('resolves the remaining Cool service cycles only at call time', () => {
    const pluginTypes = readFileSync(
      join(process.cwd(), 'src/modules/plugin/service/types.ts'),
      'utf8'
    );
    const role = readFileSync(
      join(process.cwd(), 'src/modules/base/service/sys/role.ts'),
      'utf8'
    );
    const department = readFileSync(
      join(process.cwd(), 'src/modules/base/service/sys/department.ts'),
      'utf8'
    );

    expect(pluginTypes).not.toContain('pluginService: PluginService;');
    expect(pluginTypes).toContain('.getAsync(PluginService)');
    expect(role).not.toContain('baseSysPermsService: BaseSysPermsService;');
    expect(role).toContain('.getAsync(BaseSysPermsService)');
    expect(department).not.toContain(
      'baseSysPermsService: BaseSysPermsService;'
    );
    expect(department).toContain('.getAsync(BaseSysPermsService)');
  });

  it('does not inject request scoped branding into singleton configuration', () => {
    const configuration = readFileSync(
      join(process.cwd(), 'src/configuration.ts'),
      'utf8'
    );

    expect(configuration).not.toContain(
      'pahPublicLoginBrandingService: PahPublicLoginBrandingService;'
    );
    expect(configuration).toContain('.getAsync(PahPublicLoginBrandingService)');
  });

  it('keeps interface-only Koa metadata out of emitted runtime code', () => {
    const sseController = readFileSync(
      join(process.cwd(), 'src/modules/demo/controller/open/sse.ts'),
      'utf8'
    );

    expect(sseController).toContain(
      "import type { IMidwayKoaContext } from '@midwayjs/koa';"
    );
  });

  it('publishes the Host and Midway version with official framework links', () => {
    const welcome = readFileSync(
      join(process.cwd(), 'public/index.html'),
      'utf8'
    );

    expect(welcome).toContain('Midway 4.2.1');
    expect(welcome).toContain('Phoenix Admin Node');
    expect(welcome).toContain('<dt>VERSION</dt><dd>0.2.2</dd>');
    expect(welcome).toContain('https://midwayjs.org/');
    expect(welcome).toContain('https://github.com/midwayjs/midway');
  });
});
