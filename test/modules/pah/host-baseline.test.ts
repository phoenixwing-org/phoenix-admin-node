import { execFileSync } from 'child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

const baselineRoot = path.resolve(
  __dirname,
  '../../../src/modules/pah/host-baseline'
);
// eslint-disable-next-line node/no-unpublished-require
const baseline = require('../../../scripts/pah-host-baseline.cjs');

describe('Admin Host 空库基线', () => {
  const { manifest } = baseline.loadAndVerifyManifest(baselineRoot);

  it('绑定冻结 Host commit，并由其 tracked entity 真源导出 29 个 relation', () => {
    const entitiesSource = execFileSync(
      'git',
      ['show', `${manifest.sourceCommit}:src/entities.ts`],
      { encoding: 'utf8' }
    );
    const imports = [...entitiesSource.matchAll(/from '([^']+)'/g)].map(
      match => path.posix.normalize(path.posix.join('src', `${match[1]}.ts`))
    );
    const relations = imports.flatMap(file => {
      const source = execFileSync(
        'git',
        ['show', `${manifest.sourceCommit}:${file}`],
        { encoding: 'utf8' }
      );
      return [...source.matchAll(/@Entity\('([^']+)'\)/g)].map(
        match => match[1]
      );
    });

    expect(manifest.sourceCommit).toBe(
      '0d94cbfd3179ab327ffb35ec653cbf1869d13c1d'
    );
    expect([...new Set(relations)].sort()).toEqual(manifest.requiredRelations);
    expect(manifest.requiredRelations).toHaveLength(29);
    expect(manifest.pahHostSchemaVersion).toBe(2);
  });

  it('锁定三份 schema SQL、管理员 seed 与完整结构指纹', () => {
    expect(manifest.schemaArtifacts.map(item => item.sha256)).toEqual([
      'ef772216079ec96bdcfc66f5fe202877131b686814db25ed1eac251d699bf24e',
      'c9f33662bf2714da5ec84b2282795b9ca24fabd8bb65753b9d16a7188347fe7f',
      '2a6d89cde9e978f63aad61a1c4314dc9dd98e77a6301e43975b1c661368f5f1b',
    ]);
    expect(manifest.adminSeedArtifact.sha256).toBe(
      'd0da3407494d5b6da228d8768edd2786436433c3717cc8004828fd6b18c7b7e0'
    );
    expect(manifest.expectedSchema).toEqual({
      columns: 304,
      indexes: 166,
      constraints: 30,
      sequences: 29,
      sha256:
        '4318073267eed45be87df184407cc12c4fa8fef8f44b784a9687a49c081a98c0',
    });
  });

  it('组合基线包含规范字典索引，但不包含冻结 commit 之后的身份表', () => {
    const sql = manifest.schemaArtifacts
      .map(item => readFileSync(path.join(baselineRoot, item.path), 'utf8'))
      .join('\n');

    expect(sql).toContain('CREATE UNIQUE INDEX "UQ_dict_type_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "UQ_dict_info_type_value"');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_dict_info_enabled"');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_dict_info_tags"');
    expect(sql).not.toContain('pah_external_identity');
    expect(sql).not.toContain('pah_external_bind_request');
    expect(sql).not.toContain('pah_oauth_login_attempt');
    expect(sql).not.toContain('pah_oauth_login_ticket');
  });

  it('制品字节被修改后 fail-closed', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-host-baseline-test-'));
    try {
      cpSync(baselineRoot, root, { recursive: true });
      const artifact = path.join(root, manifest.schemaArtifacts[0].path);
      writeFileSync(artifact, `${readFileSync(artifact, 'utf8')}\n`);
      expect(() => baseline.loadAndVerifyManifest(root)).toThrow(
        '基线制品完整性校验失败'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('sourceFiles 缺失时以 manifest 错误 fail-closed', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-host-baseline-test-'));
    try {
      cpSync(baselineRoot, root, { recursive: true });
      const target = path.join(root, 'host-baseline.json');
      const invalid = JSON.parse(readFileSync(target, 'utf8'));
      delete invalid.sourceFiles;
      writeFileSync(target, `${JSON.stringify(invalid, null, 2)}\n`);
      expect(() => baseline.loadAndVerifyManifest(root)).toThrow(
        'Host baseline manifest 不合法'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('只接受 release-validation、loopback、精确 allowlist 与显式数据库用户', () => {
    const valid = {
      PAH_HOST_BASELINE_ENVIRONMENT: 'release-validation',
      PAH_HOST_BASELINE_DB_HOST: '127.0.0.1',
      PAH_HOST_BASELINE_DB_PORT: '5432',
      PAH_HOST_BASELINE_DB_USERNAME: 'fixture-user',
      PAH_HOST_BASELINE_DB_DATABASE: 'fixture_release_validation',
      PAH_HOST_BASELINE_ALLOWED_DATABASE: 'fixture_release_validation',
      PAH_HOST_BASELINE_SOURCE_REPOSITORY: '/fixture/source',
    };
    expect(baseline.readConfig(manifest, valid)).toEqual(
      expect.objectContaining({
        environmentKind: 'release-validation',
        host: '127.0.0.1',
        database: 'fixture_release_validation',
        user: 'fixture-user',
      })
    );
    expect(() =>
      baseline.readConfig(manifest, {
        ...valid,
        PAH_HOST_BASELINE_DB_HOST: '10.0.0.1',
      })
    ).toThrow('只允许本机 PostgreSQL');
    expect(() =>
      baseline.readConfig(manifest, {
        ...valid,
        PAH_HOST_BASELINE_DB_DATABASE: 'postgres',
        PAH_HOST_BASELINE_ALLOWED_DATABASE: 'postgres',
      })
    ).toThrow('maintenance');
    expect(() =>
      baseline.readConfig(manifest, {
        ...valid,
        PAH_HOST_BASELINE_ALLOWED_DATABASE: 'other',
      })
    ).toThrow('精确 allowlist');
    expect(() =>
      baseline.readConfig(manifest, {
        ...valid,
        PAH_HOST_BASELINE_DB_USERNAME: '',
      })
    ).toThrow('显式 PAH_HOST_BASELINE_DB_USERNAME');
  });

  it('从现有 Git 仓的冻结对象逐文件验证来源，不依赖 checkout HEAD', () => {
    expect(
      baseline.verifySourceRepository(manifest, path.resolve(__dirname, '../../..'))
    ).toBe(path.resolve(__dirname, '../../..'));
  });

  it('管理员 seed 无默认口令，确认文本和输出只使用用户名摘要', () => {
    expect(() => baseline.adminInput({})).toThrow('用户名缺失');
    expect(() =>
      baseline.adminInput({
        PAH_HOST_BASELINE_ADMIN_USERNAME: 'release-admin',
        PAH_HOST_BASELINE_ADMIN_PASSWORD: 'short',
      })
    ).toThrow('12 至 128');
    const admin = baseline.adminInput({
      PAH_HOST_BASELINE_ADMIN_USERNAME: 'release-admin',
      PAH_HOST_BASELINE_ADMIN_PASSWORD: 'one-time-password',
    });
    const confirmation = baseline.adminConfirmation(
      manifest,
      'fixture_release_validation',
      admin.username
    );
    expect(confirmation).toMatch(
      /^seed-release-validation-admin:fixture_release_validation:v1:[a-f0-9]{12}$/
    );
    expect(confirmation).not.toContain(admin.username);
    expect(confirmation).not.toContain(admin.password);
  });

  it('管理员 seed 是单个参数化 CTE，并显式串联四项写入与序列', () => {
    const sql = readFileSync(
      path.join(baselineRoot, manifest.adminSeedArtifact.path),
      'utf8'
    );

    expect((sql.match(/;/g) || [])).toHaveLength(1);
    expect(sql.trimEnd().endsWith(';')).toBe(true);
    expect(sql).toContain('WITH inserted_department AS');
    expect(sql).toContain('FROM inserted_department department');
    expect(sql).toContain('CROSS JOIN inserted_role role');
    expect(sql).toContain('FROM inserted_user admin_user');
    expect(sql.match(/setval\(/g)).toHaveLength(4);
    expect(sql).toContain('$1');
    expect(sql).toContain('$2');
    expect(sql).toContain('$3');
    expect(sql).not.toContain('one-time-password');
  });
});
