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
});
