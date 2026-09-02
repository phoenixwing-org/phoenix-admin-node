DO $$
BEGIN
  IF to_regclass('public.pah_plugin_installation') IS NULL THEN
    RAISE EXCEPTION 'pah_plugin_installation is required before Host Files v1 migration';
  END IF;
  IF to_regclass('public.base_sys_user') IS NULL THEN
    RAISE EXCEPTION 'base_sys_user is required before Host Files v1 migration';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS pah_file_descriptor (
  id SERIAL NOT NULL,
  "createTime" character varying NOT NULL,
  "updateTime" character varying NOT NULL,
  "tenantId" integer,
  "fileId" uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  sha256 character(64) NOT NULL,
  mime character varying(128) NOT NULL,
  "originalName" character varying(255) NOT NULL,
  size bigint NOT NULL,
  "providerId" character varying(64) NOT NULL,
  "storageIdentity" character varying(255) NOT NULL,
  "storageKey" text NOT NULL,
  status character varying(32) NOT NULL DEFAULT 'active',
  "ownerModuleId" character varying(128) NOT NULL,
  "createdBy" integer NOT NULL,
  "updatedBy" integer,
  "deletedBy" integer,
  "deletedAt" character varying(64),
  CONSTRAINT "PK_pah_file_descriptor" PRIMARY KEY (id),
  CONSTRAINT "UQ_pah_file_descriptor_file_id" UNIQUE ("fileId"),
  CONSTRAINT "UQ_pah_file_descriptor_file_owner"
    UNIQUE ("fileId", "ownerModuleId"),
  CONSTRAINT "CK_pah_file_descriptor_status"
    CHECK (status IN ('active', 'deleted')),
  CONSTRAINT "CK_pah_file_descriptor_version"
    CHECK (version >= 1),
  CONSTRAINT "CK_pah_file_descriptor_size"
    CHECK (size > 0),
  CONSTRAINT "CK_pah_file_descriptor_sha256"
    CHECK (sha256 ~ '^[a-f0-9]{64}$')
);

CREATE TABLE IF NOT EXISTS pah_file_binding (
  id SERIAL NOT NULL,
  "createTime" character varying NOT NULL,
  "updateTime" character varying NOT NULL,
  "tenantId" integer,
  "bindingId" uuid NOT NULL,
  "ownerModuleId" character varying(128) NOT NULL,
  "resourceType" character varying(128) NOT NULL,
  "resourceKey" character varying(255) NOT NULL,
  "fileId" uuid NOT NULL,
  "fileVersion" integer NOT NULL,
  "relationType" character varying(64) NOT NULL,
  alias character varying(255),
  note text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "isPrimary" boolean NOT NULL DEFAULT false,
  status character varying(32) NOT NULL DEFAULT 'active',
  "idempotencyKey" character varying(128) NOT NULL,
  "createdBy" integer NOT NULL,
  "updatedBy" integer,
  "unboundBy" integer,
  "unboundAt" character varying(64),
  CONSTRAINT "PK_pah_file_binding" PRIMARY KEY (id),
  CONSTRAINT "UQ_pah_file_binding_binding_id" UNIQUE ("bindingId"),
  CONSTRAINT "UQ_pah_file_binding_owner_idempotency"
    UNIQUE ("ownerModuleId", "idempotencyKey"),
  CONSTRAINT "FK_pah_file_binding_file"
    FOREIGN KEY ("fileId", "ownerModuleId")
    REFERENCES pah_file_descriptor("fileId", "ownerModuleId") ON DELETE RESTRICT,
  CONSTRAINT "CK_pah_file_binding_status"
    CHECK (status IN ('active', 'unbound')),
  CONSTRAINT "CK_pah_file_binding_file_version"
    CHECK ("fileVersion" >= 1),
  CONSTRAINT "CK_pah_file_binding_attributes"
    CHECK (jsonb_typeof(attributes) = 'object')
);

CREATE TABLE IF NOT EXISTS pah_file_audit_record (
  id SERIAL NOT NULL,
  "createTime" character varying NOT NULL,
  "updateTime" character varying NOT NULL,
  "tenantId" integer,
  "auditId" uuid NOT NULL,
  "ownerModuleId" character varying(128) NOT NULL,
  action character varying(64) NOT NULL,
  result character varying(16) NOT NULL,
  "fileId" uuid,
  "bindingId" uuid,
  "actorId" integer NOT NULL,
  "correlationId" character varying(128) NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "PK_pah_file_audit_record" PRIMARY KEY (id),
  CONSTRAINT "UQ_pah_file_audit_record_audit_id" UNIQUE ("auditId"),
  CONSTRAINT "CK_pah_file_audit_record_result"
    CHECK (result IN ('success', 'denied', 'failed')),
  CONSTRAINT "CK_pah_file_audit_record_detail"
    CHECK (jsonb_typeof(detail) = 'object')
);

-- Cool 首次初始化可能先由 TypeORM 建表。统一其随机主键约束名，并补齐
-- 只属于 Host schema 的唯一、检查与外键约束；不删除或覆盖已有定义。
DO $$
DECLARE
  table_name text;
  expected_name text;
  current_name text;
  constraint_entry record;
BEGIN
  FOR table_name, expected_name IN
    VALUES
      ('pah_file_descriptor', 'PK_pah_file_descriptor'),
      ('pah_file_binding', 'PK_pah_file_binding'),
      ('pah_file_audit_record', 'PK_pah_file_audit_record')
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = expected_name
         AND conrelid = table_name::regclass
         AND contype = 'p'
    ) THEN
      SELECT conname INTO current_name
        FROM pg_constraint
       WHERE conrelid = table_name::regclass
         AND contype = 'p';
      IF current_name IS NULL THEN
        EXECUTE format(
          'ALTER TABLE %I ADD CONSTRAINT %I PRIMARY KEY (id)',
          table_name,
          expected_name
        );
      ELSE
        EXECUTE format(
          'ALTER TABLE %I RENAME CONSTRAINT %I TO %I',
          table_name,
          current_name,
          expected_name
        );
      END IF;
    END IF;
  END LOOP;

  FOR constraint_entry IN
    SELECT * FROM (VALUES
      ('pah_file_descriptor', 'UQ_pah_file_descriptor_file_id',
        'UNIQUE ("fileId")'),
      ('pah_file_descriptor', 'UQ_pah_file_descriptor_file_owner',
        'UNIQUE ("fileId", "ownerModuleId")'),
      ('pah_file_descriptor', 'CK_pah_file_descriptor_status',
        'CHECK (status IN (''active'', ''deleted''))'),
      ('pah_file_descriptor', 'CK_pah_file_descriptor_version',
        'CHECK (version >= 1)'),
      ('pah_file_descriptor', 'CK_pah_file_descriptor_size',
        'CHECK (size > 0)'),
      ('pah_file_descriptor', 'CK_pah_file_descriptor_sha256',
        'CHECK (sha256 ~ ''^[a-f0-9]{64}$'')'),
      ('pah_file_binding', 'UQ_pah_file_binding_binding_id',
        'UNIQUE ("bindingId")'),
      ('pah_file_binding', 'UQ_pah_file_binding_owner_idempotency',
        'UNIQUE ("ownerModuleId", "idempotencyKey")'),
      ('pah_file_binding', 'FK_pah_file_binding_file',
        'FOREIGN KEY ("fileId", "ownerModuleId") REFERENCES pah_file_descriptor("fileId", "ownerModuleId") ON DELETE RESTRICT'),
      ('pah_file_binding', 'CK_pah_file_binding_status',
        'CHECK (status IN (''active'', ''unbound''))'),
      ('pah_file_binding', 'CK_pah_file_binding_file_version',
        'CHECK ("fileVersion" >= 1)'),
      ('pah_file_binding', 'CK_pah_file_binding_attributes',
        'CHECK (jsonb_typeof(attributes) = ''object'')'),
      ('pah_file_audit_record', 'UQ_pah_file_audit_record_audit_id',
        'UNIQUE ("auditId")'),
      ('pah_file_audit_record', 'CK_pah_file_audit_record_result',
        'CHECK (result IN (''success'', ''denied'', ''failed''))'),
      ('pah_file_audit_record', 'CK_pah_file_audit_record_detail',
        'CHECK (jsonb_typeof(detail) = ''object'')')
    ) AS value(table_name, constraint_name, definition)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = constraint_entry.constraint_name
         AND conrelid = constraint_entry.table_name::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I %s',
        constraint_entry.table_name,
        constraint_entry.constraint_name,
        constraint_entry.definition
      );
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS "IDX_pah_file_descriptor_owner_status"
  ON pah_file_descriptor ("ownerModuleId", status);
CREATE INDEX IF NOT EXISTS "IDX_pah_file_descriptor_sha256"
  ON pah_file_descriptor (sha256);
CREATE INDEX IF NOT EXISTS "IDX_pah_file_binding_resource"
  ON pah_file_binding ("ownerModuleId", "resourceType", "resourceKey", status);
CREATE INDEX IF NOT EXISTS "IDX_pah_file_binding_file"
  ON pah_file_binding ("fileId", status);
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_pah_file_binding_active_primary"
  ON pah_file_binding ("ownerModuleId", "resourceType", "resourceKey", "relationType")
  WHERE status = 'active' AND "isPrimary" = true;
CREATE INDEX IF NOT EXISTS "IDX_pah_file_audit_record_owner_created"
  ON pah_file_audit_record ("ownerModuleId", "createTime");
CREATE INDEX IF NOT EXISTS "IDX_pah_file_audit_record_correlation"
  ON pah_file_audit_record ("correlationId");

DO $$
DECLARE
  relation_name text;
  expected_count integer;
  actual_count integer;
BEGIN
  FOR relation_name, expected_count IN
    VALUES
      ('pah_file_descriptor', 19),
      ('pah_file_binding', 22),
      ('pah_file_audit_record', 13)
  LOOP
    SELECT COUNT(*) INTO actual_count
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = relation_name;
    IF actual_count <> expected_count THEN
      RAISE EXCEPTION '% exists with incompatible column count', relation_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('pah_file_descriptor', 'id', 'integer', 'int4', 'NO'),
        ('pah_file_descriptor', 'createTime', 'character varying', 'varchar', 'NO'),
        ('pah_file_descriptor', 'updateTime', 'character varying', 'varchar', 'NO'),
        ('pah_file_descriptor', 'tenantId', 'integer', 'int4', 'YES'),
        ('pah_file_descriptor', 'fileId', 'uuid', 'uuid', 'NO'),
        ('pah_file_descriptor', 'version', 'integer', 'int4', 'NO'),
        ('pah_file_descriptor', 'sha256', 'character', 'bpchar', 'NO'),
        ('pah_file_descriptor', 'mime', 'character varying', 'varchar', 'NO'),
        ('pah_file_descriptor', 'originalName', 'character varying', 'varchar', 'NO'),
        ('pah_file_descriptor', 'size', 'bigint', 'int8', 'NO'),
        ('pah_file_descriptor', 'providerId', 'character varying', 'varchar', 'NO'),
        ('pah_file_descriptor', 'storageIdentity', 'character varying', 'varchar', 'NO'),
        ('pah_file_descriptor', 'storageKey', 'text', 'text', 'NO'),
        ('pah_file_descriptor', 'status', 'character varying', 'varchar', 'NO'),
        ('pah_file_descriptor', 'ownerModuleId', 'character varying', 'varchar', 'NO'),
        ('pah_file_descriptor', 'createdBy', 'integer', 'int4', 'NO'),
        ('pah_file_descriptor', 'updatedBy', 'integer', 'int4', 'YES'),
        ('pah_file_descriptor', 'deletedBy', 'integer', 'int4', 'YES'),
        ('pah_file_descriptor', 'deletedAt', 'character varying', 'varchar', 'YES'),
        ('pah_file_binding', 'id', 'integer', 'int4', 'NO'),
        ('pah_file_binding', 'createTime', 'character varying', 'varchar', 'NO'),
        ('pah_file_binding', 'updateTime', 'character varying', 'varchar', 'NO'),
        ('pah_file_binding', 'tenantId', 'integer', 'int4', 'YES'),
        ('pah_file_binding', 'bindingId', 'uuid', 'uuid', 'NO'),
        ('pah_file_binding', 'ownerModuleId', 'character varying', 'varchar', 'NO'),
        ('pah_file_binding', 'resourceType', 'character varying', 'varchar', 'NO'),
        ('pah_file_binding', 'resourceKey', 'character varying', 'varchar', 'NO'),
        ('pah_file_binding', 'fileId', 'uuid', 'uuid', 'NO'),
        ('pah_file_binding', 'fileVersion', 'integer', 'int4', 'NO'),
        ('pah_file_binding', 'relationType', 'character varying', 'varchar', 'NO'),
        ('pah_file_binding', 'alias', 'character varying', 'varchar', 'YES'),
        ('pah_file_binding', 'note', 'text', 'text', 'YES'),
        ('pah_file_binding', 'attributes', 'jsonb', 'jsonb', 'NO'),
        ('pah_file_binding', 'sortOrder', 'integer', 'int4', 'NO'),
        ('pah_file_binding', 'isPrimary', 'boolean', 'bool', 'NO'),
        ('pah_file_binding', 'status', 'character varying', 'varchar', 'NO'),
        ('pah_file_binding', 'idempotencyKey', 'character varying', 'varchar', 'NO'),
        ('pah_file_binding', 'createdBy', 'integer', 'int4', 'NO'),
        ('pah_file_binding', 'updatedBy', 'integer', 'int4', 'YES'),
        ('pah_file_binding', 'unboundBy', 'integer', 'int4', 'YES'),
        ('pah_file_binding', 'unboundAt', 'character varying', 'varchar', 'YES'),
        ('pah_file_audit_record', 'id', 'integer', 'int4', 'NO'),
        ('pah_file_audit_record', 'createTime', 'character varying', 'varchar', 'NO'),
        ('pah_file_audit_record', 'updateTime', 'character varying', 'varchar', 'NO'),
        ('pah_file_audit_record', 'tenantId', 'integer', 'int4', 'YES'),
        ('pah_file_audit_record', 'auditId', 'uuid', 'uuid', 'NO'),
        ('pah_file_audit_record', 'ownerModuleId', 'character varying', 'varchar', 'NO'),
        ('pah_file_audit_record', 'action', 'character varying', 'varchar', 'NO'),
        ('pah_file_audit_record', 'result', 'character varying', 'varchar', 'NO'),
        ('pah_file_audit_record', 'fileId', 'uuid', 'uuid', 'YES'),
        ('pah_file_audit_record', 'bindingId', 'uuid', 'uuid', 'YES'),
        ('pah_file_audit_record', 'actorId', 'integer', 'int4', 'NO'),
        ('pah_file_audit_record', 'correlationId', 'character varying', 'varchar', 'NO'),
        ('pah_file_audit_record', 'detail', 'jsonb', 'jsonb', 'NO')
      ) AS expected(table_name, column_name, data_type, udt_name, is_nullable)
      LEFT JOIN information_schema.columns actual
        ON actual.table_schema = 'public'
       AND actual.table_name = expected.table_name
       AND actual.column_name = expected.column_name
     WHERE actual.column_name IS NULL
        OR actual.data_type <> expected.data_type
        OR actual.udt_name <> expected.udt_name
        OR actual.is_nullable <> expected.is_nullable
  ) THEN
    RAISE EXCEPTION 'Host Files v1 tables exist with incompatible definitions';
  END IF;
END $$;

DO $$
DECLARE
  expected record;
  actual record;
  columns text[];
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
      ('IDX_pah_file_descriptor_owner_status', 'pah_file_descriptor', false, ARRAY['ownerModuleId', 'status']::text[], false),
      ('IDX_pah_file_descriptor_sha256', 'pah_file_descriptor', false, ARRAY['sha256']::text[], false),
      ('IDX_pah_file_binding_resource', 'pah_file_binding', false, ARRAY['ownerModuleId', 'resourceType', 'resourceKey', 'status']::text[], false),
      ('IDX_pah_file_binding_file', 'pah_file_binding', false, ARRAY['fileId', 'status']::text[], false),
      ('UQ_pah_file_binding_active_primary', 'pah_file_binding', true, ARRAY['ownerModuleId', 'resourceType', 'resourceKey', 'relationType']::text[], true),
      ('IDX_pah_file_audit_record_owner_created', 'pah_file_audit_record', false, ARRAY['ownerModuleId', 'createTime']::text[], false),
      ('IDX_pah_file_audit_record_correlation', 'pah_file_audit_record', false, ARRAY['correlationId']::text[], false)
    ) AS value(index_name, table_name, is_unique, columns, has_predicate)
  LOOP
    SELECT idx.indisunique, idx.indisvalid, idx.indisready,
           am.amname AS access_method,
           pg_get_expr(idx.indpred, idx.indrelid) AS predicate,
           ARRAY(
             SELECT regexp_replace(
               pg_get_indexdef(idx.indexrelid, key_position, true),
               '"',
               '',
               'g'
             )
               FROM generate_series(1, idx.indnkeyatts) key_position
              ORDER BY key_position
           ) AS key_columns
      INTO actual
      FROM pg_catalog.pg_class index_relation
      JOIN pg_catalog.pg_index idx ON idx.indexrelid = index_relation.oid
      JOIN pg_catalog.pg_class table_relation ON table_relation.oid = idx.indrelid
      JOIN pg_catalog.pg_am am ON am.oid = index_relation.relam
     WHERE index_relation.relname = expected.index_name
       AND table_relation.relname = expected.table_name;
    IF actual IS NULL
       OR actual.indisunique <> expected.is_unique
       OR NOT actual.indisvalid
       OR NOT actual.indisready
       OR actual.access_method <> 'btree'
       OR actual.key_columns <> expected.columns
       OR (actual.predicate IS NOT NULL) <> expected.has_predicate
       OR (expected.has_predicate AND (
         actual.predicate NOT ILIKE '%status%active%'
         OR actual.predicate NOT ILIKE '%isPrimary%true%'
       )) THEN
      RAISE EXCEPTION '% exists with incompatible definition', expected.index_name;
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint
     WHERE conname = 'FK_pah_file_binding_file'
       AND contype = 'f'
       AND pg_get_constraintdef(oid, true) =
         'FOREIGN KEY ("fileId", "ownerModuleId") REFERENCES pah_file_descriptor("fileId", "ownerModuleId") ON DELETE RESTRICT'
  ) THEN
    RAISE EXCEPTION 'Host Files v1 foreign key is missing or incompatible';
  END IF;

  IF EXISTS (
    SELECT required.name
      FROM (VALUES
        ('PK_pah_file_descriptor', 'p'),
        ('UQ_pah_file_descriptor_file_id', 'u'),
        ('UQ_pah_file_descriptor_file_owner', 'u'),
        ('CK_pah_file_descriptor_status', 'c'),
        ('CK_pah_file_descriptor_version', 'c'),
        ('CK_pah_file_descriptor_size', 'c'),
        ('CK_pah_file_descriptor_sha256', 'c'),
        ('PK_pah_file_binding', 'p'),
        ('UQ_pah_file_binding_binding_id', 'u'),
        ('UQ_pah_file_binding_owner_idempotency', 'u'),
        ('CK_pah_file_binding_status', 'c'),
        ('CK_pah_file_binding_file_version', 'c'),
        ('CK_pah_file_binding_attributes', 'c'),
        ('PK_pah_file_audit_record', 'p'),
        ('UQ_pah_file_audit_record_audit_id', 'u'),
        ('CK_pah_file_audit_record_result', 'c'),
        ('CK_pah_file_audit_record_detail', 'c')
      ) AS required(name, kind)
      LEFT JOIN pg_catalog.pg_constraint actual
        ON actual.conname = required.name AND actual.contype::text = required.kind
     WHERE actual.oid IS NULL
  ) THEN
    RAISE EXCEPTION 'Host Files v1 constraints are missing or incompatible';
  END IF;
END $$;
