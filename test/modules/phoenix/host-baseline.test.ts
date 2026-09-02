import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

const baselineRoot = path.resolve(
  __dirname,
  '../../../src/modules/phoenix/host-baseline'
);
const repositoryRoot = path.resolve(__dirname, '../../..');
// eslint-disable-next-line node/no-unpublished-require
const baseline = require('../../../scripts/pah-host-baseline.cjs');

describe('Admin Host 空库基线', () => {
  const { manifest } = baseline.loadAndVerifyManifest(baselineRoot);

  it('绑定冻结 Host commit，并由其 tracked entity 真源导出 36 个 relation', () => {
    const entitiesSource = execFileSync(
      'git',
      ['show', `${manifest.sourceCommit}:src/entities.ts`],
      { encoding: 'utf8' }
    );
    const imports = [
      ...entitiesSource.matchAll(/import \* as entity\d+ from '([^']+)'/g),
    ].map(
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
      '2bdd0defff41e58c416d6a7431c2b17f4537ab93'
    );
    expect([...new Set(relations)].sort()).toEqual(manifest.requiredRelations);
    expect(manifest.requiredRelations).toHaveLength(36);
    expect(manifest.pahHostSchemaVersion).toBe(5);
  });

  it('锁定六份 schema SQL、管理员 seed 与完整结构指纹', () => {
    expect(manifest.schemaArtifacts.map(item => item.sha256)).toEqual([
      'ef772216079ec96bdcfc66f5fe202877131b686814db25ed1eac251d699bf24e',
      'c9f33662bf2714da5ec84b2282795b9ca24fabd8bb65753b9d16a7188347fe7f',
      '2a6d89cde9e978f63aad61a1c4314dc9dd98e77a6301e43975b1c661368f5f1b',
      '00f7d8367641e1d76ddeb3f064363aa5181a7ed8635b5a7e6a017421c523542d',
      '3e28db22028611223fdb5b7c226c9f5c83092cefc6a777e6948f11d3ae02233f',
      'a3e62c784f15a4864211128dc44f6f16d187690ef9e56b0f2f81fd194d6fb65d',
    ]);
    expect(manifest.adminSeedArtifact.sha256).toBe(
      'd0da3407494d5b6da228d8768edd2786436433c3717cc8004828fd6b18c7b7e0'
    );
    expect(manifest.expectedSchema).toEqual({
      columns: 421,
      indexes: 196,
      constraints: 61,
      sequences: 36,
      sha256:
        '98959a1522da63c3ebdcd1f8a91fc9467d5ad81cf6835e81dfd1dc6a78fbed2b',
    });
  });

  it('组合基线包含规范字典、外部身份与 Host Files v1', () => {
    const sql = manifest.schemaArtifacts
      .map(item => readFileSync(path.join(baselineRoot, item.path), 'utf8'))
      .join('\n');

    expect(sql).toContain('CREATE UNIQUE INDEX "UQ_dict_type_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "UQ_dict_info_type_value"');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_dict_info_enabled"');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "IDX_dict_info_tags"');
    expect(sql).toContain('pah_external_identity');
    expect(sql).toContain('pah_external_bind_request');
    expect(sql).toContain('pah_oauth_login_attempt');
    expect(sql).toContain('pah_oauth_login_ticket');
    expect(sql).toContain('pah_file_descriptor');
    expect(sql).toContain('pah_file_binding');
    expect(sql).toContain('pah_file_audit_record');
  });

  it('v2 活动基线逐项收口当前 36 个 Host 实体与自包含 schema 制品', () => {
    const entitiesSource = readFileSync(
      path.join(repositoryRoot, 'src/entities.ts'),
      'utf8'
    );
    const entitySources = [
      ...entitiesSource.matchAll(/from '(\.\/modules\/[^']+)'/gu),
    ].map(match =>
      path.join(repositoryRoot, 'src', `${match[1].slice(2)}.ts`)
    );
    const currentRelations = [
      ...new Set(
        entitySources.flatMap(file => [
          ...readFileSync(file, 'utf8').matchAll(/@Entity\('([^']+)'\)/gu),
        ]).map(match => match[1])
      ),
    ].sort();
    const artifactRelations = [
      ...new Set(
        manifest.schemaArtifacts.flatMap(artifact => {
          const file = path.join(baselineRoot, artifact.path);
          const content = readFileSync(file);
          expect(content.byteLength).toBe(artifact.size);
          expect(createHash('sha256').update(content).digest('hex')).toBe(
            artifact.sha256
          );
          return baseline.extractCreatedRelations(content.toString('utf8'));
        })
      ),
    ].sort();

    expect(manifest.version).toBe(2);
    expect(manifest.requiredRelations).toHaveLength(36);
    expect(manifest.requiredRelations).toEqual(currentRelations);
    expect(manifest.requiredRelations).toEqual(artifactRelations);
  });

  it('不会把 SQL 注释里的 IF 当作 relation', () => {
    expect(
      baseline.extractCreatedRelations(
        '-- CREATE TABLE IF NOT EXISTS 不会补齐约束。'
      )
    ).toEqual([]);
    expect(
      baseline.extractCreatedRelations(
        'CREATE TABLE IF NOT EXISTS actual_relation (id integer);'
      )
    ).toEqual(['actual_relation']);
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
    ).toThrow('12 至 20');
    expect(() =>
      baseline.adminInput({
        PAH_HOST_BASELINE_ADMIN_USERNAME: 'admin-name-over-limit',
        PAH_HOST_BASELINE_ADMIN_PASSWORD: 'one-time-password',
      })
    ).toThrow('用户名缺失');
    expect(() =>
      baseline.adminInput({
        PAH_HOST_BASELINE_ADMIN_USERNAME: 'release-admin',
        PAH_HOST_BASELINE_ADMIN_PASSWORD: 'password-over-twenty-characters',
      })
    ).toThrow('12 至 20');
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
      /^seed-release-validation-admin:fixture_release_validation:v2:[a-f0-9]{12}$/
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

  it('管理员重置输入服从登录页 20 字符边界，确认文本绑定三项摘要', () => {
    expect(() => baseline.resetAdminInput({})).toThrow('当前用户名');
    expect(() =>
      baseline.resetAdminInput({
        PAH_HOST_BASELINE_ADMIN_CURRENT_USERNAME: 'release-admin-old',
        PAH_HOST_BASELINE_ADMIN_NEW_USERNAME: 'admin',
        PAH_HOST_BASELINE_ADMIN_NEW_PASSWORD: 'short',
      })
    ).toThrow('12 至 20');
    expect(() =>
      baseline.resetAdminInput({
        PAH_HOST_BASELINE_ADMIN_CURRENT_USERNAME: 'same-admin',
        PAH_HOST_BASELINE_ADMIN_NEW_USERNAME: 'same-admin',
        PAH_HOST_BASELINE_ADMIN_NEW_PASSWORD: 'one-time-password',
      })
    ).toThrow('必须不同');
    expect(
      baseline.resetAdminInput({
        PAH_HOST_BASELINE_ADMIN_CURRENT_USERNAME:
          'legacy-admin-name-over-ui-limit',
        PAH_HOST_BASELINE_ADMIN_NEW_USERNAME: 'admin',
        PAH_HOST_BASELINE_ADMIN_NEW_PASSWORD: 'one-time-password',
      }).currentUsername
    ).toBe('legacy-admin-name-over-ui-limit');

    const reset = baseline.resetAdminInput({
      PAH_HOST_BASELINE_ADMIN_CURRENT_USERNAME: 'release-admin-old',
      PAH_HOST_BASELINE_ADMIN_NEW_USERNAME: 'admin',
      PAH_HOST_BASELINE_ADMIN_NEW_PASSWORD: 'one-time-password',
    });
    const confirmation = baseline.adminResetConfirmation(
      manifest,
      'fixture_release_validation',
      reset
    );
    expect(confirmation).toMatch(
      /^reset-release-validation-admin:fixture_release_validation:v2:(?:[a-f0-9]{12}:){2}[a-f0-9]{12}$/
    );
    const summarySegments = confirmation.split(':').slice(-3);
    expect(summarySegments).not.toContain(reset.currentUsername);
    expect(summarySegments).not.toContain(reset.newUsername);
    expect(confirmation).not.toContain(reset.newPassword);
    expect(confirmation).not.toContain(
      createHash('md5').update(reset.newPassword).digest('hex')
    );
  });
});
