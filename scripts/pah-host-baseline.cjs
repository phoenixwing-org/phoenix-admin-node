const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { lstatSync, readFileSync, realpathSync } = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const baselineRoot = path.resolve(
  __dirname,
  '../src/modules/pah/host-baseline'
);
const safeIdentifier = /^[a-z][a-z0-9_]{0,62}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;

class BaselineError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function stableJson(value) {
  return JSON.stringify(value);
}

function safeRelativePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !path.posix.isAbsolute(value) &&
    !path.win32.isAbsolute(value) &&
    path.posix.normalize(value) === value &&
    value.split('/').every(segment => segment !== '.' && segment !== '..')
  );
}

function verifiedFile(root, artifact) {
  if (
    !artifact ||
    !safeRelativePath(artifact.path) ||
    !Number.isSafeInteger(artifact.size) ||
    artifact.size <= 0 ||
    !sha256Pattern.test(artifact.sha256)
  ) {
    throw new BaselineError(
      'INVALID_MANIFEST',
      `基线制品声明不合法：${(artifact && artifact.id) || 'unknown'}`
    );
  }
  const target = path.join(root, ...artifact.path.split('/'));
  const info = lstatSync(target);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new BaselineError(
      'INVALID_ARTIFACT',
      `基线制品不是普通文件：${artifact.id}`
    );
  }
  const content = readFileSync(target);
  if (
    content.byteLength !== artifact.size ||
    sha256(content) !== artifact.sha256
  ) {
    throw new BaselineError(
      'ARTIFACT_INTEGRITY_FAILED',
      `基线制品完整性校验失败：${artifact.id}`
    );
  }
  return content;
}

function extractCreatedRelations(sql) {
  const relations = [];
  const pattern =
    /\bCREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:"([^"]+)"|([a-z][a-z0-9_]*))/giu;
  for (const match of sql.matchAll(pattern))
    relations.push(match[1] || match[2]);
  return relations;
}

function loadAndVerifyManifest(root = baselineRoot) {
  const manifest = JSON.parse(
    readFileSync(path.join(root, 'host-baseline.json'), 'utf8')
  );
  if (
    manifest.formatVersion !== 1 ||
    manifest.baselineId !== 'phoenix-admin-host' ||
    manifest.version !== 1 ||
    !/^[a-f0-9]{40}$/u.test(manifest.sourceCommit) ||
    manifest.pahHostSchemaVersion !== 2 ||
    !Array.isArray(manifest.sourceFiles) ||
    manifest.sourceFiles.length === 0 ||
    !Array.isArray(manifest.schemaArtifacts) ||
    manifest.schemaArtifacts.length !== 3 ||
    !Array.isArray(manifest.requiredRelations) ||
    manifest.requiredRelations.length === 0 ||
    !manifest.requiredRelations.every(relation =>
      safeIdentifier.test(relation)
    ) ||
    new Set(manifest.requiredRelations).size !==
      manifest.requiredRelations.length ||
    stableJson([...manifest.requiredRelations].sort()) !==
      stableJson(manifest.requiredRelations)
  ) {
    throw new BaselineError(
      'INVALID_MANIFEST',
      'Host baseline manifest 不合法'
    );
  }
  const schemaContents = manifest.schemaArtifacts.map(artifact =>
    verifiedFile(root, artifact)
  );
  verifiedFile(root, manifest.adminSeedArtifact);
  const declaredRelations = [
    ...new Set(
      schemaContents.flatMap(content =>
        extractCreatedRelations(content.toString('utf8'))
      )
    ),
  ].sort();
  if (
    stableJson(declaredRelations) !== stableJson(manifest.requiredRelations)
  ) {
    throw new BaselineError(
      'RELATION_MANIFEST_MISMATCH',
      'Host baseline SQL 与 requiredRelations 不一致'
    );
  }
  if (
    !manifest.expectedSchema ||
    !Number.isSafeInteger(manifest.expectedSchema.columns) ||
    !Number.isSafeInteger(manifest.expectedSchema.indexes) ||
    !Number.isSafeInteger(manifest.expectedSchema.constraints) ||
    !Number.isSafeInteger(manifest.expectedSchema.sequences) ||
    !sha256Pattern.test(manifest.expectedSchema.sha256)
  ) {
    throw new BaselineError('INVALID_MANIFEST', 'Host baseline 结构指纹不合法');
  }
  return { manifest, schemaContents };
}

function git(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new BaselineError(
      'SOURCE_PROVENANCE_FAILED',
      '无法验证冻结 Host 源码 Git 身份'
    );
  }
}

function gitBuffer(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new BaselineError(
      'SOURCE_PROVENANCE_FAILED',
      '无法读取冻结 Host Git 对象'
    );
  }
}

function verifySourceRepository(manifest, sourceRepository) {
  if (!sourceRepository) {
    throw new BaselineError(
      'SOURCE_REPOSITORY_REQUIRED',
      '缺少 PAH_HOST_BASELINE_SOURCE_REPOSITORY'
    );
  }
  const root = realpathSync(sourceRepository);
  git(root, ['cat-file', '-e', `${manifest.sourceCommit}^{commit}`]);
  for (const source of manifest.sourceFiles) {
    if (!safeRelativePath(source.path) || !sha256Pattern.test(source.sha256)) {
      throw new BaselineError(
        'INVALID_MANIFEST',
        'Host baseline 来源文件声明不合法'
      );
    }
    const content = gitBuffer(root, [
      'show',
      `${manifest.sourceCommit}:${source.path}`,
    ]);
    if (sha256(content) !== source.sha256) {
      throw new BaselineError(
        'SOURCE_PROVENANCE_FAILED',
        `冻结 Host 来源文件校验失败：${source.path}`
      );
    }
  }
  return root;
}

function readConfig(manifest, env = process.env) {
  const environmentKind = env.PAH_HOST_BASELINE_ENVIRONMENT;
  const host = env.PAH_HOST_BASELINE_DB_HOST;
  const database = env.PAH_HOST_BASELINE_DB_DATABASE;
  const username = env.PAH_HOST_BASELINE_DB_USERNAME;
  const allowedDatabase = env.PAH_HOST_BASELINE_ALLOWED_DATABASE;
  const port = Number(env.PAH_HOST_BASELINE_DB_PORT);
  if (environmentKind !== manifest.policy.environmentKind) {
    throw new BaselineError(
      'ENVIRONMENT_DENIED',
      '只允许显式 release-validation 环境'
    );
  }
  if (!manifest.policy.loopbackHosts.includes(host)) {
    throw new BaselineError(
      'HOST_DENIED',
      '只允许本机 PostgreSQL loopback 地址'
    );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new BaselineError('INVALID_PORT', 'PostgreSQL 端口不合法');
  }
  if (!database || database !== allowedDatabase) {
    throw new BaselineError(
      'DATABASE_NOT_ALLOWLISTED',
      '目标数据库必须与精确 allowlist 完全一致'
    );
  }
  if (manifest.policy.maintenanceDatabases.includes(database)) {
    throw new BaselineError(
      'MAINTENANCE_DATABASE_DENIED',
      '拒绝 maintenance 数据库'
    );
  }
  if (!username) {
    throw new BaselineError(
      'DATABASE_USERNAME_REQUIRED',
      '缺少显式 PAH_HOST_BASELINE_DB_USERNAME'
    );
  }
  return {
    environmentKind,
    host,
    port,
    database,
    user: username,
    password: env.PAH_HOST_BASELINE_DB_PASSWORD || '',
    sourceRepository: env.PAH_HOST_BASELINE_SOURCE_REPOSITORY,
    confirmation: env.PAH_HOST_BASELINE_CONFIRMATION,
  };
}

function createClient(config) {
  return new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionTimeoutMillis: 5000,
  });
}

async function assertServerIdentity(client, manifest, config) {
  const result = await client.query(
    'SELECT current_database() AS "databaseName", host(inet_server_addr()) AS "serverAddress", current_setting(\'server_version_num\')::integer AS "serverVersionNum"'
  );
  const identity = result.rows[0];
  if (identity.databaseName !== config.database) {
    throw new BaselineError(
      'DATABASE_IDENTITY_MISMATCH',
      '实际数据库与目标不一致'
    );
  }
  const major = Math.floor(identity.serverVersionNum / 10000);
  if (major !== manifest.policy.postgresMajor) {
    throw new BaselineError(
      'POSTGRES_VERSION_MISMATCH',
      `只允许 PostgreSQL ${manifest.policy.postgresMajor}`
    );
  }
  if (
    !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(identity.serverAddress)
  ) {
    throw new BaselineError(
      'SERVER_NOT_LOOPBACK',
      '实际 PostgreSQL 不是 loopback'
    );
  }
  return { serverAddress: identity.serverAddress, postgresMajor: major };
}

async function readDataRelations(client) {
  const result = await client.query(
    `SELECT c.relname AS name, c.relkind AS kind
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      ORDER BY c.relkind, c.relname`
  );
  return result.rows;
}

async function readSchemaShape(client, requiredRelations) {
  const columns = (
    await client.query(
      `SELECT table_name AS "tableName",
              ordinal_position AS "ordinalPosition",
              column_name AS "columnName",
              data_type AS "dataType",
              udt_name AS "udtName",
              is_nullable AS "isNullable",
              COALESCE(column_default, '') AS "columnDefault",
              COALESCE(character_maximum_length::text, '') AS "characterMaximumLength",
              COALESCE(numeric_precision::text, '') AS "numericPrecision",
              COALESCE(numeric_scale::text, '') AS "numericScale"
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
        ORDER BY table_name, ordinal_position`,
      [requiredRelations]
    )
  ).rows;
  const indexes = (
    await client.query(
      `SELECT tablename AS "tableName",
              indexname AS "indexName",
              regexp_replace(indexdef, '\\s+', ' ', 'g') AS definition
         FROM pg_catalog.pg_indexes
        WHERE schemaname = 'public'
          AND tablename = ANY($1::text[])
        ORDER BY tablename, indexname`,
      [requiredRelations]
    )
  ).rows;
  const constraints = (
    await client.query(
      `SELECT conrelid::regclass::text AS "tableName",
              conname AS "constraintName",
              contype AS "constraintType",
              pg_get_constraintdef(oid, true) AS definition
         FROM pg_catalog.pg_constraint
        WHERE connamespace = 'public'::regnamespace
          AND conrelid::regclass::text = ANY($1::text[])
        ORDER BY conrelid::regclass::text, conname`,
      [requiredRelations]
    )
  ).rows;
  const sequences = (
    await client.query(
      `SELECT c.relname AS name
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'S'
        ORDER BY c.relname`
    )
  ).rows.map(row => row.name);
  const value = { columns, indexes, constraints, sequences };
  return {
    counts: {
      columns: columns.length,
      indexes: indexes.length,
      constraints: constraints.length,
      sequences: sequences.length,
    },
    sha256: sha256(stableJson(value)),
  };
}

function expectedShapeMatches(manifest, shape) {
  return (
    shape.sha256 === manifest.expectedSchema.sha256 &&
    Object.entries(shape.counts).every(
      ([key, value]) => manifest.expectedSchema[key] === value
    )
  );
}

async function classifyDatabase(client, manifest) {
  const relations = await readDataRelations(client);
  if (relations.length === 0) return { state: 'empty', relations: [] };
  const tables = relations
    .filter(relation => relation.kind === 'r' || relation.kind === 'p')
    .map(relation => relation.name)
    .sort();
  const nonTableRelations = relations.filter(
    relation => !['r', 'p', 'S'].includes(relation.kind)
  );
  if (
    stableJson(tables) !== stableJson(manifest.requiredRelations) ||
    nonTableRelations.length > 0
  ) {
    return { state: 'nonempty-unknown', relations };
  }
  const shape = await readSchemaShape(client, manifest.requiredRelations);
  if (!expectedShapeMatches(manifest, shape)) {
    return { state: 'schema-mismatch', relations, shape };
  }
  return { state: 'baseline-ready', relations, shape };
}

function schemaConfirmation(manifest, database) {
  return `apply-host-baseline:${database}:v${
    manifest.version
  }:${manifest.expectedSchema.sha256.slice(0, 12)}`;
}

function adminInput(env = process.env) {
  const username = env.PAH_HOST_BASELINE_ADMIN_USERNAME;
  const password = env.PAH_HOST_BASELINE_ADMIN_PASSWORD;
  if (
    !username ||
    username.length > 20 ||
    !/^[A-Za-z0-9._@-]+$/u.test(username)
  ) {
    throw new BaselineError(
      'ADMIN_USERNAME_REQUIRED',
      '验收管理员用户名缺失或不合法，长度必须为 1 至 20 个字符'
    );
  }
  if (!password || password.length < 12 || password.length > 20) {
    throw new BaselineError(
      'ADMIN_PASSWORD_REQUIRED',
      '验收管理员一次性密码必须为 12 至 20 个字符'
    );
  }
  return { username, password };
}

function resetAdminInput(env = process.env) {
  const currentUsername = env.PAH_HOST_BASELINE_ADMIN_CURRENT_USERNAME;
  const newUsername = env.PAH_HOST_BASELINE_ADMIN_NEW_USERNAME;
  const newPassword = env.PAH_HOST_BASELINE_ADMIN_NEW_PASSWORD;
  for (const [value, label, maxLength] of [
    [currentUsername, '当前用户名', 100],
    [newUsername, '新用户名', 20],
  ]) {
    if (
      !value ||
      value.length > maxLength ||
      !/^[A-Za-z0-9._@-]+$/u.test(value)
    ) {
      throw new BaselineError(
        'ADMIN_RESET_USERNAME_REQUIRED',
        `${label}缺失或不合法，长度必须为 1 至 ${maxLength} 个字符`
      );
    }
  }
  if (currentUsername === newUsername) {
    throw new BaselineError(
      'ADMIN_RESET_USERNAME_UNCHANGED',
      '当前用户名与新用户名必须不同，以保留一次性重置守卫'
    );
  }
  if (!newPassword || newPassword.length < 12 || newPassword.length > 20) {
    throw new BaselineError(
      'ADMIN_RESET_PASSWORD_REQUIRED',
      '验收管理员新密码必须为 12 至 20 个字符'
    );
  }
  return { currentUsername, newUsername, newPassword };
}

function adminConfirmation(manifest, database, username) {
  return `seed-release-validation-admin:${database}:v${
    manifest.version
  }:${sha256(username).slice(0, 12)}`;
}

function adminResetConfirmation(manifest, database, reset) {
  return `reset-release-validation-admin:${database}:v${manifest.version}:${sha256(
    reset.currentUsername
  ).slice(0, 12)}:${sha256(reset.newUsername).slice(0, 12)}:${sha256(
    reset.newPassword
  ).slice(0, 12)}`;
}

async function tableRowsAreEmpty(client, requiredRelations) {
  for (const relation of requiredRelations) {
    const result = await client.query(
      `SELECT EXISTS (SELECT 1 FROM "${relation}" LIMIT 1) AS "hasRows"`
    );
    if (result.rows[0].hasRows) return false;
  }
  return true;
}

async function pluginLedgerSummary(client) {
  const result = await client.query(
    `SELECT
       (SELECT COUNT(*)::integer FROM plugin_info) AS "coolPluginInfo",
       (SELECT COUNT(*)::integer FROM pah_plugin_installation) AS "pluginInstallations",
       (SELECT COUNT(*)::integer FROM pah_plugin_migration_record) AS "pluginMigrations",
       (SELECT COUNT(*)::integer FROM pah_plugin_menu_contribution) AS "pluginMenuContributions",
       (SELECT COUNT(*)::integer FROM pah_plugin_role_grant) AS "pluginRoleGrants",
       (SELECT COUNT(*)::integer FROM pah_navigation_group) AS "navigationGroups",
       (SELECT COUNT(*)::integer FROM pah_navigation_group_assignment) AS "navigationAssignments",
       (SELECT COUNT(*)::integer FROM pah_dictionary_reconcile_record) AS "dictionaryReconciliations"`
  );
  return result.rows[0];
}

async function readAdminResetState(
  client,
  currentUsername,
  newUsername,
  lockUser = false
) {
  const user = await client.query(
    `SELECT id, username, password,
            "passwordV" AS "passwordVersion",
            "departmentId" AS "departmentId"
       FROM base_sys_user
      WHERE id = 1${lockUser ? ' FOR UPDATE' : ''}`
  );
  const relations = (
    await client.query(
      `SELECT
         (SELECT COUNT(*)::integer FROM base_sys_department) AS departments,
         (SELECT COUNT(*)::integer FROM base_sys_role) AS roles,
         (SELECT COUNT(*)::integer FROM base_sys_user) AS users,
         (SELECT COUNT(*)::integer FROM base_sys_user_role) AS "userRoles",
         (SELECT COUNT(*)::integer FROM base_sys_department WHERE id = 1) AS "departmentOne",
         (SELECT COUNT(*)::integer FROM base_sys_role WHERE id = 1) AS "roleOne",
         (SELECT COUNT(*)::integer FROM base_sys_user WHERE id = 1) AS "userOne",
         (SELECT COUNT(*)::integer
            FROM base_sys_user_role
           WHERE id = 1 AND "userId" = 1 AND "roleId" = 1) AS "userRoleOne"`
    )
  ).rows[0];
  const targetConflict = await client.query(
    'SELECT id FROM base_sys_user WHERE username = $1 AND id <> 1 LIMIT 1',
    [newUsername]
  );
  const pluginLedger = await pluginLedgerSummary(client);
  const adminUser = user.rows[0];
  const adminRelationsReady =
    user.rowCount === 1 &&
    Object.values(relations).every(count => count === 1) &&
    adminUser.departmentId === 1 &&
    Number.isInteger(adminUser.passwordVersion);
  return {
    user: adminUser,
    adminRelations: {
      departments: relations.departments,
      roles: relations.roles,
      users: relations.users,
      userRoles: relations.userRoles,
    },
    adminRelationsReady,
    currentUsernameMatches:
      user.rowCount === 1 && adminUser.username === currentUsername,
    targetUsernameAvailable: targetConflict.rowCount === 0,
    pluginLedger,
    pluginLedgerEmpty: Object.values(pluginLedger).every(value => value === 0),
  };
}

async function hostRowSummary(client, manifest) {
  const rows = {};
  for (const relation of manifest.requiredRelations) {
    const result = await client.query(
      `SELECT COUNT(*)::integer AS count FROM "${relation}"`
    );
    rows[relation] = result.rows[0].count;
  }
  return {
    allTablesEmpty: Object.values(rows).every(count => count === 0),
    rowCounts: rows,
  };
}

function publicPlan(manifest, config, identity, classification) {
  const empty = classification.state === 'empty';
  return {
    action: empty
      ? 'apply'
      : classification.state === 'baseline-ready'
      ? 'noop'
      : 'reject',
    baselineId: manifest.baselineId,
    baselineVersion: manifest.version,
    sourceCommit: manifest.sourceCommit,
    environmentKind: config.environmentKind,
    databaseName: config.database,
    serverAddress: identity.serverAddress,
    postgresMajor: identity.postgresMajor,
    databaseState: classification.state,
    requiredRelations: manifest.requiredRelations,
    schemaArtifacts: manifest.schemaArtifacts.map(artifact => ({
      id: artifact.id,
      path: artifact.path,
      size: artifact.size,
      sha256: artifact.sha256,
    })),
    expectedSchema: manifest.expectedSchema,
    backupRequired: false,
    backupReason:
      '仅允许精确空库；数据库本身是可回收的 release-validation 边界',
    cleanupResponsibility: manifest.policy.cleanupResponsibility,
    ...(empty
      ? { confirmation: schemaConfirmation(manifest, config.database) }
      : {}),
  };
}

async function withDatabase(manifest, config, callback) {
  const client = createClient(config);
  await client.connect();
  try {
    const identity = await assertServerIdentity(client, manifest, config);
    return await callback(client, identity);
  } finally {
    await client.end();
  }
}

async function plan(manifest, config) {
  return withDatabase(manifest, config, async (client, identity) => {
    const classification = await classifyDatabase(client, manifest);
    return publicPlan(manifest, config, identity, classification);
  });
}

async function applySchema(manifest, schemaContents, config) {
  const expectedConfirmation = schemaConfirmation(manifest, config.database);
  if (config.confirmation !== expectedConfirmation) {
    throw new BaselineError(
      'CONFIRMATION_REQUIRED',
      `确认文本必须为 ${expectedConfirmation}`
    );
  }
  return withDatabase(manifest, config, async (client, identity) => {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1), $2::integer)',
        [manifest.baselineId, manifest.version]
      );
      const before = await classifyDatabase(client, manifest);
      if (before.state === 'baseline-ready') {
        await client.query('COMMIT');
        return {
          ...publicPlan(manifest, config, identity, before),
          applied: false,
          idempotent: true,
        };
      }
      if (before.state !== 'empty') {
        throw new BaselineError(
          'DATABASE_NOT_EMPTY',
          '目标数据库不是精确空库，拒绝执行 Host baseline'
        );
      }
      for (const content of schemaContents) {
        await client.query(content.toString('utf8'));
      }
      const after = await classifyDatabase(client, manifest);
      if (after.state !== 'baseline-ready') {
        throw new BaselineError(
          'POST_APPLY_VERIFICATION_FAILED',
          'Host baseline 提交前结构指纹验证失败'
        );
      }
      const ledger = await pluginLedgerSummary(client);
      if (Object.values(ledger).some(value => value !== 0)) {
        throw new BaselineError(
          'PLUGIN_LEDGER_NOT_EMPTY',
          'Host baseline 不得安装或物化任何业务插件'
        );
      }
      await client.query('COMMIT');
      return {
        ...publicPlan(manifest, config, identity, after),
        action: 'apply',
        applied: true,
        idempotent: false,
        pluginLedger: ledger,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function seedAdminPlan(manifest, config, admin) {
  return withDatabase(manifest, config, async (client, identity) => {
    const classification = await classifyDatabase(client, manifest);
    const emptyRows =
      classification.state === 'baseline-ready' &&
      (await tableRowsAreEmpty(client, manifest.requiredRelations));
    return {
      action: emptyRows ? 'seed-admin' : 'reject',
      baselineId: manifest.baselineId,
      baselineVersion: manifest.version,
      sourceCommit: manifest.sourceCommit,
      environmentKind: config.environmentKind,
      databaseName: config.database,
      serverAddress: identity.serverAddress,
      postgresMajor: identity.postgresMajor,
      databaseState: classification.state,
      allHostTablesEmpty: emptyRows,
      adminSeedArtifact: {
        id: manifest.adminSeedArtifact.id,
        path: manifest.adminSeedArtifact.path,
        size: manifest.adminSeedArtifact.size,
        sha256: manifest.adminSeedArtifact.sha256,
      },
      usernameSha256: sha256(admin.username),
      confirmation: emptyRows
        ? adminConfirmation(manifest, config.database, admin.username)
        : undefined,
    };
  });
}

async function seedAdmin(manifest, config, admin) {
  const expectedConfirmation = adminConfirmation(
    manifest,
    config.database,
    admin.username
  );
  if (config.confirmation !== expectedConfirmation) {
    throw new BaselineError(
      'CONFIRMATION_REQUIRED',
      `确认文本必须为 ${expectedConfirmation}`
    );
  }
  const sql = verifiedFile(baselineRoot, manifest.adminSeedArtifact).toString(
    'utf8'
  );
  return withDatabase(manifest, config, async (client, identity) => {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1), $2::integer)',
        [`${manifest.baselineId}:admin-seed`, manifest.version]
      );
      const classification = await classifyDatabase(client, manifest);
      if (
        classification.state !== 'baseline-ready' ||
        !(await tableRowsAreEmpty(client, manifest.requiredRelations))
      ) {
        throw new BaselineError(
          'ADMIN_SEED_DENIED',
          '验收管理员只允许写入刚 bootstrap 且所有 Host 表为空的数据库'
        );
      }
      const passwordHash = createHash('md5')
        .update(admin.password)
        .digest('hex');
      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
      await client.query(sql, [admin.username, passwordHash, timestamp]);
      const user = await client.query(
        'SELECT id, username, status FROM base_sys_user WHERE id = 1'
      );
      const ledger = await pluginLedgerSummary(client);
      if (
        user.rowCount !== 1 ||
        user.rows[0].username !== admin.username ||
        user.rows[0].status !== 1 ||
        Object.values(ledger).some(value => value !== 0)
      ) {
        throw new BaselineError(
          'ADMIN_SEED_VERIFICATION_FAILED',
          '验收管理员提交前验证失败'
        );
      }
      await client.query('COMMIT');
      return {
        action: 'seed-admin',
        baselineId: manifest.baselineId,
        baselineVersion: manifest.version,
        sourceCommit: manifest.sourceCommit,
        environmentKind: config.environmentKind,
        databaseName: config.database,
        serverAddress: identity.serverAddress,
        postgresMajor: identity.postgresMajor,
        userId: 1,
        usernameSha256: sha256(admin.username),
        created: true,
        pluginLedger: ledger,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function resetAdminPlan(manifest, config, reset) {
  return withDatabase(manifest, config, async (client, identity) => {
    const classification = await classifyDatabase(client, manifest);
    const state =
      classification.state === 'baseline-ready'
        ? await readAdminResetState(
            client,
            reset.currentUsername,
            reset.newUsername
          )
        : undefined;
    const safeToReset =
      state?.adminRelationsReady === true &&
      state.currentUsernameMatches &&
      state.targetUsernameAvailable &&
      state.pluginLedgerEmpty;
    return {
      action: safeToReset ? 'reset-admin' : 'reject',
      baselineId: manifest.baselineId,
      baselineVersion: manifest.version,
      sourceCommit: manifest.sourceCommit,
      environmentKind: config.environmentKind,
      databaseName: config.database,
      serverAddress: identity.serverAddress,
      postgresMajor: identity.postgresMajor,
      databaseState: classification.state,
      adminRelations: state?.adminRelations,
      adminRelationsReady: state?.adminRelationsReady ?? false,
      currentUsernameMatches: state?.currentUsernameMatches ?? false,
      targetUsernameAvailable: state?.targetUsernameAvailable ?? false,
      pluginLedger: state?.pluginLedger,
      confirmation: safeToReset
        ? adminResetConfirmation(manifest, config.database, reset)
        : undefined,
    };
  });
}

async function resetAdmin(manifest, config, reset) {
  const expectedConfirmation = adminResetConfirmation(
    manifest,
    config.database,
    reset
  );
  if (config.confirmation !== expectedConfirmation) {
    throw new BaselineError(
      'CONFIRMATION_REQUIRED',
      `确认文本必须为 ${expectedConfirmation}`
    );
  }
  return withDatabase(manifest, config, async (client, identity) => {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1), $2::integer)',
        [`${manifest.baselineId}:admin-reset`, manifest.version]
      );
      const classification = await classifyDatabase(client, manifest);
      if (classification.state !== 'baseline-ready') {
        throw new BaselineError(
          'ADMIN_RESET_DENIED',
          '验收管理员重置只允许精确 baseline-ready 数据库'
        );
      }
      const before = await readAdminResetState(
        client,
        reset.currentUsername,
        reset.newUsername,
        true
      );
      if (
        !before.adminRelationsReady ||
        !before.currentUsernameMatches ||
        !before.targetUsernameAvailable ||
        !before.pluginLedgerEmpty
      ) {
        throw new BaselineError(
          'ADMIN_RESET_DENIED',
          '验收管理员当前身份、必要关系或插件台账不满足重置条件'
        );
      }
      const previousPasswordVersion = before.user.passwordVersion;
      const passwordHash = createHash('md5')
        .update(reset.newPassword)
        .digest('hex');
      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const updated = await client.query(
        `UPDATE base_sys_user
            SET username = $1,
                password = $2,
                "passwordV" = "passwordV" + 1,
                "updateTime" = $3
          WHERE id = 1
            AND username = $4
            AND "passwordV" = $5
        RETURNING id`,
        [
          reset.newUsername,
          passwordHash,
          timestamp,
          reset.currentUsername,
          previousPasswordVersion,
        ]
      );
      const after = await readAdminResetState(
        client,
        reset.newUsername,
        reset.currentUsername,
        true
      );
      if (
        updated.rowCount !== 1 ||
        !after.adminRelationsReady ||
        !after.currentUsernameMatches ||
        !after.targetUsernameAvailable ||
        !after.pluginLedgerEmpty ||
        after.user.password !== passwordHash ||
        after.user.passwordVersion !== previousPasswordVersion + 1
      ) {
        throw new BaselineError(
          'ADMIN_RESET_VERIFICATION_FAILED',
          '验收管理员重置提交前验证失败'
        );
      }
      await client.query('COMMIT');
      return {
        action: 'reset-admin',
        baselineId: manifest.baselineId,
        baselineVersion: manifest.version,
        sourceCommit: manifest.sourceCommit,
        environmentKind: config.environmentKind,
        databaseName: config.database,
        serverAddress: identity.serverAddress,
        postgresMajor: identity.postgresMajor,
        userId: 1,
        passwordVersion: after.user.passwordVersion,
        updated: true,
        adminRelations: after.adminRelations,
        pluginLedger: after.pluginLedger,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

function usage() {
  return {
    commands: [
      'plan',
      'apply',
      'verify',
      'seed-admin-plan',
      'seed-admin',
      'reset-admin-plan',
      'reset-admin',
    ],
    requiredEnvironment: [
      'PAH_HOST_BASELINE_ENVIRONMENT=release-validation',
      'PAH_HOST_BASELINE_DB_HOST=127.0.0.1',
      'PAH_HOST_BASELINE_DB_PORT=5432',
      'PAH_HOST_BASELINE_DB_USERNAME=<explicit>',
      'PAH_HOST_BASELINE_DB_DATABASE=<exact>',
      'PAH_HOST_BASELINE_ALLOWED_DATABASE=<same exact>',
      'PAH_HOST_BASELINE_SOURCE_REPOSITORY=<Git repo containing sourceCommit>',
      'PAH_HOST_BASELINE_ADMIN_CURRENT_USERNAME=<current-local-admin>',
      'PAH_HOST_BASELINE_ADMIN_NEW_USERNAME=<new-local-admin>',
    ],
    secretEnvironment: [
      'PAH_HOST_BASELINE_DB_PASSWORD',
      'PAH_HOST_BASELINE_ADMIN_PASSWORD',
      'PAH_HOST_BASELINE_ADMIN_NEW_PASSWORD',
    ],
  };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const command = normalizedArgv[0];
  if (!command || command === '--help' || command === 'help') return usage();
  const { manifest, schemaContents } = loadAndVerifyManifest();
  const config = readConfig(manifest, env);
  verifySourceRepository(manifest, config.sourceRepository);
  if (command === 'plan') return plan(manifest, config);
  if (command === 'apply') return applySchema(manifest, schemaContents, config);
  if (command === 'verify') {
    const result = await plan(manifest, config);
    if (result.databaseState !== 'baseline-ready') {
      throw new BaselineError('BASELINE_NOT_READY', 'Host baseline 尚未就绪');
    }
    return {
      ...result,
      pluginLedger: await withDatabase(manifest, config, client =>
        pluginLedgerSummary(client)
      ),
      hostRows: await withDatabase(manifest, config, client =>
        hostRowSummary(client, manifest)
      ),
    };
  }
  if (command === 'seed-admin-plan') {
    return seedAdminPlan(manifest, config, adminInput(env));
  }
  if (command === 'seed-admin') {
    return seedAdmin(manifest, config, adminInput(env));
  }
  if (command === 'reset-admin-plan') {
    return resetAdminPlan(manifest, config, resetAdminInput(env));
  }
  if (command === 'reset-admin') {
    return resetAdmin(manifest, config, resetAdminInput(env));
  }
  throw new BaselineError('UNKNOWN_COMMAND', `未知命令：${command}`);
}

if (require.main === module) {
  main()
    .then(result =>
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    )
    .catch(error => {
      const known = error instanceof BaselineError;
      process.stderr.write(
        `${JSON.stringify({
          ok: false,
          code: known ? error.code : 'HOST_BASELINE_FAILED',
          message: known ? error.message : 'Host baseline 操作失败',
        })}\n`
      );
      process.exitCode = 1;
    });
}

module.exports = {
  BaselineError,
  adminConfirmation,
  adminInput,
  adminResetConfirmation,
  classifyDatabase,
  expectedShapeMatches,
  extractCreatedRelations,
  loadAndVerifyManifest,
  main,
  readConfig,
  resetAdminInput,
  schemaConfirmation,
  sha256,
  verifySourceRepository,
};
