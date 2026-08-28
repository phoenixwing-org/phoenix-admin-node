DO $$
BEGIN
  IF to_regclass('base_sys_menu') IS NULL THEN
    RAISE EXCEPTION 'base_sys_menu is required before dictionary menu route migration';
  END IF;
END
$$;

UPDATE base_sys_menu
SET
  router = CASE
    WHEN router = '/pah/dictionary-maintenance'
      THEN '/phoenix/dictionary-maintenance'
    ELSE router
  END,
  "viewPath" = CASE
    WHEN "viewPath" = 'modules/pah/views/dictionary-maintenance.vue'
      THEN 'modules/phoenix/views/dictionary-maintenance.vue'
    ELSE "viewPath"
  END
WHERE router = '/pah/dictionary-maintenance'
  OR "viewPath" = 'modules/pah/views/dictionary-maintenance.vue';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM base_sys_menu
    WHERE router = '/pah/dictionary-maintenance'
      OR "viewPath" = 'modules/pah/views/dictionary-maintenance.vue'
  ) THEN
    RAISE EXCEPTION 'legacy dictionary menu route remains after migration';
  END IF;
END
$$;
