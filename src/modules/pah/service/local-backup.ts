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
  binDirectory?: string;
  pgDump: string;
  pgRestore: string;
  createDb: string;
  dropDb: string;
}

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
      await this.commandRunner(
        postgresTools.pgRestore,
        ['--list', backupPath],
        {
          cwd: nodeRoot,
          env: commandEnv,
        }
      );
      await this.commandRunner(
        postgresTools.createDb,
        [...connectionArgs, '--maintenance-db=postgres', restoreDatabase],
        { cwd: nodeRoot, env: commandEnv }
      );
      try {
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
    } catch (error) {
      await fs.rm(backupPath, { force: true });
      throw new CoolCommException(
        `本地可信备份或恢复演练失败：${
          error instanceof Error ? error.message : String(error)
        }`
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
        postgresBinDirectory: postgresTools.binDirectory,
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
    let serverMajor = Number(configuredServerMajor || 0);
    if (!Number.isInteger(serverMajor) || serverMajor <= 0) {
      const psql = process.env.PAH_PSQL_BIN || 'psql';
      const result = await this.commandRunner(
        psql,
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
      const serverVersionNumber = Number(String(result.stdout || '').trim());
      serverMajor = Math.floor(serverVersionNumber / 10000);
      if (!Number.isInteger(serverMajor) || serverMajor <= 0) {
        throw new CoolCommException('无法识别 PostgreSQL 服务端主版本');
      }
    }

    const configuredBinDirectory = process.env.PAH_POSTGRES_BIN?.trim();
    const candidates = [
      configuredBinDirectory,
      `/opt/homebrew/opt/postgresql@${serverMajor}/bin`,
      `/usr/local/opt/postgresql@${serverMajor}/bin`,
      `/Library/PostgreSQL/${serverMajor}/bin`,
    ].filter((item): item is string => Boolean(item));
    let binDirectory: string | undefined;
    for (const candidate of candidates) {
      try {
        await fs.access(path.join(candidate, 'pg_dump'));
        await fs.access(path.join(candidate, 'pg_restore'));
        await fs.access(path.join(candidate, 'createdb'));
        await fs.access(path.join(candidate, 'dropdb'));
        binDirectory = candidate;
        break;
      } catch {
        if (configuredBinDirectory === candidate) {
          throw new CoolCommException(
            `PAH_POSTGRES_BIN 缺少完整 PostgreSQL 工具链：${candidate}`
          );
        }
      }
    }
    const command = (name: string, configured?: string) =>
      configured || (binDirectory ? path.join(binDirectory, name) : name);
    return {
      serverMajor,
      binDirectory,
      pgDump: command('pg_dump', process.env.PAH_PG_DUMP_BIN),
      pgRestore: command('pg_restore', process.env.PAH_PG_RESTORE_BIN),
      createDb: command('createdb', process.env.PAH_CREATEDB_BIN),
      dropDb: command('dropdb', process.env.PAH_DROPDB_BIN),
    };
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
