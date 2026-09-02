DO $$
BEGIN
  IF to_regclass('base_sys_user') IS NULL THEN
    RAISE EXCEPTION 'base_sys_user is required before external identity migration';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS pah_external_identity (
  id serial PRIMARY KEY,
  "createTime" varchar NOT NULL,
  "updateTime" varchar NOT NULL,
  "tenantId" integer,
  provider varchar(32) NOT NULL,
  "providerSubject" varchar(256) NOT NULL,
  "userId" integer NOT NULL,
  "tenantKey" varchar(128),
  "openId" varchar(128),
  "unionId" varchar(128),
  "providerUserId" varchar(128),
  "displayName" varchar(256),
  "avatarUrl" text,
  email varchar(320),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'active',
  "linkedByUserId" integer,
  "linkedAt" varchar(40) NOT NULL,
  "lastLoginAt" varchar(40),
  "lastSyncedAt" varchar(40),
  "revokedAt" varchar(40),
  "revokedByUserId" integer,
  CONSTRAINT "CHK_pah_external_identity_status"
    CHECK (status IN ('active', 'revoked')),
  CONSTRAINT "FK_pah_external_identity_user"
    FOREIGN KEY ("userId") REFERENCES base_sys_user(id) ON DELETE RESTRICT,
  CONSTRAINT "FK_pah_external_identity_linked_by"
    FOREIGN KEY ("linkedByUserId") REFERENCES base_sys_user(id) ON DELETE RESTRICT,
  CONSTRAINT "FK_pah_external_identity_revoked_by"
    FOREIGN KEY ("revokedByUserId") REFERENCES base_sys_user(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_pah_external_identity_subject"
  ON pah_external_identity (provider, "providerSubject");
CREATE INDEX IF NOT EXISTS "IDX_pah_external_identity_user"
  ON pah_external_identity ("userId");
CREATE INDEX IF NOT EXISTS "IDX_pah_external_identity_tenant"
  ON pah_external_identity ("tenantKey");
CREATE INDEX IF NOT EXISTS "IDX_pah_external_identity_status"
  ON pah_external_identity (status);

CREATE TABLE IF NOT EXISTS pah_external_bind_request (
  id serial PRIMARY KEY,
  "createTime" varchar NOT NULL,
  "updateTime" varchar NOT NULL,
  "tenantId" integer,
  provider varchar(32) NOT NULL,
  "providerSubject" varchar(256) NOT NULL,
  "tenantKey" varchar(128),
  "openId" varchar(128),
  "unionId" varchar(128),
  "providerUserId" varchar(128),
  "displayName" varchar(256),
  "avatarUrl" text,
  email varchar(320),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'pending',
  "boundUserId" integer,
  "handledByUserId" integer,
  "handledAt" varchar(40),
  note text,
  "lastSeenAt" varchar(40) NOT NULL,
  CONSTRAINT "CHK_pah_external_bind_request_status"
    CHECK (status IN ('pending', 'bound', 'rejected')),
  CONSTRAINT "FK_pah_external_bind_request_bound_user"
    FOREIGN KEY ("boundUserId") REFERENCES base_sys_user(id) ON DELETE RESTRICT,
  CONSTRAINT "FK_pah_external_bind_request_handled_by"
    FOREIGN KEY ("handledByUserId") REFERENCES base_sys_user(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_pah_external_bind_request_subject"
  ON pah_external_bind_request (provider, "providerSubject");
CREATE INDEX IF NOT EXISTS "IDX_pah_external_bind_request_tenant"
  ON pah_external_bind_request ("tenantKey");
CREATE INDEX IF NOT EXISTS "IDX_pah_external_bind_request_status"
  ON pah_external_bind_request (status);

CREATE TABLE IF NOT EXISTS pah_oauth_login_attempt (
  id serial PRIMARY KEY,
  "createTime" varchar NOT NULL,
  "updateTime" varchar NOT NULL,
  "tenantId" integer,
  provider varchar(32) NOT NULL,
  "stateHash" varchar(64) NOT NULL,
  "returnTo" text NOT NULL,
  "expiresAt" varchar(40) NOT NULL,
  "usedAt" varchar(40),
  "failureCode" varchar(64)
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_pah_oauth_login_attempt_state"
  ON pah_oauth_login_attempt ("stateHash");
CREATE INDEX IF NOT EXISTS "IDX_pah_oauth_login_attempt_expiry"
  ON pah_oauth_login_attempt ("expiresAt", "usedAt");

CREATE TABLE IF NOT EXISTS pah_oauth_login_ticket (
  id serial PRIMARY KEY,
  "createTime" varchar NOT NULL,
  "updateTime" varchar NOT NULL,
  "tenantId" integer,
  "ticketHash" varchar(64) NOT NULL,
  "userId" integer NOT NULL,
  "identityId" integer NOT NULL,
  provider varchar(32) NOT NULL,
  "returnTo" text NOT NULL,
  "expiresAt" varchar(40) NOT NULL,
  "usedAt" varchar(40),
  CONSTRAINT "FK_pah_oauth_login_ticket_user"
    FOREIGN KEY ("userId") REFERENCES base_sys_user(id) ON DELETE RESTRICT,
  CONSTRAINT "FK_pah_oauth_login_ticket_identity"
    FOREIGN KEY ("identityId") REFERENCES pah_external_identity(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_pah_oauth_login_ticket_hash"
  ON pah_oauth_login_ticket ("ticketHash");
CREATE INDEX IF NOT EXISTS "IDX_pah_oauth_login_ticket_expiry"
  ON pah_oauth_login_ticket ("expiresAt", "usedAt");

-- Cool 首次初始化会先按 TypeORM entity 建立这些 Host 表。此时表已存在，
-- CREATE TABLE IF NOT EXISTS 不会补上由 Host schema 拥有的 CHECK / FK。
-- 在校验定义前只补“缺失”的同名约束；若已有同名但定义不兼容，后续
-- 权威校验仍会 fail-closed，已有数据违反约束时 ALTER TABLE 也会拒绝。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CHK_pah_external_identity_status'
      AND conrelid = 'pah_external_identity'::regclass
  ) THEN
    ALTER TABLE pah_external_identity
      ADD CONSTRAINT "CHK_pah_external_identity_status"
      CHECK (status IN ('active', 'revoked'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CHK_pah_external_bind_request_status'
      AND conrelid = 'pah_external_bind_request'::regclass
  ) THEN
    ALTER TABLE pah_external_bind_request
      ADD CONSTRAINT "CHK_pah_external_bind_request_status"
      CHECK (status IN ('pending', 'bound', 'rejected'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'FK_pah_external_identity_user'
      AND conrelid = 'pah_external_identity'::regclass
  ) THEN
    ALTER TABLE pah_external_identity
      ADD CONSTRAINT "FK_pah_external_identity_user"
      FOREIGN KEY ("userId") REFERENCES base_sys_user(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'FK_pah_external_identity_linked_by'
      AND conrelid = 'pah_external_identity'::regclass
  ) THEN
    ALTER TABLE pah_external_identity
      ADD CONSTRAINT "FK_pah_external_identity_linked_by"
      FOREIGN KEY ("linkedByUserId") REFERENCES base_sys_user(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'FK_pah_external_identity_revoked_by'
      AND conrelid = 'pah_external_identity'::regclass
  ) THEN
    ALTER TABLE pah_external_identity
      ADD CONSTRAINT "FK_pah_external_identity_revoked_by"
      FOREIGN KEY ("revokedByUserId") REFERENCES base_sys_user(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'FK_pah_external_bind_request_bound_user'
      AND conrelid = 'pah_external_bind_request'::regclass
  ) THEN
    ALTER TABLE pah_external_bind_request
      ADD CONSTRAINT "FK_pah_external_bind_request_bound_user"
      FOREIGN KEY ("boundUserId") REFERENCES base_sys_user(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'FK_pah_external_bind_request_handled_by'
      AND conrelid = 'pah_external_bind_request'::regclass
  ) THEN
    ALTER TABLE pah_external_bind_request
      ADD CONSTRAINT "FK_pah_external_bind_request_handled_by"
      FOREIGN KEY ("handledByUserId") REFERENCES base_sys_user(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'FK_pah_oauth_login_ticket_user'
      AND conrelid = 'pah_oauth_login_ticket'::regclass
  ) THEN
    ALTER TABLE pah_oauth_login_ticket
      ADD CONSTRAINT "FK_pah_oauth_login_ticket_user"
      FOREIGN KEY ("userId") REFERENCES base_sys_user(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'FK_pah_oauth_login_ticket_identity'
      AND conrelid = 'pah_oauth_login_ticket'::regclass
  ) THEN
    ALTER TABLE pah_oauth_login_ticket
      ADD CONSTRAINT "FK_pah_oauth_login_ticket_identity"
      FOREIGN KEY ("identityId") REFERENCES pah_external_identity(id) ON DELETE CASCADE;
  END IF;
END
$$;

DO $$
DECLARE
  definitions_valid boolean;
BEGIN
  SELECT COUNT(*) = 26
  INTO definitions_valid
  FROM (
    VALUES
      ('pah_external_identity', 'provider', 'varchar', true),
      ('pah_external_identity', 'providerSubject', 'varchar', true),
      ('pah_external_identity', 'userId', 'int4', true),
      ('pah_external_identity', 'tenantKey', 'varchar', false),
      ('pah_external_identity', 'openId', 'varchar', false),
      ('pah_external_identity', 'metadata', 'jsonb', true),
      ('pah_external_identity', 'status', 'varchar', true),
      ('pah_external_identity', 'linkedAt', 'varchar', true),
      ('pah_external_identity', 'revokedByUserId', 'int4', false),
      ('pah_external_bind_request', 'provider', 'varchar', true),
      ('pah_external_bind_request', 'providerSubject', 'varchar', true),
      ('pah_external_bind_request', 'metadata', 'jsonb', true),
      ('pah_external_bind_request', 'status', 'varchar', true),
      ('pah_external_bind_request', 'boundUserId', 'int4', false),
      ('pah_external_bind_request', 'handledByUserId', 'int4', false),
      ('pah_external_bind_request', 'lastSeenAt', 'varchar', true),
      ('pah_oauth_login_attempt', 'stateHash', 'varchar', true),
      ('pah_oauth_login_attempt', 'returnTo', 'text', true),
      ('pah_oauth_login_attempt', 'expiresAt', 'varchar', true),
      ('pah_oauth_login_attempt', 'usedAt', 'varchar', false),
      ('pah_oauth_login_ticket', 'ticketHash', 'varchar', true),
      ('pah_oauth_login_ticket', 'userId', 'int4', true),
      ('pah_oauth_login_ticket', 'identityId', 'int4', true),
      ('pah_oauth_login_ticket', 'returnTo', 'text', true),
      ('pah_oauth_login_ticket', 'expiresAt', 'varchar', true),
      ('pah_oauth_login_ticket', 'usedAt', 'varchar', false)
  ) expected(table_name, column_name, type_name, required)
  JOIN pg_class table_relation
    ON table_relation.relname = expected.table_name
   AND table_relation.relnamespace = current_schema()::regnamespace
  JOIN pg_attribute attribute
    ON attribute.attrelid = table_relation.oid
   AND attribute.attname = expected.column_name
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
  JOIN pg_type column_type ON column_type.oid = attribute.atttypid
  WHERE column_type.typname = expected.type_name
    AND attribute.attnotnull = expected.required;

  IF NOT COALESCE(definitions_valid, false) THEN
    RAISE EXCEPTION 'external identity tables exist with incompatible definitions';
  END IF;
END
$$;

DO $$
DECLARE
  definitions_valid boolean;
BEGIN
  SELECT COUNT(*) = 2
  INTO definitions_valid
  FROM (
    VALUES
      ('CHK_pah_external_identity_status', 'pah_external_identity', 'active', 'revoked', NULL),
      ('CHK_pah_external_bind_request_status', 'pah_external_bind_request', 'pending', 'bound', 'rejected')
  ) expected(constraint_name, table_name, token_one, token_two, token_three)
  JOIN pg_constraint constraint_info
    ON constraint_info.conname = expected.constraint_name
   AND constraint_info.connamespace = current_schema()::regnamespace
   AND constraint_info.contype = 'c'
   AND constraint_info.convalidated
  JOIN pg_class table_relation
    ON table_relation.oid = constraint_info.conrelid
   AND table_relation.relname = expected.table_name
  WHERE lower(pg_get_constraintdef(constraint_info.oid)) LIKE '%' || expected.token_one || '%'
    AND lower(pg_get_constraintdef(constraint_info.oid)) LIKE '%' || expected.token_two || '%'
    AND (
      expected.token_three IS NULL
      OR lower(pg_get_constraintdef(constraint_info.oid)) LIKE '%' || expected.token_three || '%'
    );

  IF NOT COALESCE(definitions_valid, false) THEN
    RAISE EXCEPTION 'external identity status checks exist with incompatible definitions';
  END IF;
END
$$;

DO $$
DECLARE
  definitions_valid boolean;
BEGIN
  SELECT COUNT(*) = 7
  INTO definitions_valid
  FROM (
    VALUES
      ('FK_pah_external_identity_user', 'pah_external_identity',
        'foreignkeyuseridreferencesbase_sys_useridondeleterestrict'),
      ('FK_pah_external_identity_linked_by', 'pah_external_identity',
        'foreignkeylinkedbyuseridreferencesbase_sys_useridondeleterestrict'),
      ('FK_pah_external_identity_revoked_by', 'pah_external_identity',
        'foreignkeyrevokedbyuseridreferencesbase_sys_useridondeleterestrict'),
      ('FK_pah_external_bind_request_bound_user', 'pah_external_bind_request',
        'foreignkeybounduseridreferencesbase_sys_useridondeleterestrict'),
      ('FK_pah_external_bind_request_handled_by', 'pah_external_bind_request',
        'foreignkeyhandledbyuseridreferencesbase_sys_useridondeleterestrict'),
      ('FK_pah_oauth_login_ticket_user', 'pah_oauth_login_ticket',
        'foreignkeyuseridreferencesbase_sys_useridondeleterestrict'),
      ('FK_pah_oauth_login_ticket_identity', 'pah_oauth_login_ticket',
        'foreignkeyidentityidreferencespah_external_identityidondeletecascade')
  ) expected(constraint_name, table_name, definition)
  JOIN pg_constraint constraint_info
    ON constraint_info.conname = expected.constraint_name
   AND constraint_info.connamespace = current_schema()::regnamespace
   AND constraint_info.contype = 'f'
   AND constraint_info.convalidated
  JOIN pg_class table_relation
    ON table_relation.oid = constraint_info.conrelid
   AND table_relation.relname = expected.table_name
  WHERE lower(
    regexp_replace(
      pg_get_constraintdef(constraint_info.oid),
      '[()[:space:]"]',
      '',
      'g'
    )
  ) = expected.definition;

  IF NOT COALESCE(definitions_valid, false) THEN
    RAISE EXCEPTION 'external identity foreign keys exist with incompatible definitions';
  END IF;
END
$$;

DO $$
DECLARE
  definitions_valid boolean;
BEGIN
  SELECT COUNT(*) = 11
  INTO definitions_valid
  FROM (
    VALUES
      ('UQ_pah_external_identity_subject', 'pah_external_identity', true, 2, 'provider', '"providerSubject"'),
      ('IDX_pah_external_identity_user', 'pah_external_identity', false, 1, '"userId"', NULL),
      ('IDX_pah_external_identity_tenant', 'pah_external_identity', false, 1, '"tenantKey"', NULL),
      ('IDX_pah_external_identity_status', 'pah_external_identity', false, 1, 'status', NULL),
      ('UQ_pah_external_bind_request_subject', 'pah_external_bind_request', true, 2, 'provider', '"providerSubject"'),
      ('IDX_pah_external_bind_request_tenant', 'pah_external_bind_request', false, 1, '"tenantKey"', NULL),
      ('IDX_pah_external_bind_request_status', 'pah_external_bind_request', false, 1, 'status', NULL),
      ('UQ_pah_oauth_login_attempt_state', 'pah_oauth_login_attempt', true, 1, '"stateHash"', NULL),
      ('IDX_pah_oauth_login_attempt_expiry', 'pah_oauth_login_attempt', false, 2, '"expiresAt"', '"usedAt"'),
      ('UQ_pah_oauth_login_ticket_hash', 'pah_oauth_login_ticket', true, 1, '"ticketHash"', NULL),
      ('IDX_pah_oauth_login_ticket_expiry', 'pah_oauth_login_ticket', false, 2, '"expiresAt"', '"usedAt"')
  ) expected(index_name, table_name, is_unique, key_count, key_one, key_two)
  JOIN pg_class index_relation
    ON index_relation.relname = expected.index_name
   AND index_relation.relnamespace = current_schema()::regnamespace
  JOIN pg_index index_info ON index_info.indexrelid = index_relation.oid
  JOIN pg_class table_relation ON table_relation.oid = index_info.indrelid
  JOIN pg_am access_method ON access_method.oid = index_relation.relam
  WHERE index_relation.relkind = 'i'
    AND table_relation.relname = expected.table_name
    AND index_info.indisunique = expected.is_unique
    AND index_info.indisvalid
    AND index_info.indisready
    AND index_info.indnkeyatts = expected.key_count
    AND index_info.indnatts = expected.key_count
    AND index_info.indexprs IS NULL
    AND index_info.indpred IS NULL
    AND access_method.amname = 'btree'
    AND pg_get_indexdef(index_relation.oid, 1, true) = expected.key_one
    AND (
      expected.key_two IS NULL
      OR pg_get_indexdef(index_relation.oid, 2, true) = expected.key_two
    );

  IF NOT COALESCE(definitions_valid, false) THEN
    RAISE EXCEPTION 'external identity indexes exist with incompatible definitions';
  END IF;
END
$$;
