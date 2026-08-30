import { BaseService, CoolCommException } from '@cool-midway/core';
import {
  IMidwayApplication,
  Inject,
  MainApp,
  Provide,
  Scope,
  ScopeEnum,
} from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Equal, Repository } from 'typeorm';
import { TextDecoder } from 'util';
import { PahPluginMigrationRecordEntity } from '../entity/migration-record';
import { PahPluginInstallationEntity } from '../entity/plugin';
import {
  PahPluginManifest,
  PahPluginMigrationDeclaration,
} from '../interface/plugin';

const MAX_SQL_ARTIFACT_BYTES = 1024 * 1024;
const MIGRATION_PLAN_TTL_MS = 15 * 60 * 1000;
export const PAH_COMPILED_PLUGIN_DESCRIPTOR = 'pah-plugin.artifacts.json';
export const PAH_COMPILED_PLUGIN_DESCRIPTOR_VERSION = 1 as const;

export interface PahCompiledPluginRuntimeArtifact {
  id: string;
  runtime: 'node';
  format: 'commonjs';
  /** 相对插件编译根目录的安全 POSIX 路径；构建时按原路径复制。 */
  path: string;
  size: number;
  sha256: string;
}

export interface PahCompiledPluginDescriptor {
  formatVersion: typeof PAH_COMPILED_PLUGIN_DESCRIPTOR_VERSION;
  moduleId: string;
  version: string;
  /** 可选的插件自包含 Node 运行时制品；由 Host 构建装配器严格校验。 */
  runtimeArtifacts?: PahCompiledPluginRuntimeArtifact[];
}

export interface PahCompiledPluginRegistration {
  moduleId: string;
  version: string;
  /** 编译期插件包根目录；manifest 的 migrations/* 路径相对此目录。 */
  rootDir: string;
}

export interface PahMigrationBackupProof {
  backupId: string;
  moduleId: string;
  pluginVersion: string;
  dataSourceName: 'default';
  createdAt: string;
  restoreProcedure: string;
}

export interface PahMigrationBackupContext {
  moduleId: string;
  pluginVersion: string;
  dataSourceName: 'default';
  migrations: Array<{ id: string; version: number; checksum: string }>;
}

export type PahMigrationBackupVerifier = (
  proof: PahMigrationBackupProof,
  context: PahMigrationBackupContext
) => Promise<void>;

export interface PahMigrationDryRunItem {
  id: string;
  version: number;
  checksum: string;
  description: string;
  artifactPath: string;
  state: 'pending' | 'applied';
}

export interface PahMigrationDryRunPlan {
  dryRun: true;
  planId: string;
  expiresAt: string;
  moduleId: string;
  pluginVersion: string;
  artifactsVerified: true;
  transaction: 'required';
  backupRequired: boolean;
  items: PahMigrationDryRunItem[];
}

export interface PahPreparedMigrationItem {
  declaration: PahPluginMigrationDeclaration;
  sql: string;
}

export interface PahPreparedMigrationPlan {
  moduleId: string;
  pluginVersion: string;
  manifestSignature: string;
  appliedSignature?: string;
  backupRequired?: boolean;
  backupProof?: PahMigrationBackupProof;
  items: PahPreparedMigrationItem[];
}

interface PahStoredMigrationPlan {
  prepared: PahPreparedMigrationPlan;
  expiresAt: number;
}

/**
 * 受控构建产物注册表。
 *
 * 只有随 Host 编译并在进程内启动的模块可以登记根目录；HTTP API 不接收路径。
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class PahCompiledPluginRegistry {
  private readonly registrations = new Map<
    string,
    PahCompiledPluginRegistration
  >();

  @MainApp()
  app: IMidwayApplication;

  /** @internal 仅供 Host 通用装配器与测试使用；插件消费者使用 descriptor。 */
  register(registration: PahCompiledPluginRegistration) {
    if (!/^[a-z][a-z0-9-]*$/.test(registration.moduleId)) {
      throw new CoolCommException('编译期插件 moduleId 不合法');
    }
    if (!registration.version?.trim()) {
      throw new CoolCommException('编译期插件缺少版本');
    }
    if (!path.isAbsolute(registration.rootDir)) {
      throw new CoolCommException('编译期插件根目录必须是绝对路径');
    }

    const existing = this.registrations.get(registration.moduleId);
    if (
      existing &&
      (existing.version !== registration.version ||
        path.resolve(existing.rootDir) !== path.resolve(registration.rootDir))
    ) {
      throw new CoolCommException(
        `编译期插件重复登记且内容冲突：${registration.moduleId}`
      );
    }
    this.registrations.set(registration.moduleId, {
      ...registration,
      rootDir: path.resolve(registration.rootDir),
    });
  }

  async require(moduleId: string, version: string) {
    let registration = this.registrations.get(moduleId);
    if (!registration) {
      registration = await this.discover(moduleId);
    }
    if (!registration || registration.version !== version) {
      throw new CoolCommException(
        `插件 ${moduleId}@${version} 尚未登记受控构建制品`
      );
    }
    return registration;
  }

  private async discover(moduleId: string) {
    if (!/^[a-z][a-z0-9-]*$/.test(moduleId) || !this.app) return undefined;
    const baseDir = path.resolve(this.app.getBaseDir());
    const parentDir = path.dirname(baseDir);
    const compiledRoots = [
      path.join(baseDir, 'modules'),
      path.join(baseDir, 'dist', 'modules'),
      path.join(parentDir, 'dist', 'modules'),
    ];
    const developmentRoots = [
      path.join(baseDir, 'src', 'modules'),
      path.join(parentDir, 'src', 'modules'),
    ];
    const moduleRoots = [
      ...(process.env.NODE_ENV === 'production' ? [] : developmentRoots),
      ...compiledRoots,
    ];

    for (const modulesRoot of [...new Set(moduleRoots)]) {
      const rootDir = path.join(modulesRoot, moduleId);
      const descriptorPath = path.join(rootDir, PAH_COMPILED_PLUGIN_DESCRIPTOR);
      let descriptor: PahCompiledPluginDescriptor;
      try {
        descriptor = JSON.parse(await fs.readFile(descriptorPath, 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw new CoolCommException(`插件 ${moduleId} 的编译制品描述符无效`);
      }
      if (
        descriptor.formatVersion !== PAH_COMPILED_PLUGIN_DESCRIPTOR_VERSION ||
        descriptor.moduleId !== moduleId ||
        !descriptor.version?.trim()
      ) {
        throw new CoolCommException(`插件 ${moduleId} 的编译制品描述符不匹配`);
      }
      this.register({ moduleId, version: descriptor.version, rootDir });
      return this.registrations.get(moduleId);
    }
    return undefined;
  }
}

/**
 * 备份证明验证扩展点。默认没有验证器，因此生产 DDL 安全失败。
 * 可信备份模块必须在进程内登记验证器；控制器不暴露登记接口。
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class PahMigrationBackupGate {
  private verifier?: PahMigrationBackupVerifier;

  registerVerifier(verifier: PahMigrationBackupVerifier) {
    if (this.verifier && this.verifier !== verifier) {
      throw new CoolCommException('迁移备份验证器已登记');
    }
    this.verifier = verifier;
  }

  async verify(
    proof: PahMigrationBackupProof,
    context: PahMigrationBackupContext
  ) {
    if (
      proof.moduleId !== context.moduleId ||
      proof.pluginVersion !== context.pluginVersion ||
      proof.dataSourceName !== context.dataSourceName ||
      !proof.backupId?.trim() ||
      !proof.restoreProcedure?.trim() ||
      !Number.isFinite(Date.parse(proof.createdAt))
    ) {
      throw new CoolCommException('迁移备份证明与执行计划不匹配');
    }
    if (!this.verifier) {
      throw new CoolCommException(
        '尚未配置可信备份验证器，禁止执行生产插件 DDL'
      );
    }
    await this.verifier(proof, context);
  }
}

export function checksumPahSqlArtifact(content: string | Buffer) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function migrationSignature(manifest: PahPluginManifest) {
  return JSON.stringify(
    manifest.migrations
      .map(item => ({
        id: item.id,
        version: item.version,
        checksum: item.checksum,
        artifact: item.artifact,
      }))
      .sort((left, right) => left.version - right.version)
  );
}

function isInside(rootDir: string, candidate: string) {
  const relative = path.relative(rootDir, candidate);
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function listSqlArtifacts(rootDir: string, currentDir: string) {
  const result: string[] = [];
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(currentDir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new CoolCommException('迁移目录不允许符号链接');
    }
    if (entry.isDirectory()) {
      result.push(...(await listSqlArtifacts(rootDir, entryPath)));
    } else if (entry.isFile() && entry.name.endsWith('.sql')) {
      result.push(path.relative(rootDir, entryPath).split(path.sep).join('/'));
    }
  }
  return result.sort();
}

function assertAppliedHistory(
  manifest: PahPluginManifest,
  records: PahPluginMigrationRecordEntity[]
) {
  const declared = new Map(manifest.migrations.map(item => [item.id, item]));
  const applied = new Map<string, PahPluginMigrationRecordEntity>();
  for (const record of records.filter(item => item.state === 'applied')) {
    const declaration = declared.get(record.migrationId);
    if (!declaration) {
      throw new CoolCommException(
        `当前 manifest 删除了已应用迁移：${record.migrationId}`
      );
    }
    if (
      record.version !== declaration.version ||
      record.checksum !== declaration.checksum
    ) {
      throw new CoolCommException(
        `已应用迁移声明被篡改：${record.migrationId}`
      );
    }
    if (applied.has(record.migrationId)) {
      throw new CoolCommException(
        `存在重复的有效迁移台账：${record.migrationId}`
      );
    }
    applied.set(record.migrationId, record);
  }
  return applied;
}

function appliedHistorySignature(
  applied: Map<string, PahPluginMigrationRecordEntity>
) {
  return JSON.stringify(
    [...applied.values()]
      .map(item => ({
        id: item.migrationId,
        version: item.version,
        checksum: item.checksum,
      }))
      .sort((left, right) => left.version - right.version)
  );
}

@Provide()
@Scope(ScopeEnum.Singleton)
export class PahPluginMigrationService extends BaseService {
  @InjectEntityModel(PahPluginMigrationRecordEntity)
  pluginMigrationRecordEntity: Repository<PahPluginMigrationRecordEntity>;

  @Inject()
  compiledPluginRegistry: PahCompiledPluginRegistry;

  @Inject()
  backupGate: PahMigrationBackupGate;

  private readonly plans = new Map<string, PahStoredMigrationPlan>();

  async prepare(
    manifest: PahPluginManifest
  ): Promise<PahPreparedMigrationPlan> {
    const sorted = [...manifest.migrations].sort(
      (left, right) => left.version - right.version
    );
    if (sorted.length === 0) {
      return {
        moduleId: manifest.moduleId,
        pluginVersion: manifest.version,
        manifestSignature: migrationSignature(manifest),
        items: [],
      };
    }

    const registration = await this.compiledPluginRegistry.require(
      manifest.moduleId,
      manifest.version
    );
    let realRoot: string;
    try {
      realRoot = await fs.realpath(registration.rootDir);
    } catch {
      throw new CoolCommException(
        `插件 ${manifest.moduleId} 的受控制品根目录不存在`
      );
    }

    const migrationsDir = path.join(realRoot, 'migrations');
    let packagedPaths: string[];
    try {
      packagedPaths = await listSqlArtifacts(realRoot, migrationsDir);
    } catch (error) {
      if (error instanceof CoolCommException) throw error;
      throw new CoolCommException(
        `插件 ${manifest.moduleId} 缺少 migrations 制品目录`
      );
    }
    const declaredPaths = sorted.map(item => item.artifact.path).sort();
    if (JSON.stringify(packagedPaths) !== JSON.stringify(declaredPaths)) {
      throw new CoolCommException(
        `插件 ${manifest.moduleId} 的迁移声明与 SQL 制品不是一一对应`
      );
    }

    const items: PahPreparedMigrationItem[] = [];
    for (const declaration of sorted) {
      const artifactPath = path.resolve(
        realRoot,
        ...declaration.artifact.path.split('/')
      );
      let realArtifactPath: string;
      try {
        realArtifactPath = await fs.realpath(artifactPath);
      } catch {
        throw new CoolCommException(`迁移制品不存在：${declaration.id}`);
      }
      if (!isInside(realRoot, realArtifactPath)) {
        throw new CoolCommException(
          `迁移制品越过插件根目录：${declaration.id}`
        );
      }
      const stat = await fs.stat(realArtifactPath);
      if (!stat.isFile() || stat.size > MAX_SQL_ARTIFACT_BYTES) {
        throw new CoolCommException(
          `迁移制品类型或大小不受支持：${declaration.id}`
        );
      }
      const content = await fs.readFile(realArtifactPath);
      if (checksumPahSqlArtifact(content) !== declaration.checksum) {
        throw new CoolCommException(`迁移制品校验和不匹配：${declaration.id}`);
      }
      let sql: string;
      try {
        sql = new TextDecoder('utf-8', { fatal: true }).decode(content);
      } catch {
        throw new CoolCommException(
          `迁移制品不是有效 UTF-8：${declaration.id}`
        );
      }
      if (!sql.trim()) {
        throw new CoolCommException(`迁移制品不能为空：${declaration.id}`);
      }
      items.push({ declaration, sql });
    }

    return {
      moduleId: manifest.moduleId,
      pluginVersion: manifest.version,
      manifestSignature: migrationSignature(manifest),
      items,
    };
  }

  async dryRun(info: PahPluginInstallationEntity) {
    const prepared = await this.prepare(info.manifest);
    const records = await this.pluginMigrationRecordEntity.find({
      where: { moduleId: Equal(info.moduleId) },
      order: { version: 'ASC', createTime: 'DESC' },
    });
    const applied = assertAppliedHistory(info.manifest, records);
    const backupRequired = prepared.items.some(
      item => !applied.has(item.declaration.id)
    );
    const storedPrepared = {
      ...prepared,
      appliedSignature: appliedHistorySignature(applied),
      backupRequired,
    };
    const planId = randomUUID();
    const expiresAt = Date.now() + MIGRATION_PLAN_TTL_MS;
    for (const [existingPlanId, existing] of this.plans) {
      if (
        existing.expiresAt < Date.now() ||
        (existing.prepared.moduleId === info.moduleId &&
          existing.prepared.pluginVersion === info.version)
      ) {
        this.plans.delete(existingPlanId);
      }
    }
    this.plans.set(planId, { prepared: storedPrepared, expiresAt });
    return {
      dryRun: true,
      planId,
      expiresAt: new Date(expiresAt).toISOString(),
      moduleId: info.moduleId,
      pluginVersion: info.version,
      artifactsVerified: true,
      transaction: 'required',
      backupRequired,
      items: prepared.items.map(item => ({
        id: item.declaration.id,
        version: item.declaration.version,
        checksum: item.declaration.checksum,
        description: item.declaration.description,
        artifactPath: item.declaration.artifact.path,
        state: applied.has(item.declaration.id) ? 'applied' : 'pending',
      })),
    } as PahMigrationDryRunPlan;
  }

  claimPlan(moduleId: string, pluginVersion: string, planId: string) {
    const stored = this.plans.get(planId);
    this.plans.delete(planId);
    if (
      !stored ||
      stored.expiresAt < Date.now() ||
      stored.prepared.moduleId !== moduleId ||
      stored.prepared.pluginVersion !== pluginVersion
    ) {
      throw new CoolCommException('迁移 dry-run 计划不存在、已过期或不匹配');
    }
    return stored.prepared;
  }

  async claimPlanForExecution(
    moduleId: string,
    pluginVersion: string,
    planId: string,
    backupProof?: PahMigrationBackupProof
  ) {
    const prepared = this.claimPlan(moduleId, pluginVersion, planId);
    if (prepared.backupRequired) {
      if (!backupProof) {
        throw new CoolCommException(
          '待执行 DDL 缺少当前插件版本的可信备份证明'
        );
      }
      await this.backupGate.verify(backupProof, {
        moduleId,
        pluginVersion,
        dataSourceName: 'default',
        migrations: prepared.items.map(item => ({
          id: item.declaration.id,
          version: item.declaration.version,
          checksum: item.declaration.checksum,
        })),
      });
    }
    return { ...prepared, backupProof };
  }

  /** @internal 只接受同一进程刚刚认领的一次性 dry-run 计划。 */
  async executeClaimed(moduleId: string, prepared: PahPreparedMigrationPlan) {
    if (moduleId !== prepared.moduleId) {
      throw new CoolCommException('迁移计划与插件不匹配');
    }
    if (prepared.appliedSignature === undefined) {
      throw new CoolCommException('迁移计划没有完成 dry-run 台账快照');
    }
    const batchId = randomUUID();
    return this.getOrmManager().transaction(async manager => {
      const installationRepository = manager.getRepository(
        PahPluginInstallationEntity
      );
      const migrationRepository = manager.getRepository(
        PahPluginMigrationRecordEntity
      );
      const info = await installationRepository.findOne({
        where: { moduleId: Equal(moduleId) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!info) throw new CoolCommException(`插件 ${moduleId} 尚未登记`);
      if (info.state !== 'staged') {
        throw new CoolCommException(`插件 ${moduleId} 尚未进入 staged 状态`);
      }
      if (
        info.version !== prepared.pluginVersion ||
        migrationSignature(info.manifest) !== prepared.manifestSignature
      ) {
        throw new CoolCommException(
          '迁移执行前 manifest 已变化，请重新 dry-run'
        );
      }

      const records = await migrationRepository.find({
        where: { moduleId: Equal(moduleId) },
        order: { version: 'ASC', createTime: 'DESC' },
      });
      const applied = assertAppliedHistory(info.manifest, records);
      if (appliedHistorySignature(applied) !== prepared.appliedSignature) {
        throw new CoolCommException('迁移台账已变化，请重新执行 dry-run');
      }
      for (const item of prepared.items) {
        if (applied.has(item.declaration.id)) continue;
        await manager.query(item.sql);
        await migrationRepository.save({
          moduleId,
          migrationId: item.declaration.id,
          version: item.declaration.version,
          checksum: item.declaration.checksum,
          importBatchId: batchId,
          state: 'applied',
          detail: JSON.stringify({
            executor: 'pah-sql-v1',
            artifactPath: item.declaration.artifact.path,
            pluginVersion: info.version,
            backupId: prepared.backupProof?.backupId ?? null,
          }),
          appliedAt: new Date().toISOString(),
          rolledBackAt: null,
        });
      }

      const migrated = await installationRepository.update(
        { id: info.id, state: 'staged' },
        {
          state: 'migrated',
          stateChangedAt: new Date().toISOString(),
          lastError: null,
        }
      );
      if (migrated.affected !== 1) {
        throw new CoolCommException('插件状态已变化，请重新执行 dry-run');
      }
      const installed = await installationRepository.update(
        { id: info.id, state: 'migrated' },
        {
          state: 'installed',
          stateChangedAt: new Date().toISOString(),
          lastError: null,
        }
      );
      if (installed.affected !== 1) {
        throw new CoolCommException('插件安装状态提交失败');
      }
      return { ...info, state: 'installed' as const, lastError: null };
    });
  }
}
