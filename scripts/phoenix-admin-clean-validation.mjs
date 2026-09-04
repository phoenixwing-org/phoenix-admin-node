#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const { Client } = pg;
const scriptPath = fileURLToPath(import.meta.url);
const scriptRoot = path.dirname(scriptPath);
const nodeRoot = path.resolve(scriptRoot, '..');
const managedChildren = new Set();
let shuttingDown = false;

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {
    vueRoot: path.resolve(nodeRoot, '../vue'),
    database: 'phoenix_admin_clean_validation',
    dbHost: '127.0.0.1',
    dbPort: 5432,
    dbUser: process.env.PAH_DB_USERNAME || process.env.USER || 'postgres',
    dbPassword: process.env.PAH_DB_PASSWORD || '',
    apiPort: 8201,
    webPort: 9100,
    skipBuild: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--skip-build') {
      options.skipBuild = true;
      continue;
    }
    const key = {
      '--vue-root': 'vueRoot',
      '--database': 'database',
      '--db-host': 'dbHost',
      '--db-port': 'dbPort',
      '--db-user': 'dbUser',
      '--api-port': 'apiPort',
      '--web-port': 'webPort',
    }[argument];
    if (!key || index + 1 >= argv.length) fail(`不支持的参数：${argument}`);
    const value = argv[index + 1];
    index += 1;
    if (['dbPort', 'apiPort', 'webPort'].includes(key)) {
      options[key] = Number(value);
    } else {
      options[key] = value;
    }
  }
  options.vueRoot = path.resolve(options.vueRoot);
  return options;
}

function assertOptions(options) {
  if (!/^[a-z][a-z0-9_]{2,62}$/u.test(options.database)) {
    fail('数据库名只允许 3～63 位小写字母、数字和下划线，并以字母开头');
  }
  if (['postgres', 'template0', 'template1', 'phoenix_admin'].includes(options.database)) {
    fail(`拒绝使用保留或默认数据库：${options.database}`);
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(options.dbHost)) {
    fail('干净验收脚本只允许本机 PostgreSQL；正式部署请使用同一 Cool 启动开关和受控平台编排');
  }
  for (const [label, port] of [
    ['PostgreSQL', options.dbPort],
    ['API', options.apiPort],
    ['Web', options.webPort],
  ]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`${label} 端口不合法`);
  }
  if (options.apiPort === options.webPort) fail('API 与 Web 端口不能相同');
}

function readPackage(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
}

function assertCleanHost(root, expectedName) {
  if (readPackage(root).name !== expectedName) fail(`${root} 不是 ${expectedName}`);
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  if (status.status !== 0 || status.stdout.trim()) fail(`${expectedName} worktree 必须 clean`);
  const modulesRoot = path.join(root, 'src', 'modules');
  const productLinks = fs.readdirSync(modulesRoot).filter(name => {
    const target = path.join(modulesRoot, name);
    return name.startsWith('phoenix-') && fs.lstatSync(target).isSymbolicLink();
  });
  if (productLinks.length) fail(`${expectedName} 含业务插件挂载：${productLinks.join(', ')}`);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.status !== 0) fail(`${command} ${args.join(' ')} 执行失败`);
}

function connection(options, database) {
  return {
    host: options.dbHost,
    port: options.dbPort,
    user: options.dbUser,
    password: options.dbPassword,
    database,
    connectionTimeoutMillis: 5_000,
  };
}

export function cleanValidationApiEnvironment(commonApiEnv, initialize) {
  const enabled = initialize ? 'true' : 'false';
  return {
    ...commonApiEnv,
    NODE_ENV: 'local',
    PAH_DEV_DISABLE_CAPTCHA: 'true',
    PAH_DB_SYNCHRONIZE: enabled,
    PAH_DB_INITIALIZE: enabled,
  };
}

function epsEntries(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  return Object.values(data).flatMap(value =>
    Array.isArray(value) ? value : [value]
  );
}

export function hasRequiredAdminEps(payload) {
  if (payload?.code !== 1000) return false;
  const baseOpen = epsEntries(payload.data).find(
    item => item?.prefix === '/admin/base/open'
  );
  const apiPaths = new Set(
    Array.isArray(baseOpen?.api) ? baseOpen.api.map(item => item?.path) : []
  );
  return apiPaths.has('/eps') && apiPaths.has('/login');
}

async function ensureDatabase(options) {
  const maintenance = new Client(connection(options, 'postgres'));
  await maintenance.connect();
  try {
    const existing = await maintenance.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      options.database,
    ]);
    if (!existing.rowCount) {
      await maintenance.query(`CREATE DATABASE "${options.database}"`);
      return 'created';
    }
    return 'existing';
  } finally {
    await maintenance.end();
  }
}

async function inspectDatabase(options) {
  const client = new Client(connection(options, options.database));
  await client.connect();
  try {
    const tableResult = await client.query(
      "SELECT COUNT(*)::integer AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
    );
    if (tableResult.rows[0].count === 0) return { state: 'empty' };
    const required = ['base_sys_user', 'base_sys_role', 'base_sys_menu', 'pah_plugin_installation'];
    const relationResult = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
      [required]
    );
    if (relationResult.rowCount !== required.length) return { state: 'foreign-or-partial' };
    const result = await client.query(`SELECT
      (SELECT COUNT(*)::integer FROM base_sys_user WHERE username = 'admin' AND status = 1) AS "admins",
      (SELECT COUNT(*)::integer FROM base_sys_role WHERE label = 'admin') AS "adminRoles",
      (SELECT COUNT(*)::integer FROM base_sys_menu) AS "menus",
      (SELECT COUNT(*)::integer FROM base_sys_menu WHERE router = '/' AND type = 1) AS "homes",
      (SELECT COUNT(*)::integer FROM pah_plugin_installation) AS "plugins",
      (SELECT COUNT(*)::integer FROM pah_plugin_migration_record) AS "migrations",
      (SELECT COUNT(*)::integer FROM pah_plugin_menu_contribution) AS "contributions"`);
    const row = result.rows[0];
    const ready = row.admins === 1 && row.adminRoles === 1 && row.menus > 0 && row.homes > 0 &&
      row.plugins === 0 && row.migrations === 0 && row.contributions === 0;
    return { state: ready ? 'ready' : 'foreign-or-partial', ...row };
  } finally {
    await client.end();
  }
}

function readPahHostSchema() {
  const schemaRoot = path.join(nodeRoot, 'src', 'modules', 'phoenix');
  const descriptorPath = path.join(schemaRoot, 'pah-host-schema.json');
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
  if (
    descriptor?.formatVersion !== 1 ||
    descriptor?.schemaId !== 'pah-host' ||
    !Number.isInteger(descriptor?.version) ||
    !Array.isArray(descriptor?.migrations)
  ) {
    fail('Pah Host schema 描述文件不合法');
  }
  const migrations = descriptor.migrations.map(migration => {
    if (
      !migration ||
      !Number.isInteger(migration.version) ||
      !/^schema\/[0-9a-z-]+\.sql$/u.test(migration.path || '') ||
      !/^sha256:[a-f0-9]{64}$/u.test(migration.checksum || '')
    ) {
      fail(`Pah Host schema 迁移声明不合法：${migration?.id || 'unknown'}`);
    }
    const absolutePath = path.resolve(schemaRoot, migration.path);
    if (!absolutePath.startsWith(`${path.resolve(schemaRoot, 'schema')}${path.sep}`)) {
      fail(`Pah Host schema 迁移路径越界：${migration.path}`);
    }
    const sql = fs.readFileSync(absolutePath, 'utf8');
    const checksum = `sha256:${createHash('sha256').update(sql).digest('hex')}`;
    if (checksum !== migration.checksum) {
      fail(`Pah Host schema 校验和不匹配：${migration.id}`);
    }
    return { ...migration, sql };
  });
  return { descriptor, migrations };
}

async function applyPahHostSchema(options) {
  const { descriptor, migrations } = readPahHostSchema();
  const client = new Client(connection(options, options.database));
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `phoenix-admin-clean-validation:${options.database}:pah-host-schema`,
    ]);
    for (const migration of migrations) {
      await client.query(migration.sql);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
  process.stdout.write(
    `Pah Host schema v${descriptor.version} 已等幂应用并校验（${migrations.length} 项）\n`
  );
}

function start(command, args, cwd, env) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    detached: true,
  });
  managedChildren.add(child);
  child.once('exit', () => managedChildren.delete(child));
  child.once('error', error => fail(`${command} 启动失败：${error.message}`));
  return child;
}

function startCleanValidationApi(commonApiEnv, initialize) {
  process.stdout.write(
    `[clean-validation] API phase=${initialize ? 'initialize' : 'runtime'} mode=local eps=enabled synchronize=${initialize} initialize=${initialize}\n`
  );
  return start(
    process.execPath,
    ['bootstrap.js'],
    nodeRoot,
    cleanValidationApiEnvironment(commonApiEnv, initialize)
  );
}

function stop(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

async function waitFor(predicate, description, timeout = 120_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  fail(`${description} 超时${lastError ? `：${lastError.message}` : ''}`);
}

async function waitForExit(child, timeout = 15_000) {
  if (!child?.pid) return;
  if (await waitForProcessGroupExit(child.pid, timeout)) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  if (!(await waitForProcessGroupExit(child.pid, 5_000))) {
    fail(`进程组 ${child.pid} 在 SIGKILL 后仍未退出`);
  }
}

function processGroupExists(groupId) {
  try {
    process.kill(-groupId, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForProcessGroupExit(groupId, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (!processGroupExists(groupId)) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return !processGroupExists(groupId);
}

async function waitForAdminEps(url) {
  return waitFor(async () => {
    const response = await fetch(url, { redirect: 'manual' });
    if (!response.ok) return undefined;
    const payload = await response.json();
    return hasRequiredAdminEps(payload) ? payload : undefined;
  }, `${url} 返回可用的 Admin EPS`);
}

async function waitForInitializedDatabase(options) {
  return waitFor(async () => {
    const current = await inspectDatabase(options);
    return current.state === 'ready' ? current : undefined;
  }, 'Cool db.json/menu.json 初始化');
}

async function stopInitializedApi(child, options) {
  stop(child);
  await waitForExit(child);
  return waitFor(async () => {
    const current = await inspectDatabase(options);
    return current.state === 'ready' ? current : undefined;
  }, 'Cool 初始化进程退出后的数据库稳定性复核', 30_000);
}

async function stopAllManagedChildren() {
  const children = [...managedChildren];
  for (const child of children) stop(child);
  await Promise.all(children.map(child => waitForExit(child)));
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`\n收到 ${signal}，停止干净验收服务…\n`);
  await stopAllManagedChildren();
  process.exit(0);
}

async function waitForHttp(url) {
  return waitFor(async () => {
    const response = await fetch(url, { redirect: 'manual' });
    return response.status >= 200 && response.status < 500;
  }, `${url} 就绪`);
}

/* c8 ignore start -- 以下为受控命令入口，纯函数由单元测试覆盖。 */
async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertOptions(options);
  assertCleanHost(nodeRoot, 'phoenix-admin-node');
  assertCleanHost(options.vueRoot, 'phoenix-admin-vue');
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  if (!options.skipBuild) {
    run('pnpm', ['run', 'build'], nodeRoot);
    run('pnpm', ['run', 'build'], options.vueRoot);
  }

  const databaseAction = await ensureDatabase(options);
  let state = await inspectDatabase(options);
  if (state.state === 'foreign-or-partial') {
    fail(`数据库 ${options.database} 不是空库或已验证的 Phoenix Admin 干净基线`);
  }

  const commonApiEnv = {
    PAH_SERVER_PORT: String(options.apiPort),
    PAH_DB_HOST: options.dbHost,
    PAH_DB_PORT: String(options.dbPort),
    PAH_DB_USERNAME: options.dbUser,
    PAH_DB_PASSWORD: options.dbPassword,
    PAH_DB_DATABASE: options.database,
  };

  if (state.state === 'empty') {
    process.stdout.write(`数据库 ${options.database} 为空，使用 Cool 原生初始化流程…\n`);
    const installer = startCleanValidationApi(commonApiEnv, true);
    await waitForHttp(`http://127.0.0.1:${options.apiPort}/index.html`);
    await waitForAdminEps(
      `http://127.0.0.1:${options.apiPort}/admin/base/open/eps`
    );
    await waitForInitializedDatabase(options);
    state = await stopInitializedApi(installer, options);
  }

  if (state.state !== 'ready') fail('Phoenix Admin 干净基线验证失败');
  // Cool 原生初始化负责基础表、默认 admin、角色和菜单；Pah Host schema
  // 只在初始化 API 完整 ready、进程组完全退出并复核数据库稳定后应用。
  // 正常运行阶段仍关闭 synchronize/initDB/initMenu，不在服务启动时隐式执行 DDL。
  await applyPahHostSchema(options);
  const api = startCleanValidationApi(commonApiEnv, false);
  await waitForHttp(`http://127.0.0.1:${options.apiPort}/index.html`);
  await waitForAdminEps(
    `http://127.0.0.1:${options.apiPort}/admin/base/open/eps`
  );

  const web = start(
    'pnpm',
    ['dev', '--host', '127.0.0.1', '--strictPort', '--port', String(options.webPort)],
    options.vueRoot,
    {
      PAH_API_TARGET: `http://127.0.0.1:${options.apiPort}`,
      VITE_PAH_API_TARGET: `http://127.0.0.1:${options.apiPort}`,
    }
  );
  await waitForHttp(`http://127.0.0.1:${options.webPort}/`);

  process.stdout.write(`\nPhoenix Admin 干净验收环境已就绪\n`);
  process.stdout.write(`Web: http://127.0.0.1:${options.webPort}/\n`);
  process.stdout.write(`API: http://127.0.0.1:${options.apiPort}/\n`);
  process.stdout.write('登录：admin / 123456\n');
  process.stdout.write(`数据库：${options.database}（${databaseAction}，业务插件 0）\n`);
  process.stdout.write('按 Ctrl+C 同时停止 Web 与 API；数据库保留供复验。\n');

  await new Promise((resolve, reject) => {
    api.once('exit', code => reject(new Error(`API 意外退出：${code}`)));
    web.once('exit', code => reject(new Error(`Web 意外退出：${code}`)));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch(error => {
    process.stderr.write(`干净验收启动失败：${error.message}\n`);
    process.exitCode = 1;
  });
}
/* c8 ignore stop */
