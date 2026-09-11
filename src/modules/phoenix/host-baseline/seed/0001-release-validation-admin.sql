WITH inserted_department AS (
  INSERT INTO base_sys_department (
    id, "createTime", "updateTime", "tenantId", name, "userId", "parentId", "orderNum"
  ) VALUES (
    1, $3, $3, NULL, 'Phoenix Admin', NULL, NULL, 0
  )
  RETURNING id
), inserted_role AS (
  INSERT INTO base_sys_role (
    id, "createTime", "updateTime", "tenantId", "userId", name, label,
    remark, relevance, "menuIdList", "departmentIdList"
  )
  SELECT
    1, $3, $3, NULL, department.id::text, '发布验收管理员', 'admin',
    '本机 release-validation 一次性管理员', false, '[]'::json, '[]'::json
  FROM inserted_department department
  RETURNING id
), inserted_user AS (
  INSERT INTO base_sys_user (
    id, "createTime", "updateTime", "tenantId", "departmentId", "userId",
    name, username, password, "passwordV", "nickName", "headImg", phone,
    email, remark, status, "socketId"
  )
  SELECT
    1, $3, $3, NULL, department.id, NULL,
    '发布验收管理员', $1, $2, 1, '发布验收管理员', NULL, NULL,
    NULL, '仅用于本机隔离发布验收', 1, NULL
  FROM inserted_department department
  CROSS JOIN inserted_role role
  RETURNING id
), inserted_user_role AS (
  INSERT INTO base_sys_user_role (
    id, "createTime", "updateTime", "tenantId", "userId", "roleId"
  )
  SELECT 1, $3, $3, NULL, admin_user.id, admin_role.id
  FROM inserted_user admin_user
  CROSS JOIN inserted_role admin_role
  RETURNING id
)
SELECT
  department.id AS "departmentId",
  admin_role.id AS "roleId",
  admin_user.id AS "userId",
  user_role.id AS "userRoleId",
  setval(pg_get_serial_sequence('base_sys_department', 'id'), department.id, true)
    AS "departmentSequence",
  setval(pg_get_serial_sequence('base_sys_role', 'id'), admin_role.id, true)
    AS "roleSequence",
  setval(pg_get_serial_sequence('base_sys_user', 'id'), admin_user.id, true)
    AS "userSequence",
  setval(pg_get_serial_sequence('base_sys_user_role', 'id'), user_role.id, true)
    AS "userRoleSequence"
FROM inserted_department department
CROSS JOIN inserted_role admin_role
CROSS JOIN inserted_user admin_user
CROSS JOIN inserted_user_role user_role;
