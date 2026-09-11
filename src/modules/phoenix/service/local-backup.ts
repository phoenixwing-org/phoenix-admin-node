import { CoolCommException } from '@cool-midway/core';
import { Init, Inject, Provide, Scope, ScopeEnum } from '@midwayjs/core';
import { execFile } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import {
  PahMigrationBackupContext,
  PahMigrationBackupGate,
  PahMigrationBackupProof,
} from './migration';

const execFileAsync = promisify(execFile);
const LOCAL_BACKUP_MAX_AGE_MS = 60 * 60 * 1000;
const LOCAL_BACKUP_FILE_MODE = 0o600;

interface LocalBackupRecord {
  proof: PahMigrationBackupProof;
  backupPath: string;
  sha256: string;
  size: number;
  restoreVerifiedAt: string;
}

interface DatabaseConnection {
  host: string;
  port: string;
  username: string;
  password: string;
  database: string;
}

interface PostgresTools {
  serverMajor: number;
  source:
    | 'configured-bin'
    | 'individual-command'
    | 'versioned-installation'
    | 'PATH';
  psql: string;
  pgDump: string;
  pgRestore: string;
  createDb: string;
  dropDb: string;
}

type PostgresToolName =
  | 'psql'
  | 'pg_dump'
  | 'pg_restore'
  | 'createdb'
  | 'dropdb';

const POSTGRES_TOOL_ENV: Record<PostgresToolName, string> = {
  psql: 'PAH_PSQL_BIN',
  pg_dump: 'PAH_PG_DUMP_BIN',
  pg_restore: 'PAH_PG_RESTORE_BIN',
  createdb: 'PAH_CREATEDB_BIN',
  dropdb: 'PAH_DROPDB_BIN',
};

const POSTGRES_TOOL_NAMES = Object.keys(
  POSTGRES_TOOL_ENV
) as PostgresToolName[];

function sha256(content: Buffer) {
  return createHash('sha256').update(content).digest('hex');
}

function safeModuleId(value: string) {
  if (!/^[a-z][a-z0-9-]*$/.test(value)) {
    throw new CoolCommException(`插件 moduleId 不安全：${value}`);
  }
  return value;
}

/**
 * 本地干净安装验收使用的 PostgreSQL 备份与恢复演练器。
 *
 * 生产环境安全失败；浏览器不能提交路径、数据库名、planId 或备份证明。
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class PahLocalPluginBackupService {
  @Inject()
  backupGate: PahMigrationBackupGate;

  private readonly records = new Map<string, LocalBackupRecord>();

  platform: NodeJS.Platform = process.platform;

  commandRunner = async (
    command: string,
    args: string[],
    options: { cwd?: string; env: NodeJS.ProcessEnv }
  ) => execFileAsync(command, args, options);

  @Init()
  init() {
    this.backupGate.registerVerifier(this.verifyProof);
  }

  async createVerifiedBackup(moduleId: string, pluginVersion: string) {
    const connection = this.localDatabaseConnection();
    const normalizedModuleId = safeModuleId(moduleId);
    const createdAt = new Date().toISOString();
    const backupId = `pah-local-${normalizedModuleId}-${Date.now()}-${randomUUID()}`;
    const nodeRoot = path.resolve(
      process.env.PHOENIX_ADMIN_NODE_ROOT || process.cwd()
    );
    const backupDir = path.resolve(
      process.env.PAH_LOCAL_PLUGIN_BACKUP_DIR ||
        path.join(nodeRoot, '.runtime/backups/pah-local')
    );
    await fs.mkdir(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `${backupId}.dump`);
    const restoreDatabase = `pah_restore_${randomUUID().replace(/-/g, '')}`;
    const commandEnv = {
      ...process.env,
      ...(connection.password ? { PGPASSWORD: connection.password } : {}),
    };
    const connectionArgs = [
      '--host',
      connection.host,
      '--port',
      connection.port,
      '--username',
      connection.username,
    ];
    const postgresTools = await this.resolvePostgresTools(
      connection,
      connectionArgs,
      nodeRoot,
      commandEnv
    );

    try {
      await fs.writeFile(backupPath, Buffer.alloc(0), {
        flag: 'wx',
        mode: LOCAL_BACKUP_FILE_MODE,
      });
    } catch {
      throw new CoolCommException(
        '无法以 0600 排他创建本地备份文件；未执行备份'
      );
    }

    let stage = '创建 PostgreSQL 自定义格式备份';
    try {
      await this.commandRunner(
        postgresTools.pgDump,
        [
          ...connectionArgs,
          '--format=custom',
          '--no-owner',
          '--no-privileges',
          '--file',
          backupPath,
          connection.database,
        ],
        { cwd: nodeRoot, env: commandEnv }
      );
      stage = '收紧本地备份文件权限';
      await fs.chmod(backupPath, LOCAL_BACKUP_FILE_MODE);
      const backupStat = await fs.stat(backupPath);
      if (
        !backupStat.isFile() ||
        (backupStat.mode & 0o777) !== LOCAL_BACKUP_FILE_MODE
      ) {
        throw new Error('backup file mode is not 0600');
      }
      stage = '校验 PostgreSQL 备份目录';
      await this.commandRunner(
        postgresTools.pgRestore,
        ['--list', backupPath],
        {
          cwd: nodeRoot,
          env: commandEnv,
        }
      );
      stage = '创建临时恢复数据库';
      await this.commandRunner(
        postgresTools.createDb,
        [...connectionArgs, '--maintenance-db=postgres', restoreDatabase],
        { cwd: nodeRoot, env: commandEnv }
      );
      try {
        stage = '执行临时数据库恢复演练';
        await this.commandRunner(
          postgresTools.pgRestore,
          [
            ...connectionArgs,
            '--exit-on-error',
            '--no-owner',
            '--no-privileges',
            '--dbname',
            restoreDatabase,
            backupPath,
          ],
          { cwd: nodeRoot, env: commandEnv }
        );
      } finally {
        stage = '清理临时恢复数据库';
        await this.commandRunner(
          postgresTools.dropDb,
          [
            ...connectionArgs,
            '--maintenance-db=postgres',
            '--if-exists',
            restoreDatabase,
          ],
          { cwd: nodeRoot, env: commandEnv }
        );
      }
    } catch {
      await fs.rm(backupPath, { force: true });
      throw new CoolCommException(
        `本地可信备份或恢复演练失败（${stage}）；请检查 PostgreSQL 服务、权限和磁盘空间，未保留无效备份`
      );
    }

    const content = await fs.readFile(backupPath);
    if (!content.length) {
      await fs.rm(backupPath, { force: true });
      throw new CoolCommException('本地可信备份为空文件');
    }
    const proof: PahMigrationBackupProof = {
      backupId,
      moduleId: normalizedModuleId,
      pluginVersion,
      dataSourceName: 'default',
      createdAt,
      restoreProcedure: `pg_restore custom-format backup ${backupId}`,
    };
    const record: LocalBackupRecord = {
      proof,
      backupPath,
      sha256: sha256(content),
      size: content.length,
      restoreVerifiedAt: new Date().toISOString(),
    };
    this.records.set(backupId, record);
    return {
      proof,
      backup: {
        backupId,
        sha256: record.sha256,
        size: record.size,
        createdAt,
        restoreVerifiedAt: record.restoreVerifiedAt,
        postgresMajor: postgresTools.serverMajor,
        postgresToolSource: postgresTools.source,
      },
    };
  }

  latestProof(moduleId: string, pluginVersion: string) {
    const records = [...this.records.values()]
      .filter(
        item =>
          item.proof.moduleId === moduleId &&
          item.proof.pluginVersion === pluginVersion &&
          Date.now() - Date.parse(item.proof.createdAt) <=
            LOCAL_BACKUP_MAX_AGE_MS
      )
      .sort(
        (left, right) =>
          Date.parse(right.proof.createdAt) - Date.parse(left.proof.createdAt)
      );
    if (!records.length) {
      throw new CoolCommException('请先创建并验证当前插件版本的可信备份');
    }
    return records[0].proof;
  }

  private readonly verifyProof = async (
    proof: PahMigrationBackupProof,
    context: PahMigrationBackupContext
  ) => {
    const record = this.records.get(proof.backupId);
    if (
      !record ||
      JSON.stringify(record.proof) !== JSON.stringify(proof) ||
      proof.moduleId !== context.moduleId ||
      proof.pluginVersion !== context.pluginVersion ||
      Date.now() - Date.parse(proof.createdAt) > LOCAL_BACKUP_MAX_AGE_MS
    ) {
      throw new CoolCommException('本地备份证明不存在、已过期或绑定不匹配');
    }
    const content = await fs.readFile(record.backupPath);
    if (content.length !== record.size || sha256(content) !== record.sha256) {
      throw new CoolCommException('本地备份文件完整性校验失败');
    }
  };

  private async resolvePostgresTools(
    connection: DatabaseConnection,
    connectionArgs: string[],
    cwd: string,
    env: NodeJS.ProcessEnv
  ): Promise<PostgresTools> {
    const configuredServerMajor = process.env.PAH_POSTGRES_SERVER_MAJOR?.trim();
    const expectedServerMajor = configuredServerMajor
      ? Number(configuredServerMajor)
      : undefined;
    if (
      expectedServerMajor !== undefined &&
      (!Number.isInteger(expectedServerMajor) || expectedServerMajor <= 0)
    ) {
      throw new CoolCommException(
        'PostgreSQL CLI 前置检查失败：PAH_POSTGRES_SERVER_MAJOR 必须是正整数；未执行备份'
      );
    }

    const configuredBinDirectory = process.env.PAH_POSTGRES_BIN?.trim();
    if (configuredBinDirectory && !path.isAbsolute(configuredBinDirectory)) {
      throw new CoolCommException(
        'PostgreSQL CLI 前置检查失败：PAH_POSTGRES_BIN 必须是绝对路径；未执行备份'
      );
    }
    if (configuredBinDirectory) {
      const missingTools = await this.missingTools(configuredBinDirectory);
      if (missingTools.length) {
        throw new CoolCommException(
          `PostgreSQL CLI 前置检查失败：PAH_POSTGRES_BIN 缺少 ${missingTools.join(
            '、'
          )}；未执行备份`
        );
      }
    }

    const initialPsql =
      process.env.PAH_PSQL_BIN?.trim() ||
      (configuredBinDirectory
        ? path.join(configuredBinDirectory, this.executableName('psql'))
        : this.executableName('psql'));
    const versionCache = new Map<string, number>();
    await this.postgresCliMajor('psql', initialPsql, cwd, env, versionCache);

    let serverVersionResult: Awaited<
      ReturnType<PahLocalPluginBackupService['commandRunner']>
    >;
    try {
      serverVersionResult = await this.commandRunner(
        initialPsql,
        [
          ...connectionArgs,
          '--dbname',
          connection.database,
          '--tuples-only',
          '--no-align',
          '--command',
          'SHOW server_version_num',
        ],
        { cwd, env }
      );
    } catch {
      throw new CoolCommException(
        'PostgreSQL CLI 前置检查失败：psql 无法连接并读取服务端版本；请检查数据库连接参数与权限，未执行备份'
      );
    }
    const serverVersionNumber = Number(
      String(serverVersionResult.stdout || '').trim()
    );
    const serverMajor = Math.floor(serverVersionNumber / 10000);
    if (!Number.isInteger(serverMajor) || serverMajor <= 0) {
      throw new CoolCommException(
        'PostgreSQL CLI 前置检查失败：无法识别 PostgreSQL 服务端主版本；未执行备份'
      );
    }
    if (
      expectedServerMajor !== undefined &&
      expectedServerMajor !== serverMajor
    ) {
      throw new CoolCommException(
        `PostgreSQL CLI 前置检查失败：配置的服务端主版本 ${expectedServerMajor} 与实际版本 ${serverMajor} 不一致；未执行备份`
      );
    }

    const candidates = [
      `/opt/homebrew/opt/postgresql@${serverMajor}/bin`,
      `/usr/local/opt/postgresql@${serverMajor}/bin`,
      `/Library/PostgreSQL/${serverMajor}/bin`,
    ];
    let binDirectory: string | undefined;
    if (configuredBinDirectory) {
      binDirectory = configuredBinDirectory;
    } else if (this.platform !== 'win32') {
      for (const candidate of candidates) {
        if (!(await this.missingTools(candidate)).length) {
          binDirectory = candidate;
          break;
        }
      }
    }
    const configuredCommands = POSTGRES_TOOL_NAMES.filter(name =>
      Boolean(process.env[POSTGRES_TOOL_ENV[name]]?.trim())
    );
    const command = (name: PostgresToolName) =>
      process.env[POSTGRES_TOOL_ENV[name]]?.trim() ||
      (binDirectory
        ? path.join(binDirectory, this.executableName(name))
        : this.executableName(name));
    const commands = Object.fromEntries(
      POSTGRES_TOOL_NAMES.map(name => [name, command(name)])
    ) as Record<PostgresToolName, string>;

    for (const name of POSTGRES_TOOL_NAMES) {
      const clientMajor = await this.postgresCliMajor(
        name,
        commands[name],
        cwd,
        env,
        versionCache
      );
      if (clientMajor !== serverMajor) {
        throw new CoolCommException(
          `PostgreSQL CLI 前置检查失败：${name} 主版本 ${clientMajor} 与服务端主版本 ${serverMajor} 不一致；未执行备份`
        );
      }
    }
    return {
      serverMajor,
      source: configuredCommands.length
        ? 'individual-command'
        : configuredBinDirectory
        ? 'configured-bin'
        : binDirectory
        ? 'versioned-installation'
        : 'PATH',
      psql: commands.psql,
      pgDump: commands.pg_dump,
      pgRestore: commands.pg_restore,
      createDb: commands.createdb,
      dropDb: commands.dropdb,
    };
  }

  private executableName(name: PostgresToolName) {
    return this.platform === 'win32' ? `${name}.exe` : name;
  }

  private async missingTools(binDirectory: string) {
    const missingTools: PostgresToolName[] = [];
    for (const name of POSTGRES_TOOL_NAMES) {
      try {
        await fs.access(path.join(binDirectory, this.executableName(name)));
      } catch {
        missingTools.push(name);
      }
    }
    return missingTools;
  }

  private async postgresCliMajor(
    name: PostgresToolName,
    command: string,
    cwd: string,
    env: NodeJS.ProcessEnv,
    cache: Map<string, number>
  ) {
    const cached = cache.get(command);
    if (cached) return cached;
    let result: Awaited<
      ReturnType<PahLocalPluginBackupService['commandRunner']>
    >;
    try {
      result = await this.commandRunner(command, ['--version'], { cwd, env });
    } catch {
      throw new CoolCommException(
        `PostgreSQL CLI 前置检查失败：${name} 不可用；Windows 请设置 PAH_POSTGRES_BIN 为 PostgreSQL 安装目录下的 bin，或设置 ${POSTGRES_TOOL_ENV[name]}；未执行备份`
      );
    }
    const output = `${String(result.stdout || '')} ${String(
      result.stderr || ''
    )}`;
    const match = output.match(/\b(\d+)(?:\.\d+)?\b/u);
    const major = match ? Number(match[1]) : 0;
    if (!Number.isInteger(major) || major <= 0) {
      throw new CoolCommException(
        `PostgreSQL CLI 前置检查失败：无法识别 ${name} 的版本；未执行备份`
      );
    }
    cache.set(command, major);
    return major;
  }

  private localDatabaseConnection(): DatabaseConnection {
    if (process.env.NODE_ENV === 'production') {
      throw new CoolCommException('正式环境禁止使用本地插件备份编排');
    }
    if (
      process.env.PAH_DB_SYNCHRONIZE !== 'false' ||
      process.env.PAH_DB_INITIALIZE !== 'false'
    ) {
      throw new CoolCommException(
        '本地插件安装要求 PAH_DB_SYNCHRONIZE=false 且 PAH_DB_INITIALIZE=false'
      );
    }
    const database = process.env.PAH_DB_DATABASE?.trim();
    if (!database || database === 'phoenix_admin') {
      throw new CoolCommException('必须显式指定非默认的本地插件验证数据库');
    }
    return {
      host: process.env.PAH_DB_HOST || '127.0.0.1',
      port: process.env.PAH_DB_PORT || '5432',
      username: process.env.PAH_DB_USERNAME || process.env.USER || 'postgres',
      password: process.env.PAH_DB_PASSWORD || '',
      database,
    };
  }
}
