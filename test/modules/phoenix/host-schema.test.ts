import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

const pahRoot = path.resolve(__dirname, '../../../src/modules/phoenix');

describe('Pah Host schema 制品', () => {
  it('声明、SQL 文件和 SHA-256 一一对应', () => {
    const descriptor = JSON.parse(
      readFileSync(path.join(pahRoot, 'pah-host-schema.json'), 'utf8')
    );
    const packaged = readdirSync(path.join(pahRoot, 'schema'))
      .filter(name => name.endsWith('.sql'))
      .map(name => `schema/${name}`)
      .sort();

    expect(descriptor).toEqual(
      expect.objectContaining({
        formatVersion: 1,
        schemaId: 'pah-host',
        version: 5,
      })
    );
    expect(descriptor.migrations.map(item => item.path).sort()).toEqual(
      packaged
    );
    for (const migration of descriptor.migrations) {
      const content = readFileSync(path.join(pahRoot, migration.path));
      expect(migration.checksum).toBe(
        `sha256:${createHash('sha256').update(content).digest('hex')}`
      );
    }
  });

  it('字典菜单入口迁移只改写旧路径并可重复执行', () => {
    const sql = readFileSync(
      path.join(pahRoot, 'schema/0004-dictionary-menu-route.sql'),
      'utf8'
    );

    expect(sql).toContain("router = '/pah/dictionary-maintenance'");
    expect(sql).toContain("THEN '/phoenix/dictionary-maintenance'");
    expect(sql).toContain(
      "\"viewPath\" = 'modules/pah/views/dictionary-maintenance.vue'"
    );
    expect(sql).toContain(
      "THEN 'modules/phoenix/views/dictionary-maintenance.vue'"
    );
    expect(sql).toContain('legacy dictionary menu route remains after migration');
    expect(sql).not.toMatch(/DELETE\s+FROM\s+base_sys_menu/i);
  });

  it('外部身份迁移只保存身份映射和一次性凭证哈希', () => {
    const sql = readFileSync(
      path.join(pahRoot, 'schema/0003-external-identity.sql'),
      'utf8'
    );

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS pah_external_identity');
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS pah_external_bind_request'
    );
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS pah_oauth_login_attempt');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS pah_oauth_login_ticket');
    expect(sql).toContain('UQ_pah_external_identity_subject');
    expect(sql).toContain('UQ_pah_oauth_login_attempt_state');
    expect(sql).toContain('UQ_pah_oauth_login_ticket_hash');
    expect(sql).toContain('REFERENCES base_sys_user(id) ON DELETE RESTRICT');
    expect(sql).toContain("conrelid = 'pah_external_identity'::regclass");
    expect(sql).toContain('ALTER TABLE pah_external_identity');
    expect(sql).toContain('ADD CONSTRAINT "CHK_pah_external_identity_status"');
    expect(sql).toContain('ADD CONSTRAINT "FK_pah_oauth_login_ticket_identity"');
    expect(sql).toContain('incompatible definitions');
    expect(sql).not.toMatch(/access[_ ]?token|refresh[_ ]?token/i);
  });

  it('Host Files v1 迁移建立描述符、绑定与无内容审计边界', () => {
    const sql = readFileSync(
      path.join(pahRoot, 'schema/0005-host-files-v1.sql'),
      'utf8'
    );

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS pah_file_descriptor');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS pah_file_binding');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS pah_file_audit_record');
    expect(sql).toContain('"ownerModuleId" character varying(128) NOT NULL');
    expect(sql).toContain('"storageKey" text NOT NULL');
    expect(sql).toContain('ON DELETE RESTRICT');
    expect(sql).toContain('"UQ_pah_file_descriptor_file_owner"');
    expect(sql).toContain(
      'FOREIGN KEY ("fileId", "ownerModuleId")'
    );
    expect(sql).toContain('UQ_pah_file_binding_active_primary');
    expect(sql).toContain('RENAME CONSTRAINT %I TO %I');
    expect(sql).toContain("constraint_entry.table_name::regclass");
    expect(sql).toContain("regexp_replace(\n               pg_get_indexdef");
    expect(sql).toContain('incompatible definition');
    expect(sql).not.toMatch(/base64|bytea|access[_ ]?token|refresh[_ ]?token/i);
  });

  it('字典治理迁移声明 enabled/tags/core/owner 并校验索引定义', () => {
    const sql = readFileSync(
      path.join(pahRoot, 'schema/0002-dictionary-governance.sql'),
      'utf8'
    );

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS enabled boolean');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS tags text[]');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS core boolean');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "ownerModuleId"');
    expect(sql).toContain('information_schema.columns');
    expect(sql).toContain('IDX_dict_info_enabled');
    expect(sql).toContain('IDX_dict_info_tags');
    expect(sql).toContain('access_method.amname = expected.access_method');
    expect(sql).toContain('RAISE EXCEPTION');
  });

  it('干净安装在 Cool 初始化后等幂应用经过校验的 Host schema', () => {
    const installerPath = path.resolve(
      __dirname,
      '../../../scripts/phoenix-admin-clean-validation.mjs'
    );
    const installer = readFileSync(installerPath, 'utf8');

    expect(installer).toContain("schemaId !== 'pah-host'");
    expect(installer).toContain("'src', 'modules', 'phoenix'");
    expect(installer).not.toContain("'src', 'modules', 'pah'");
    expect(installer).toContain("/^schema\\/[0-9a-z-]+\\.sql$/u");
    expect(installer).toContain("createHash('sha256').update(sql)");
    expect(installer).toContain('BEGIN ISOLATION LEVEL SERIALIZABLE');
    expect(installer).toContain('pg_advisory_xact_lock');
    expect(installer).toContain("NODE_ENV: 'local'");
    expect(installer).toContain("['bootstrap.js']");
    expect(installer).not.toContain("start('pnpm', ['start']");
    expect(installer).toContain('await waitForAdminEps(');
    expect(installer).toContain('await waitForProcessGroupExit(child.pid');
    expect(installer.indexOf('state = await stopInitializedApi')).toBeLessThan(
      installer.indexOf('await applyPahHostSchema(options);')
    );
    expect(installer).toContain('await applyPahHostSchema(options);');
    expect(installer.indexOf('await applyPahHostSchema(options);')).toBeLessThan(
      installer.indexOf(
        'const api = startCleanValidationApi(commonApiEnv, false);'
      )
    );

    const probe = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `const module = await import(${JSON.stringify(pathToFileURL(installerPath).href)});
const runtime = module.cleanValidationApiEnvironment({ PAH_SERVER_PORT: '8201' }, false);
const initialize = module.cleanValidationApiEnvironment({ PAH_SERVER_PORT: '8201' }, true);
const valid = module.hasRequiredAdminEps({ code: 1000, data: [{ prefix: '/admin/base/open', api: [{ path: '/eps' }, { path: '/login' }] }] });
const empty = module.hasRequiredAdminEps({ code: 1000, data: {} });
process.stdout.write(JSON.stringify({ runtime, initialize, valid, empty }));`,
        ],
        { encoding: 'utf8' }
      )
    );
    expect(probe).toEqual(
      expect.objectContaining({
        runtime: expect.objectContaining({
          NODE_ENV: 'local',
          PAH_DEV_DISABLE_CAPTCHA: 'true',
          PAH_DB_SYNCHRONIZE: 'false',
          PAH_DB_INITIALIZE: 'false',
        }),
        initialize: expect.objectContaining({
          NODE_ENV: 'local',
          PAH_DB_SYNCHRONIZE: 'true',
          PAH_DB_INITIALIZE: 'true',
        }),
        valid: true,
        empty: false,
      })
    );
  });

  it('字典唯一索引拒绝重复与同名冒牌定义，且创建 reconcile ledger', () => {
    const sql = readFileSync(
      path.join(pahRoot, 'schema/0001-dictionary-reconcile.sql'),
      'utf8'
    );

    expect(sql).toContain('GROUP BY key');
    expect(sql).toContain('GROUP BY "typeId", value');
    expect(sql).toContain('RAISE EXCEPTION');
    expect(sql).toContain("to_regclass('dict_type')");
    expect(sql).toContain("to_regclass('dict_info')");
    expect(sql).toContain('index_info.indisunique');
    expect(sql).toContain('index_info.indisvalid');
    expect(sql).toContain('index_info.indisready');
    expect(sql).toContain("access_method.amname = 'btree'");
    expect(sql).toContain("pg_get_indexdef(index_oid, 1, true) = 'key'");
    expect(sql).toContain('pg_get_indexdef(index_oid, 1, true) = \'"typeId"\'');
    expect(sql).toContain("pg_get_indexdef(index_oid, 2, true) = 'value'");
    expect(sql).toContain('pg_get_expr(index_info.indpred');
    expect(sql).toContain("= 'valueisnotnull'");
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "UQ_dict_type_key" ON dict_type (key)'
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "UQ_dict_info_type_value" ON dict_info'
    );
    expect(sql).toContain(
      'UQ_dict_type_key exists but is not the required unique btree index'
    );
    expect(sql).toContain(
      'UQ_dict_info_type_value exists but is not the required unique partial btree index'
    );
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS pah_dictionary_reconcile_record'
    );
  });
});
