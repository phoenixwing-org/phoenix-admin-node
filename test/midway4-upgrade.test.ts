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
    expect(packageJson.version).toBe('8.0.0');
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
    expect(packageJson.scripts['dev:midway4']).toContain(
      'NODE_ENV=midway4'
    );
    expect(packageJson.scripts['dev:midway4']).not.toContain('cool check');
    expect(config).toContain("type: 'postgres'");
    expect(config).toContain("hostname: '127.0.0.1'");
    expect(config).toContain("randomBytes(32).toString('hex')");
    expect(config).toContain("database !== 'cool_admin_midway4_validation'");
    expect(config).toContain('只允许 loopback PostgreSQL');
    expect(config).toContain('synchronize: true');
    expect(config).toContain('initDB: true');
    expect(config).toContain('initMenu: true');
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

  it('publishes the Midway version and official source links on the status page', () => {
    const welcome = readFileSync(
      join(process.cwd(), 'public/index.html'),
      'utf8'
    );

    expect(welcome).toContain('Midway 4.2.1');
    expect(welcome).toContain('最新稳定版 · Active LTS');
    expect(welcome).toContain('Cool Admin 8.0.0');
    expect(welcome).toContain('上游应用版本保持不变');
    expect(welcome).toContain('https://midwayjs.org/');
    expect(welcome).toContain('https://github.com/midwayjs/midway');
    expect(welcome).toContain(
      'https://gitee.com/cool-team-official/cool-admin-midway'
    );
    expect(welcome).toContain('不代表上游合并或跨平台发布已经完成');
    expect(welcome).not.toMatch(/phoenix/i);
  });
});
