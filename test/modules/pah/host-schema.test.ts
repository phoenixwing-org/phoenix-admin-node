import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';

const pahRoot = path.resolve(__dirname, '../../../src/modules/pah');

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
        version: 3,
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
    expect(sql).toContain('incompatible definitions');
    expect(sql).not.toMatch(/access[_ ]?token|refresh[_ ]?token/i);
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
