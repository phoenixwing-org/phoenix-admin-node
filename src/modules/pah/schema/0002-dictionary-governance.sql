ALTER TABLE dict_info
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS core boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "ownerModuleId" varchar(128);

ALTER TABLE dict_type
  ADD COLUMN IF NOT EXISTS "ownerModuleId" varchar(128);

DO $$
DECLARE
  enabled_valid boolean;
  tags_valid boolean;
  core_valid boolean;
  info_owner_valid boolean;
  type_owner_valid boolean;
BEGIN
  SELECT
    data_type = 'boolean'
    AND is_nullable = 'NO'
    AND column_default IN ('true', 'true::boolean')
  INTO enabled_valid
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'dict_info'
    AND column_name = 'enabled';

  SELECT
    data_type = 'ARRAY'
    AND udt_name = '_text'
    AND is_nullable = 'NO'
    AND regexp_replace(column_default, '[[:space:]]', '', 'g') IN
      ('''{}''::text[]', 'ARRAY[]::text[]')
  INTO tags_valid
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'dict_info'
    AND column_name = 'tags';

  SELECT
    data_type = 'boolean'
    AND is_nullable = 'NO'
    AND column_default IN ('false', 'false::boolean')
  INTO core_valid
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'dict_info'
    AND column_name = 'core';

  SELECT
    data_type = 'character varying'
    AND character_maximum_length = 128
    AND is_nullable = 'YES'
  INTO info_owner_valid
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'dict_info'
    AND column_name = 'ownerModuleId';

  SELECT
    data_type = 'character varying'
    AND character_maximum_length = 128
    AND is_nullable = 'YES'
  INTO type_owner_valid
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'dict_type'
    AND column_name = 'ownerModuleId';

  IF NOT COALESCE(enabled_valid, false)
    OR NOT COALESCE(tags_valid, false)
    OR NOT COALESCE(core_valid, false)
    OR NOT COALESCE(info_owner_valid, false)
    OR NOT COALESCE(type_owner_valid, false)
  THEN
    RAISE EXCEPTION 'dictionary governance columns exist with incompatible definitions';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "IDX_dict_info_enabled"
  ON dict_info (enabled);
CREATE INDEX IF NOT EXISTS "IDX_dict_info_owner_module"
  ON dict_info ("ownerModuleId");
CREATE INDEX IF NOT EXISTS "IDX_dict_type_owner_module"
  ON dict_type ("ownerModuleId");
CREATE INDEX IF NOT EXISTS "IDX_dict_info_tags"
  ON dict_info USING gin (tags);

DO $$
DECLARE
  target_info regclass := to_regclass('dict_info');
  target_type regclass := to_regclass('dict_type');
  valid boolean;
BEGIN
  SELECT COUNT(*) = 4
  INTO valid
  FROM (
    SELECT index_name
    FROM (
      VALUES
        ('IDX_dict_info_enabled', target_info, 'btree', 'enabled'),
        ('IDX_dict_info_owner_module', target_info, 'btree', '"ownerModuleId"'),
        ('IDX_dict_type_owner_module', target_type, 'btree', '"ownerModuleId"'),
        ('IDX_dict_info_tags', target_info, 'gin', 'tags')
    ) expected(index_name, table_oid, access_method, key_name)
    JOIN pg_class index_relation
      ON index_relation.relname = expected.index_name
     AND index_relation.relnamespace = (
       SELECT relnamespace FROM pg_class WHERE oid = expected.table_oid
     )
    JOIN pg_index index_info ON index_info.indexrelid = index_relation.oid
    JOIN pg_am access_method ON access_method.oid = index_relation.relam
    WHERE index_relation.relkind = 'i'
      AND index_info.indrelid = expected.table_oid
      AND index_info.indisvalid
      AND index_info.indisready
      AND index_info.indnkeyatts = 1
      AND index_info.indnatts = 1
      AND index_info.indexprs IS NULL
      AND index_info.indpred IS NULL
      AND access_method.amname = expected.access_method
      AND pg_get_indexdef(index_relation.oid, 1, true) = expected.key_name
  ) definitions;

  IF NOT COALESCE(valid, false) THEN
    RAISE EXCEPTION 'dictionary governance index exists with an incompatible definition';
  END IF;
END
$$;
