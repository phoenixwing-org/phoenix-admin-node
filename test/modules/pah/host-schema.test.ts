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
        version: 1,
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
    expect(sql).toContain(
      "pg_get_indexdef(index_oid, 1, true) = '\"typeId\"'"
    );
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
