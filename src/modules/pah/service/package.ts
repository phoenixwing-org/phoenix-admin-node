import { BaseService, CoolCommException } from '@cool-midway/core';
import { execFileSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { ILogger, Inject, Logger, Provide } from '@midwayjs/core';
import * as path from 'path';
import {
  PahPluginManifest,
  validatePahPluginManifest,
} from '../interface/plugin';
import { PahLocalPluginBackupService } from './local-backup';
import { PahPluginService } from './plugin';
import { PahPublicLoginBrandingService } from './public-login-branding';

const PHOENIX_PACKAGE_SUFFIX = '.phoenix.cool';
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
const forbiddenPackagePath =
  /(^|\/)(?:node_modules|test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|(^|\/)(?:vitest\.config|tsconfig\.fixture)|(^|\/)controlled-test-suite\.json$/;

interface UploadedFile {
  data?: string;
  filename?: string;
}

interface PackageIntegrityItem {
  path: string;
  size: number;
  sha256: string;
}

interface PackageValidationCheck {
  id: string;
  label: string;
  detail: string;
}

interface PackageValidationProgress {
  current: string;
  checks: PackageValidationCheck[];
}

interface PackageMetadata {
  kind?: string;
  moduleId?: string;
  version?: string;
  manifest?: string;
  integrity?: string;
  source?: { commit?: string; dirty?: boolean };
  installerCompatibility?: {
    pahBusinessModule?: boolean;
    coolNativeHook?: boolean;
  };
  payloads?: Array<{
    runtime?: 'node' | 'vue';
    source?: string;
    target?: string;
  }>;
}

type HostRuntime = 'node' | 'vue';

interface ArchivedHostPayload {
  runtime: HostRuntime;
  root: string;
  moduleId: string;
  target: string;
  archived: string;
  operationRoot: string;
}

function sha256(content: Buffer) {
  return createHash('sha256').update(content).digest('hex');
}

function safePackagePath(value: unknown, label = '制品路径') {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\\') ||
    value.includes('\0') ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  ) {
    throw new CoolCommException(`${label}不安全：${String(value)}`);
  }
  const segments = value.split('/');
  if (
    segments.some(item => !item || item === '.' || item === '..') ||
    path.posix.normalize(value) !== value
  ) {
    throw new CoolCommException(`${label}不安全：${value}`);
  }
  return value;
}

function parseJson<T>(entries: Map<string, any>, name: string): T {
  const entry = entries.get(name);
  if (!entry) throw new CoolCommException(`插件包缺少 ${name}`);
  try {
    return JSON.parse(entry.getData().toString('utf8')) as T;
  } catch {
    throw new CoolCommException(`插件包 ${name} 不是合法 JSON`);
  }
}

function assertOrdinaryZipEntry(entry: any) {
  if (entry.isDirectory) {
    throw new CoolCommException(`插件包不得包含目录条目：${entry.entryName}`);
  }
  const unixMode = Number(entry.header?.attr ?? 0) >>> 16;
  if ((unixMode & 0o170000) === 0o120000) {
    throw new CoolCommException(`插件包不得包含符号链接：${entry.entryName}`);
  }
}

function resolveHostRoots() {
  const nodeRoot = realpathSync(
    path.resolve(process.env.PHOENIX_ADMIN_NODE_ROOT || process.cwd())
  );
  const vueRoot = realpathSync(
    path.resolve(
      process.env.PHOENIX_ADMIN_VUE_ROOT || path.join(nodeRoot, '../vue')
    )
  );
  const nodePackage = JSON.parse(
    readFileSync(path.join(nodeRoot, 'package.json'), 'utf8')
  );
  const vuePackage = JSON.parse(
    readFileSync(path.join(vueRoot, 'package.json'), 'utf8')
  );
  if (
    nodePackage.name !== 'phoenix-admin-node' ||
    vuePackage.name !== 'phoenix-admin-vue'
  ) {
    throw new CoolCommException(
      '未找到成对的 Phoenix Admin Node/Vue 本地 Host'
    );
  }
  return { nodeRoot, vueRoot };
}

function requireSafeModuleId(moduleId: string) {
  if (!/^[a-z][a-z0-9-]*$/.test(moduleId)) {
    throw new CoolCommException('插件模块 ID 不安全，拒绝清理本机装配');
  }
}

function requireOrdinaryDirectory(directory: string, label: string) {
  const stat = lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new CoolCommException(`${label} 不是安装器管理的普通目录，拒绝清理`);
  }
}

function requirePathWithinRoot(root: string, target: string, label: string) {
  const relative = path.relative(root, target);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new CoolCommException(`${label} 越出 Phoenix Admin Host，拒绝清理`);
  }
}

function managedPayloadTarget(
  root: string,
  runtime: HostRuntime,
  moduleId: string
) {
  const sourceRoot = path.join(root, 'src');
  const modulesRoot = path.join(sourceRoot, 'modules');
  const target = path.join(modulesRoot, moduleId);
  requirePathWithinRoot(root, target, `${runtime} Host payload`);
  if (!existsSync(sourceRoot)) return target;
  requireOrdinaryDirectory(sourceRoot, `${runtime} Host src`);
  if (!existsSync(modulesRoot)) return target;
  requireOrdinaryDirectory(modulesRoot, `${runtime} Host modules`);
  if (!existsSync(target)) return target;
  requireOrdinaryDirectory(target, `${runtime} Host 的 ${moduleId}`);
  return target;
}

function createArchiveOperationRoot(
  root: string,
  operation: 'discard' | 'uninstall',
  operationId: string
) {
  let current = root;
  for (const segment of ['.runtime', 'phoenix-plugin-recycle', operation]) {
    current = path.join(current, segment);
    requirePathWithinRoot(root, current, '插件回收目录');
    if (existsSync(current)) {
      requireOrdinaryDirectory(current, '插件回收目录');
    } else {
      mkdirSync(current, { recursive: false });
    }
  }
  const operationRoot = path.join(current, operationId);
  requirePathWithinRoot(root, operationRoot, '插件回收操作目录');
  mkdirSync(operationRoot, { recursive: false });
  return operationRoot;
}

function restoreArchivedPayloads(moved: ArchivedHostPayload[]) {
  const rollbackOrder = [...moved].reverse();
  for (const item of rollbackOrder) {
    if (!existsSync(item.archived)) {
      throw new CoolCommException(
        `${item.runtime} Host 回收 payload 缺失，无法自动恢复卸载前状态`
      );
    }
    requireOrdinaryDirectory(
      item.archived,
      `${item.runtime} Host 回收 payload`
    );
    if (existsSync(item.target)) {
      throw new CoolCommException(
        `${item.runtime} Host 的 ${path.basename(
          item.target
        )} 已被并发占用，无法自动恢复卸载前 payload`
      );
    }
    managedPayloadTarget(item.root, item.runtime, item.moduleId);
  }

  const restored: ArchivedHostPayload[] = [];
  try {
    for (const item of rollbackOrder) {
      renameSync(item.archived, item.target);
      restored.push(item);
    }
  } catch (error) {
    for (const item of [...restored].reverse()) {
      if (existsSync(item.target) && !existsSync(item.archived)) {
        renameSync(item.target, item.archived);
      }
    }
    throw error;
  }
  for (const item of rollbackOrder) {
    rmSync(item.operationRoot, { recursive: true, force: true });
  }
}

function archiveLocalPayloads(
  moduleId: string,
  operation: 'discard' | 'uninstall'
) {
  requireSafeModuleId(moduleId);
  const roots = resolveHostRoots();
  const operationId = randomUUID();
  const moved: ArchivedHostPayload[] = [];
  try {
    for (const runtime of ['node', 'vue'] as const) {
      const root = roots[`${runtime}Root`];
      const target = managedPayloadTarget(root, runtime, moduleId);
      if (!existsSync(target)) continue;
      const operationRoot = createArchiveOperationRoot(
        root,
        operation,
        operationId
      );
      const archived = path.join(operationRoot, moduleId);
      requirePathWithinRoot(root, archived, `${runtime} Host 回收 payload`);
      try {
        renameSync(target, archived);
      } catch (error) {
        rmSync(operationRoot, { recursive: true, force: true });
        throw error;
      }
      moved.push({
        runtime,
        root,
        moduleId,
        target,
        archived,
        operationRoot,
      });
    }
    return moved;
  } catch (error) {
    try {
      restoreArchivedPayloads(moved);
    } catch (rollbackError) {
      throw new CoolCommException(
        `本机 payload 回收失败且自动恢复失败：${
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError)
        }`
      );
    }
    throw error;
  }
}

function removeArchivedPayloads(moved: ArchivedHostPayload[]) {
  const cleanupPendingPayloads: HostRuntime[] = [];
  for (const item of moved) {
    try {
      rmSync(item.operationRoot, { recursive: true, force: true });
    } catch {
      if (existsSync(item.operationRoot)) {
        cleanupPendingPayloads.push(item.runtime);
      }
    }
  }
  return cleanupPendingPayloads;
}

function syncHostRuntimeEntities(nodeRoot: string) {
  const script = path.join(nodeRoot, 'scripts/pah-sync-runtime-entities.cjs');
  if (!existsSync(script)) {
    throw new CoolCommException(`Admin Node 缺少实体同步器：${script}`);
  }
  try {
    return execFileSync(process.execPath, [script, '--root', nodeRoot], {
      cwd: nodeRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15_000,
    }).trim();
  } catch (error) {
    const detail =
      error && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr?: unknown }).stderr ?? '').trim()
        : '';
    throw new CoolCommException(
      `Admin Node 实体同步失败${detail ? `：${detail}` : ''}`
    );
  }
}

function restoreArchivedPayloadsAndEntities(
  moved: ArchivedHostPayload[],
  nodeRoot: string,
  originalError: unknown
): never {
  try {
    restoreArchivedPayloads(moved);
    syncHostRuntimeEntities(nodeRoot);
  } catch (rollbackError) {
    throw new CoolCommException(
      `插件 payload 或实体清单自动恢复失败：${
        rollbackError instanceof Error
          ? rollbackError.message
          : String(rollbackError)
      }`
    );
  }
  throw originalError;
}

function stagePayload(
  entries: Map<string, any>,
  source: string,
  target: string
) {
  const prefix = `${source}/`;
  const payloadEntries = [...entries.entries()].filter(([name]) =>
    name.startsWith(prefix)
  );
  if (!payloadEntries.length) {
    throw new CoolCommException(`插件包 payload 为空：${source}`);
  }
  const parent = path.dirname(target);
  mkdirSync(parent, { recursive: true });
  const temporary = path.join(
    parent,
    `.phoenix-package-${path.basename(target)}-${randomUUID()}`
  );
  mkdirSync(temporary, { recursive: false });
  try {
    for (const [name, entry] of payloadEntries) {
      const relative = safePackagePath(
        name.slice(prefix.length),
        'payload 路径'
      );
      const output = path.join(temporary, ...relative.split('/'));
      if (!output.startsWith(`${temporary}${path.sep}`)) {
        throw new CoolCommException(`payload 路径越界：${relative}`);
      }
      mkdirSync(path.dirname(output), { recursive: true });
      writeFileSync(output, entry.getData(), { flag: 'wx' });
    }
    if (!existsSync(path.join(temporary, 'config.ts'))) {
      throw new CoolCommException(`payload 缺少模块入口：${source}/config.ts`);
    }
    return temporary;
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

function payloadFiles(root: string, relative = ''): Map<string, string> {
  const result = new Map<string, string>();
  const directory = path.join(root, relative);
  for (const name of readdirSync(directory).sort()) {
    const nextRelative = relative ? `${relative}/${name}` : name;
    const absolute = path.join(root, ...nextRelative.split('/'));
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      throw new CoolCommException(
        `本机 payload 不得包含符号链接：${nextRelative}`
      );
    }
    if (stat.isDirectory()) {
      for (const [nestedName, digest] of payloadFiles(root, nextRelative)) {
        result.set(nestedName, digest);
      }
    } else if (stat.isFile()) {
      result.set(nextRelative, sha256(readFileSync(absolute)));
    }
  }
  return result;
}

function samePayload(left: string, right: string) {
  const leftFiles = payloadFiles(left);
  const rightFiles = payloadFiles(right);
  return (
    leftFiles.size === rightFiles.size &&
    [...leftFiles].every(([name, digest]) => rightFiles.get(name) === digest)
  );
}

@Provide()
export class PahPluginPackageService extends BaseService {
  @Inject()
  pahPluginService: PahPluginService;

  @Inject()
  pahLocalPluginBackupService: PahLocalPluginBackupService;

  @Inject()
  pahPublicLoginBrandingService: PahPublicLoginBrandingService;

  @Logger()
  logger: ILogger;

  async createLocalBackup(moduleId: string) {
    this.requireLocalPackageMode();
    const info = await this.pahPluginService.getByModuleId(moduleId);
    if (!info) throw new CoolCommException(`插件 ${moduleId} 尚未登记`);
    if (!['verified', 'installed', 'disabled'].includes(info.state)) {
      throw new CoolCommException(
        `插件状态 ${info.state} 不能创建本地安装备份`
      );
    }
    const result = await this.pahLocalPluginBackupService.createVerifiedBackup(
      info.moduleId,
      info.version
    );
    this.logger.info(
      `[phoenix-plugin] backup verified module=${info.moduleId} backup=${result.backup.backupId} bytes=${result.backup.size}`
    );
    return result.backup;
  }

  async localRuntimeStatus(moduleId: string) {
    this.requireLocalPackageMode();
    const info = await this.pahPluginService.getByModuleId(moduleId);
    if (!info) throw new CoolCommException(`插件 ${moduleId} 尚未登记`);
    const plan = await this.pahPluginService.migrationPlan(moduleId);
    return {
      moduleId: info.moduleId,
      version: info.version,
      ready: true,
      migrations: plan.items.length,
      pendingMigrations: plan.items.filter(item => item.state === 'pending')
        .length,
    };
  }

  async controlledInstallLocal(moduleId: string) {
    this.requireLocalPackageMode();
    const info = await this.pahPluginService.getByModuleId(moduleId);
    if (!info) throw new CoolCommException(`插件 ${moduleId} 尚未登记`);
    if (info.state !== 'verified') {
      throw new CoolCommException(
        `只有已验证插件可以受控安装，当前状态：${info.state}`
      );
    }
    const plan = await this.pahPluginService.migrationPlan(info.moduleId);
    const installation = await this.pahPluginService.installCompiled(
      info.moduleId,
      plan.planId
    );
    this.logger.info(
      `[phoenix-plugin] controlled install complete module=${info.moduleId} version=${info.version}`
    );
    return {
      moduleId: info.moduleId,
      version: info.version,
      appliedMigrations: plan.items.filter(item => item.state === 'pending')
        .length,
      installation,
    };
  }

  async controlledUninstallLocal(moduleId: string) {
    this.requireLocalPackageMode();
    const info = await this.pahPluginService.getByModuleId(moduleId);
    if (!info) throw new CoolCommException(`插件 ${moduleId} 尚未登记`);
    if (!['installed', 'disabled'].includes(info.state)) {
      throw new CoolCommException(
        `插件必须处于已安装或已停用状态才能卸载，当前状态：${info.state}`
      );
    }
    const moved = archiveLocalPayloads(info.moduleId, 'uninstall');
    const { nodeRoot } = resolveHostRoots();
    let installation;
    try {
      syncHostRuntimeEntities(nodeRoot);
      installation = await this.pahPluginService.uninstall(info.moduleId);
    } catch (error) {
      restoreArchivedPayloadsAndEntities(moved, nodeRoot, error);
    }
    const removedPayloads = moved.map(item => item.runtime);
    const cleanupPendingPayloads = removeArchivedPayloads(moved);
    if (cleanupPendingPayloads.length > 0) {
      this.logger.error(
        `[phoenix-plugin] controlled uninstall archive cleanup pending module=${
          info.moduleId
        } payloads=${cleanupPendingPayloads.join(',')}`
      );
    }
    this.logger.info(
      `[phoenix-plugin] controlled uninstall complete module=${
        info.moduleId
      } payloads=${removedPayloads.join(',') || 'none'}`
    );
    return {
      moduleId: info.moduleId,
      version: info.version,
      removedPayloads,
      restartRequired: removedPayloads.length > 0,
      cleanupPendingPayloads,
      installation,
    };
  }

  /**
   * 放弃已验证但尚未安装的本地包。
   *
   * 先把 Node/Vue payload 移到 Host 外围的临时回收目录，再提交生命周期状态；
   * 状态提交失败时恢复两个 payload，避免留下半清理装配。
   */
  async discardLocalPackage(moduleId: string) {
    this.requireLocalPackageMode();
    const info = await this.pahPluginService.getByModuleId(moduleId);
    if (!info) throw new CoolCommException(`插件 ${moduleId} 尚未登记`);
    if (info.state !== 'verified') {
      throw new CoolCommException(
        `只有已验证且尚未安装的插件包可以清理，当前状态：${info.state}`
      );
    }
    const moved = archiveLocalPayloads(info.moduleId, 'discard');
    const { nodeRoot } = resolveHostRoots();
    try {
      syncHostRuntimeEntities(nodeRoot);
      const installation = await this.pahPluginService.discardVerifiedPackage(
        info.moduleId
      );
      const cleanupPendingPayloads = removeArchivedPayloads(moved);
      if (cleanupPendingPayloads.length > 0) {
        this.logger.error(
          `[phoenix-plugin] verified package archive cleanup pending module=${
            info.moduleId
          } payloads=${cleanupPendingPayloads.join(',')}`
        );
      }
      this.logger.info(
        `[phoenix-plugin] verified package discarded module=${
          info.moduleId
        } version=${info.version} payloads=${
          moved.map(item => item.runtime).join(',') || 'none'
        }`
      );
      return {
        moduleId: info.moduleId,
        version: info.version,
        removedPayloads: moved.map(item => item.runtime),
        restartRequired: moved.length > 0,
        cleanupPendingPayloads,
        installation,
      };
    } catch (error) {
      restoreArchivedPayloadsAndEntities(moved, nodeRoot, error);
    }
  }

  async installLocalPackage(file: UploadedFile) {
    const progress: PackageValidationProgress = {
      current: '运行模式',
      checks: [],
    };
    try {
      return await this.installValidatedLocalPackage(file, progress);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('插件包校验未通过｜')) throw error;
      const passed = progress.checks.length
        ? progress.checks.map(item => item.label).join('、')
        : '无';
      throw new CoolCommException(
        `插件包校验未通过｜失败阶段：${progress.current}｜已通过：${passed}｜${message}`
      );
    }
  }

  private async installValidatedLocalPackage(
    file: UploadedFile,
    progress: PackageValidationProgress
  ) {
    this.requireLocalPackageMode();
    progress.checks.push({
      id: 'runtime-mode',
      label: '运行模式',
      detail: '本地受控包模式可用',
    });
    progress.current = '上传边界';
    const filename = path.basename(file?.filename || '');
    if (!filename.endsWith(PHOENIX_PACKAGE_SUFFIX)) {
      throw new CoolCommException(
        `只接受 ${PHOENIX_PACKAGE_SUFFIX}，旧插件后缀不兼容`
      );
    }
    if (
      !file?.data ||
      !existsSync(file.data) ||
      !lstatSync(file.data).isFile()
    ) {
      throw new CoolCommException('未收到有效的 Phoenix 插件包');
    }
    const packageBytes = readFileSync(file.data);
    if (!packageBytes.length || packageBytes.length > MAX_PACKAGE_BYTES) {
      throw new CoolCommException('Phoenix 插件包大小必须在 1B～100MiB 之间');
    }
    const packageSha256 = sha256(packageBytes);
    progress.checks.push({
      id: 'upload-boundary',
      label: '上传边界',
      detail: `${filename} · ${packageBytes.length} bytes`,
    });
    progress.current = 'ZIP 与路径安全';

    this.logger.info(
      `[phoenix-plugin] inspect start file=${filename} bytes=${packageBytes.length}`
    );
    const AdmZip = require('adm-zip');
    let zip;
    try {
      zip = new AdmZip(packageBytes);
    } catch {
      throw new CoolCommException('Phoenix 插件包不是合法 ZIP 制品');
    }
    const entries = new Map<string, any>();
    for (const entry of zip.getEntries()) {
      assertOrdinaryZipEntry(entry);
      const name = safePackagePath(entry.entryName, '压缩包条目');
      if (entries.has(name)) {
        throw new CoolCommException(`插件包存在重复条目：${name}`);
      }
      if (forbiddenPackagePath.test(name)) {
        throw new CoolCommException(`插件包包含测试、工具或依赖目录：${name}`);
      }
      if (['src/index.js', 'source/index.ts'].includes(name)) {
        throw new CoolCommException(
          `Phoenix 业务插件不得包含 COOL Hook：${name}`
        );
      }
      entries.set(name, entry);
    }

    progress.checks.push({
      id: 'archive-safety',
      label: 'ZIP 与路径安全',
      detail: `${entries.size} 个普通文件条目`,
    });
    progress.current = '根目录契约';
    const missingRootEntries = [
      'plugin.json',
      'manifest.json',
      'integrity.json',
    ].filter(name => !entries.has(name));
    const obsoleteEntries = [...entries.keys()].filter(
      name =>
        name.startsWith('payload/midway/') ||
        ['payload/manifest.json', 'payload/package.json'].includes(name)
    );
    const rootIssues = [
      missingRootEntries.length
        ? `缺少根文件：${missingRootEntries.join('、')}`
        : '',
      obsoleteEntries.length ? `包含旧布局：${obsoleteEntries.join('、')}` : '',
    ].filter(Boolean);
    if (rootIssues.length) {
      throw new CoolCommException(rootIssues.join('；'));
    }
    progress.checks.push({
      id: 'root-contract',
      label: '根目录契约',
      detail: 'plugin / manifest / integrity 完整，未发现旧 payload 布局',
    });
    progress.current = '身份与 Manifest';

    const metadata = parseJson<PackageMetadata>(entries, 'plugin.json');
    const manifest = parseJson<PahPluginManifest>(entries, 'manifest.json');
    const integrity = parseJson<{
      formatVersion?: number;
      algorithm?: string;
      files?: PackageIntegrityItem[];
    }>(entries, 'integrity.json');
    const validation = validatePahPluginManifest(manifest);
    if (!validation.valid) {
      throw new CoolCommException(validation.errors.join('；'));
    }
    if (
      metadata.kind !== 'pah-business-module' ||
      metadata.moduleId !== manifest.moduleId ||
      metadata.version !== manifest.version ||
      metadata.manifest !== 'manifest.json' ||
      metadata.integrity !== 'integrity.json' ||
      metadata.installerCompatibility?.pahBusinessModule !== true ||
      metadata.installerCompatibility?.coolNativeHook !== false ||
      metadata.source?.dirty !== false ||
      !/^[a-f0-9]{40}$/.test(metadata.source?.commit || '')
    ) {
      throw new CoolCommException(
        'Phoenix 插件包身份、安装边界或源码状态不合法'
      );
    }

    progress.checks.push({
      id: 'identity-manifest',
      label: '身份与 Manifest',
      detail: `${manifest.moduleId}@${manifest.version}`,
    });
    progress.current = '完整性与迁移';

    const expectedFiles = [...entries.keys()]
      .filter(name => name !== 'integrity.json')
      .sort();
    if (
      integrity.formatVersion !== 1 ||
      integrity.algorithm !== 'sha256' ||
      !Array.isArray(integrity.files) ||
      integrity.files.length !== expectedFiles.length
    ) {
      throw new CoolCommException('Phoenix 插件包完整性清单不合法');
    }
    const declared = new Map<string, PackageIntegrityItem>();
    for (const item of integrity.files) {
      const name = safePackagePath(item?.path, 'integrity 路径');
      if (
        declared.has(name) ||
        !Number.isSafeInteger(item?.size) ||
        item.size < 0 ||
        !/^[a-f0-9]{64}$/.test(item?.sha256 || '')
      ) {
        throw new CoolCommException(`非法 integrity 条目：${name}`);
      }
      declared.set(name, item);
    }
    for (const name of expectedFiles) {
      const content = entries.get(name).getData() as Buffer;
      const item = declared.get(name);
      if (
        !item ||
        item.size !== content.length ||
        item.sha256 !== sha256(content)
      ) {
        throw new CoolCommException(`Phoenix 插件包文件完整性不匹配：${name}`);
      }
    }
    for (const migration of manifest.migrations || []) {
      const name = `payload/node/${manifest.moduleId}/${migration.artifact.path}`;
      const entry = entries.get(name);
      if (
        !entry ||
        migration.checksum !== `sha256:${sha256(entry.getData())}`
      ) {
        throw new CoolCommException(
          `migration checksum 不匹配：${migration.id}`
        );
      }
    }

    progress.checks.push({
      id: 'integrity-migrations',
      label: '完整性与迁移',
      detail: `${expectedFiles.length} 个文件，${
        (manifest.migrations || []).length
      } 条迁移`,
    });
    progress.current = 'Node/Vue payload';

    const payloads = metadata.payloads || [];
    const expectedPayloads = new Map([
      [
        'node',
        {
          source: `payload/node/${manifest.moduleId}`,
          target: `src/modules/${manifest.moduleId}`,
        },
      ],
      [
        'vue',
        {
          source: `payload/vue/${manifest.moduleId}`,
          target: `src/modules/${manifest.moduleId}`,
        },
      ],
    ]);
    if (payloads.length !== expectedPayloads.size) {
      throw new CoolCommException(
        'Phoenix 插件包必须精确包含 Node/Vue 两个 payload'
      );
    }
    for (const [runtime, expected] of expectedPayloads) {
      if (!entries.has(`${expected.source}/config.ts`)) {
        throw new CoolCommException(
          `Phoenix 插件包缺少 ${runtime} 模块入口：${expected.source}/config.ts`
        );
      }
    }
    progress.checks.push({
      id: 'runtime-payloads',
      label: 'Node/Vue payload',
      detail: '两个运行时入口和安装映射完整',
    });
    progress.current = 'Host 装配与登记';
    const { nodeRoot, vueRoot } = resolveHostRoots();
    const roots = { node: nodeRoot, vue: vueRoot };
    const staged: Array<{
      temporary: string;
      target: string;
      installed: boolean;
      reused: boolean;
    }> = [];
    try {
      for (const payload of payloads) {
        const expected = expectedPayloads.get(payload.runtime || '');
        if (
          !expected ||
          payload.source !== expected.source ||
          payload.target !== expected.target
        ) {
          throw new CoolCommException('Phoenix 插件包 payload 声明越界');
        }
        const target = path.join(
          roots[payload.runtime],
          ...expected.target.split('/')
        );
        const temporary = stagePayload(entries, expected.source, target);
        if (existsSync(target)) {
          if (!samePayload(temporary, target)) {
            rmSync(temporary, { recursive: true, force: true });
            throw new CoolCommException(
              `本机 Host 已存在不同内容的 ${manifest.moduleId}；禁止覆盖测试装配`
            );
          }
          rmSync(temporary, { recursive: true, force: true });
          staged.push({
            temporary: '',
            target,
            installed: false,
            reused: true,
          });
          continue;
        }
        staged.push({
          temporary,
          target,
          installed: false,
          reused: false,
        });
      }
      for (const item of staged) {
        if (item.reused) continue;
        renameSync(item.temporary, item.target);
        item.installed = true;
      }
    } catch (error) {
      for (const item of staged.reverse()) {
        if (item.reused) continue;
        rmSync(item.installed ? item.target : item.temporary, {
          recursive: true,
          force: true,
        });
      }
      throw error;
    }

    let brandingReceiptCreated = false;
    try {
      syncHostRuntimeEntities(nodeRoot);
      const brandingReceipt =
        this.pahPublicLoginBrandingService.recordVerifiedPackage(
          manifest,
          packageSha256,
          path.join(vueRoot, 'src', 'modules', manifest.moduleId)
        );
      brandingReceiptCreated = brandingReceipt.receiptCreated === true;
      const installation = await this.pahPluginService.register(manifest);
      this.logger.info(
        `[phoenix-plugin] install staged module=${manifest.moduleId} version=${manifest.version} files=${entries.size} sha256=${packageSha256}`
      );
      return {
        moduleId: manifest.moduleId,
        version: manifest.version,
        name: manifest.name,
        fileCount: entries.size,
        packageSha256,
        restartRequired: staged.some(item => item.installed),
        validationChecks: [
          ...progress.checks,
          {
            id: 'host-stage-register',
            label: 'Host 装配与登记',
            detail: staged.some(item => item.installed)
              ? '新 payload 已装配，manifest 已登记'
              : '不可变 payload 已复用，manifest 已登记',
          },
        ],
        installation,
      };
    } catch (error) {
      if (brandingReceiptCreated) {
        this.pahPublicLoginBrandingService.removeVerifiedPackageReceipt(
          manifest.moduleId,
          manifest.version,
          packageSha256
        );
      }
      for (const item of staged.reverse()) {
        if (item.installed && !item.reused) {
          rmSync(item.target, { recursive: true, force: true });
        }
      }
      try {
        syncHostRuntimeEntities(nodeRoot);
      } catch (rollbackError) {
        throw new CoolCommException(
          `插件登记失败，且实体清单自动恢复失败：${
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError)
          }`
        );
      }
      this.logger.error(
        `[phoenix-plugin] install failed module=${manifest.moduleId} message=${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }

  private requireLocalPackageMode() {
    const controlledInstallerMode =
      process.env.PAH_LOCAL_PACKAGE_MODE === 'true' &&
      process.env.PAH_DB_SYNCHRONIZE === 'false' &&
      process.env.PAH_DB_INITIALIZE === 'false';
    if (process.env.NODE_ENV === 'production' && !controlledInstallerMode) {
      throw new CoolCommException(
        '正式环境必须通过受控部署编排装配 Phoenix 插件包'
      );
    }
  }
}
