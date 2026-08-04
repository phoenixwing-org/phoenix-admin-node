DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM dict_type
    GROUP BY key
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'dict_type.key contains duplicates; run read-only conflict review before this migration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM dict_info
    WHERE value IS NOT NULL
    GROUP BY "typeId", value
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'dict_info(typeId,value) contains duplicates; run read-only conflict review before this migration';
  END IF;
END
$$;

DO $$
DECLARE
  target_table regclass := to_regclass('dict_type');
  target_schema oid;
  index_oid oid;
  definition_valid boolean := false;
BEGIN
  IF target_table IS NULL THEN
    RAISE EXCEPTION 'dict_type is not visible on the active search_path';
  END IF;
  SELECT relnamespace INTO target_schema FROM pg_class WHERE oid = target_table;
  SELECT oid INTO index_oid
  FROM pg_class
  WHERE relnamespace = target_schema AND relname = 'UQ_dict_type_key';

  IF index_oid IS NULL THEN
    EXECUTE 'CREATE UNIQUE INDEX "UQ_dict_type_key" ON dict_type (key)';
    SELECT oid INTO index_oid
    FROM pg_class
    WHERE relnamespace = target_schema AND relname = 'UQ_dict_type_key';
  END IF;

  SELECT
    index_relation.relkind = 'i'
    AND index_info.indrelid = target_table
    AND index_info.indisunique
    AND index_info.indisvalid
    AND index_info.indisready
    AND index_info.indnkeyatts = 1
    AND index_info.indnatts = 1
    AND index_info.indexprs IS NULL
    AND index_info.indpred IS NULL
    AND access_method.amname = 'btree'
    AND pg_get_indexdef(index_oid, 1, true) = 'key'
  INTO definition_valid
  FROM pg_class index_relation
  JOIN pg_index index_info ON index_info.indexrelid = index_relation.oid
  JOIN pg_am access_method ON access_method.oid = index_relation.relam
  WHERE index_relation.oid = index_oid;

  IF NOT COALESCE(definition_valid, false) THEN
    RAISE EXCEPTION 'UQ_dict_type_key exists but is not the required unique btree index on dict_type(key)';
  END IF;
END
$$;

DO $$
DECLARE
  target_table regclass := to_regclass('dict_info');
  target_schema oid;
  index_oid oid;
  definition_valid boolean := false;
BEGIN
  IF target_table IS NULL THEN
    RAISE EXCEPTION 'dict_info is not visible on the active search_path';
  END IF;
  SELECT relnamespace INTO target_schema FROM pg_class WHERE oid = target_table;
  SELECT oid INTO index_oid
  FROM pg_class
  WHERE relnamespace = target_schema AND relname = 'UQ_dict_info_type_value';

  IF index_oid IS NULL THEN
    EXECUTE 'CREATE UNIQUE INDEX "UQ_dict_info_type_value" ON dict_info ("typeId", value) WHERE value IS NOT NULL';
    SELECT oid INTO index_oid
    FROM pg_class
    WHERE relnamespace = target_schema AND relname = 'UQ_dict_info_type_value';
  END IF;

  SELECT
    index_relation.relkind = 'i'
    AND index_info.indrelid = target_table
    AND index_info.indisunique
    AND index_info.indisvalid
    AND index_info.indisready
    AND index_info.indnkeyatts = 2
    AND index_info.indnatts = 2
    AND index_info.indexprs IS NULL
    AND index_info.indpred IS NOT NULL
    AND access_method.amname = 'btree'
    AND pg_get_indexdef(index_oid, 1, true) = '"typeId"'
    AND pg_get_indexdef(index_oid, 2, true) = 'value'
    AND lower(
      regexp_replace(
        pg_get_expr(index_info.indpred, index_info.indrelid),
        '[()[:space:]"]',
        '',
        'g'
      )
    ) = 'valueisnotnull'
  INTO definition_valid
  FROM pg_class index_relation
  JOIN pg_index index_info ON index_info.indexrelid = index_relation.oid
  JOIN pg_am access_method ON access_method.oid = index_relation.relam
  WHERE index_relation.oid = index_oid;

  IF NOT COALESCE(definition_valid, false) THEN
    RAISE EXCEPTION 'UQ_dict_info_type_value exists but is not the required unique partial btree index on dict_info(typeId,value)';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS pah_dictionary_reconcile_record (
  id serial PRIMARY KEY,
  "createTime" varchar NOT NULL,
  "updateTime" varchar NOT NULL,
  "tenantId" integer,
  "moduleId" varchar NOT NULL,
  "pluginVersion" varchar NOT NULL,
  "catalogHash" varchar NOT NULL,
  "actorId" varchar NOT NULL,
  status varchar NOT NULL,
  detail jsonb NOT NULL,
  error text,
  CONSTRAINT "CHK_pah_dictionary_reconcile_status"
    CHECK (status IN ('running', 'succeeded', 'failed'))
);

CREATE INDEX IF NOT EXISTS "IDX_pah_dictionary_reconcile_module"
  ON pah_dictionary_reconcile_record ("moduleId");
CREATE INDEX IF NOT EXISTS "IDX_pah_dictionary_reconcile_catalog"
  ON pah_dictionary_reconcile_record ("catalogHash");
CREATE INDEX IF NOT EXISTS "IDX_pah_dictionary_reconcile_created"
  ON pah_dictionary_reconcile_record ("createTime");
