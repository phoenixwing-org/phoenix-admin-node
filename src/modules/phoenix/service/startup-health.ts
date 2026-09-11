import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'fs';
import { ILogger, Inject, Logger, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import * as path from 'path';
import { Equal, Repository } from 'typeorm';
import { PahPluginInstallationEntity } from '../entity/plugin';
import { PahPluginMigrationRecordEntity } from '../entity/migration-record';
import {
  PahPluginManifest,
  validatePhoenixPluginManifest,
} from '../interface/plugin';
import { PahPublicLoginBrandingService } from './public-login-branding';
import {
  inspectPahPluginActivation,
  pahPluginManifestSha256,
} from './runtime-activation';

const MODULE_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const HOST_MODULE_IDS = new Set([
  'base',
  'demo',
  'dict',
  // `phoenix` is canonical; keep `pah` as a fixed legacy fixture/module id.
  'pah',
  'phoenix',
  'plugin',
  'recycle',
  'space',
  'swagger',
  'task',
  'user',
]);

export type PhoenixPluginStartupState =
  | 'ready'
  | 'action-required'
  | 'quarantined';

export interface PhoenixPluginStartupItem {
  moduleId: string;
  origin: 'development' | 'release';
  state: PhoenixPluginStartupState;
  detail: string;
  pluginType?: string;
  manifest?: PahPluginManifest;
  manifestFile?: string;
  productRoot?: string;
  sourceCommit?: string;
  sourceIdentitySha256?: string;
  webSource?: string;
  nodeSource: string;
  activationVersion?: string;
  activationManifestSha256?: string;
}

export interface PhoenixPluginStartupInspection {
  plugins: PhoenixPluginStartupItem[];
  ignoredModuleIds: string[];
  ignoredDetectorPatterns: string[];
}

export interface PhoenixPluginStartupHealthResult {
  state: PhoenixPluginStartupState;
  plugins: Array<
    Pick<
      PhoenixPluginStartupItem,
      'moduleId' | 'origin' | 'state' | 'detail' | 'pluginType'
    > & {
      version?: string;
      manifestSha256?: string;
    }
  >;
}

function sha256(content: string | Buffer) {
  return createHash('sha256').update(content).digest('hex');
}

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function safeRealDirectory(value: string) {
  try {
    const resolved = realpathSync(value);
    return statSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function gitValue(root: string, args: string[]) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3_000,
    }).trim();
  } catch {
    return null;
  }
}

function parseManifest(file: string) {
  try {
    const bytes = readFileSync(file);
    const manifest = JSON.parse(bytes.toString('utf8')) as PahPluginManifest;
    const validation = validatePhoenixPluginManifest(manifest);
    return validation.valid
      ? { manifest, bytes, detail: 'manifest 校验通过' }
      : { manifest: null, bytes, detail: validation.errors.join('；') };
  } catch (error) {
    return {
      manifest: null,
      bytes: null,
      detail: `manifest 无法读取：${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function developmentIdentity(
  sourceCommit: string,
  manifestBytes: Buffer,
  manifest: PahPluginManifest
) {
  const brandAssets = manifest.uiContributions?.brand;
  const assets = brandAssets
    ? [
        brandAssets.favicon,
        brandAssets.logo,
        brandAssets.logoDark,
        brandAssets.compactLogo,
        brandAssets.compactLogoDark,
        brandAssets.background,
      ]
        .filter(Boolean)
        .map(item => ({
          path: item!.path,
          sha256: item!.sha256,
          mime: item!.mime,
          size: item!.size,
        }))
        .sort((left, right) => left.path.localeCompare(right.path))
    : [];
  return sha256(
    JSON.stringify({
      sourceCommit,
      manifestSha256: sha256(manifestBytes),
      assets,
    })
  );
}

function unsafeBrandingRuntimeReason(manifest: PahPluginManifest) {
  if (manifest.migrations.length > 0) return '品牌插件不得声明 DDL 迁移';
  if (manifest.dataOwnership.tables.length > 0) {
    return '品牌插件不得声明业务数据表';
  }
  if (manifest.healthChecks.length > 0) {
    return '品牌插件不得声明运行时 health check';
  }
  if (manifest.capabilities.some(item => (item.endpoints?.length || 0) > 0)) {
    return '品牌插件 capability 不得声明 API endpoint';
  }
  return null;
}

function developmentItem(
  moduleId: string,
  modulePath: string
): PhoenixPluginStartupItem {
  const base: PhoenixPluginStartupItem = {
    moduleId,
    origin: 'development',
    state: 'quarantined',
    detail: '开发挂载尚未完成校验',
    nodeSource: modulePath,
  };
  try {
    const nodeSource = safeRealDirectory(modulePath);
    if (!nodeSource) return { ...base, detail: 'Node symlink 目标不存在' };
    const productRootValue = gitValue(nodeSource, [
      'rev-parse',
      '--show-toplevel',
    ]);
    const productRoot = productRootValue
      ? safeRealDirectory(productRootValue)
      : null;
    if (!productRoot) {
      return {
        ...base,
        nodeSource,
        detail: '开发挂载不属于可验证的 Git 产品仓',
      };
    }
    const sourceCommit = gitValue(productRoot, ['rev-parse', 'HEAD']);
    if (!sourceCommit || !COMMIT_PATTERN.test(sourceCommit)) {
      return { ...base, nodeSource, productRoot, detail: '产品 HEAD 无法验证' };
    }
    const packageRoot = path.resolve(nodeSource, '..', '..');
    const manifestFile = path.join(packageRoot, 'manifest.json');
    const webSourceValue = path.join(packageRoot, 'vue', moduleId);
    const webSource = safeRealDirectory(webSourceValue);
    if (
      !inside(productRoot, packageRoot) ||
      !inside(productRoot, nodeSource) ||
      !webSource ||
      !inside(productRoot, webSource)
    ) {
      return {
        ...base,
        nodeSource,
        productRoot,
        sourceCommit,
        detail: '开发挂载双端 payload 越出同一产品 Git 根',
      };
    }
    const parsed = parseManifest(manifestFile);
    if (!parsed.manifest || !parsed.bytes) {
      return {
        ...base,
        nodeSource,
        webSource,
        productRoot,
        sourceCommit,
        manifestFile,
        detail: parsed.detail,
      };
    }
    const manifest = parsed.manifest;
    if (
      manifest.moduleId !== moduleId ||
      manifest.entrypoints.node !== `midway/${moduleId}/config.ts` ||
      manifest.entrypoints.web !== `vue/${moduleId}/config.ts`
    ) {
      return {
        ...base,
        nodeSource,
        webSource,
        productRoot,
        sourceCommit,
        manifestFile,
        pluginType: manifest.pluginType,
        manifest,
        detail: 'manifest 身份或双端入口与实际 symlink 不一致',
      };
    }
    if (manifest.pluginType === 'phoenix.admin.branding') {
      const unsafeReason = unsafeBrandingRuntimeReason(manifest);
      if (unsafeReason) {
        return {
          ...base,
          nodeSource,
          webSource,
          productRoot,
          sourceCommit,
          manifestFile,
          pluginType: manifest.pluginType,
          manifest,
          detail: unsafeReason,
        };
      }
    }
    if (
      !existsSync(path.join(nodeSource, 'config.ts')) ||
      !existsSync(path.join(webSource, 'config.ts'))
    ) {
      return {
        ...base,
        nodeSource,
        webSource,
        productRoot,
        sourceCommit,
        manifestFile,
        pluginType: manifest.pluginType,
        manifest,
        detail: '开发挂载缺少 Node/Vue config.ts 入口',
      };
    }
    const relativePaths = [
      path.relative(productRoot, manifestFile),
      path.relative(productRoot, nodeSource),
      path.relative(productRoot, webSource),
    ];
    const dirty = gitValue(productRoot, [
      'status',
      '--porcelain',
      '--',
      ...relativePaths,
    ]);
    if (dirty === null || dirty.length > 0) {
      return {
        ...base,
        nodeSource,
        webSource,
        productRoot,
        sourceCommit,
        manifestFile,
        pluginType: manifest.pluginType,
        manifest,
        detail: '开发挂载 manifest 或双端 payload 存在未归档修改',
      };
    }
    const identity = developmentIdentity(sourceCommit, parsed.bytes, manifest);
    return {
      ...base,
      state:
        manifest.pluginType === 'phoenix.admin.branding'
          ? 'ready'
          : 'action-required',
      detail:
        manifest.pluginType === 'phoenix.admin.branding'
          ? '品牌开发挂载通过安全审查，可发布只读登录预览'
          : `开发挂载已验证；安装记录${
              manifest.migrations.length ? '与 DDL 迁移' : ''
            }仍需管理员处理`,
      pluginType: manifest.pluginType,
      manifest,
      manifestFile,
      productRoot,
      sourceCommit,
      sourceIdentitySha256: identity,
      webSource,
      nodeSource,
    };
  } catch {
    return { ...base, detail: '开发挂载文件系统状态不完整' };
  }
}

export function inspectPhoenixPluginModules(
  hostRoot = process.cwd(),
  operations: {
    readdir: (directory: string) => string[];
    lstat: (value: string) => ReturnType<typeof lstatSync>;
  } = { readdir: directory => readdirSync(directory), lstat: lstatSync }
) {
  const modulesRoot = path.join(hostRoot, 'src', 'modules');
  const plugins: PhoenixPluginStartupItem[] = [];
  if (existsSync(modulesRoot)) {
    let moduleIds: string[] = [];
    try {
      moduleIds = operations.readdir(modulesRoot).sort();
    } catch {
      return { plugins: [], ignoredModuleIds: [], ignoredDetectorPatterns: [] };
    }
    for (const moduleId of moduleIds) {
      if (HOST_MODULE_IDS.has(moduleId) || !MODULE_ID_PATTERN.test(moduleId)) {
        continue;
      }
      const modulePath = path.join(modulesRoot, moduleId);
      try {
        const stat = operations.lstat(modulePath);
        if (stat.isSymbolicLink()) {
          plugins.push(developmentItem(moduleId, modulePath));
        } else if (stat.isDirectory()) {
          const activation = inspectPahPluginActivation(
            hostRoot,
            moduleId,
            'node',
            modulePath
          );
          if ('detail' in activation) {
            plugins.push({
              moduleId,
              origin: 'release',
              state: 'quarantined',
              detail: `${activation.detail}，已隔离`,
              nodeSource: modulePath,
            });
          } else {
            plugins.push({
              moduleId,
              origin: 'release',
              state: 'ready',
              detail: `Host 激活收据已验证：${activation.receipt.version}`,
              ...(activation.receipt.pluginType
                ? { pluginType: activation.receipt.pluginType }
                : {}),
              activationVersion: activation.receipt.version,
              activationManifestSha256: activation.receipt.manifestSha256,
              nodeSource: modulePath,
            });
          }
        }
      } catch {
        plugins.push({
          moduleId,
          origin: 'development',
          state: 'quarantined',
          detail: '模块目录在扫描期间发生变化，已隔离',
          nodeSource: modulePath,
        });
      }
    }
  }
  const developmentBranding = plugins.filter(
    item =>
      item.origin === 'development' &&
      item.pluginType === 'phoenix.admin.branding'
  );
  if (developmentBranding.length > 1) {
    for (const item of developmentBranding) {
      item.state = 'quarantined';
      item.detail = '同时发现多个开发品牌插件，拒绝隐式选择';
    }
  }
  plugins.sort((left, right) => left.moduleId.localeCompare(right.moduleId));
  const ignoredModuleIds = plugins
    .filter(
      item =>
        item.state === 'quarantined' ||
        item.pluginType === 'phoenix.admin.branding'
    )
    .map(item => item.moduleId);
  return {
    plugins,
    ignoredModuleIds,
    ignoredDetectorPatterns: ignoredModuleIds.map(
      moduleId => `**/modules/${moduleId}/**`
    ),
  } satisfies PhoenixPluginStartupInspection;
}

function overallState(items: PhoenixPluginStartupItem[]) {
  if (items.some(item => item.state === 'quarantined')) return 'quarantined';
  if (items.some(item => item.state === 'action-required')) {
    return 'action-required';
  }
  return 'ready';
}

@Provide()
export class PhoenixPluginStartupHealthService {
  @InjectEntityModel(PahPluginInstallationEntity)
  pluginInstallationEntity: Repository<PahPluginInstallationEntity>;

  @InjectEntityModel(PahPluginMigrationRecordEntity)
  pluginMigrationRecordEntity: Repository<PahPluginMigrationRecordEntity>;

  @Inject()
  pahPublicLoginBrandingService: PahPublicLoginBrandingService;

  @Logger()
  logger: ILogger;

  async inspectOnStartup(hostRoot = process.cwd()) {
    const report = inspectPhoenixPluginModules(hostRoot);
    this.logger.info(
      `[phoenix-plugin-health] inspect source=src/modules discovered=${report.plugins.length}`
    );

    const developmentBranding = report.plugins.filter(
      item =>
        item.origin === 'development' &&
        item.pluginType === 'phoenix.admin.branding'
    );
    const readyDevelopmentBranding = developmentBranding.filter(
      item =>
        item.state === 'ready' &&
        item.manifest &&
        item.webSource &&
        item.sourceIdentitySha256
    );
    if (process.env.NODE_ENV === 'local' && developmentBranding.length > 0) {
      if (readyDevelopmentBranding.length === 1) {
        const item = readyDevelopmentBranding[0];
        try {
          this.pahPublicLoginBrandingService.publishDevelopmentPreview(
            item.manifest!,
            item.sourceIdentitySha256!,
            item.webSource!
          );
          item.detail = '品牌开发预览已发布；未写安装表或迁移台账';
        } catch {
          item.state = 'quarantined';
          item.detail = '品牌资源或快照发布失败，已回退 Host 默认品牌';
          this.pahPublicLoginBrandingService.publishDevelopmentFallback();
        }
      } else {
        this.pahPublicLoginBrandingService.publishDevelopmentFallback();
      }
    }

    for (const item of report.plugins.filter(
      plugin =>
        !(
          plugin.origin === 'development' &&
          plugin.pluginType === 'phoenix.admin.branding'
        )
    )) {
      try {
        const installation = await this.pluginInstallationEntity.findOne({
          where: { moduleId: Equal(item.moduleId) },
        });
        if (!installation) {
          item.state = 'action-required';
          item.detail = '正式 payload 尚未登记，需管理员完成插件生命周期';
          continue;
        }
        const validation = validatePhoenixPluginManifest(installation.manifest);
        if (
          !validation.valid ||
          installation.manifest.moduleId !== item.moduleId
        ) {
          item.state = 'quarantined';
          item.detail = '正式安装记录的 manifest 无效或身份不匹配';
          continue;
        }
        const expectedManifestSha256 = pahPluginManifestSha256(
          installation.manifest
        );
        if (item.origin === 'development') {
          if (
            !item.manifest ||
            item.manifest.version !== installation.version ||
            pahPluginManifestSha256(item.manifest) !== expectedManifestSha256
          ) {
            item.state = 'action-required';
            item.detail = '开发挂载 manifest 与当前安装记录不匹配';
            continue;
          }
          const activations = [
            inspectPahPluginActivation(
              hostRoot,
              item.moduleId,
              'node',
              item.nodeSource
            ),
            inspectPahPluginActivation(
              hostRoot,
              item.moduleId,
              'vue',
              item.webSource!
            ),
          ];
          const invalid = activations.find(
            (activation): activation is { valid: false; detail: string } =>
              activation.valid === false
          );
          if (invalid) {
            item.state = 'action-required';
            item.detail = `${invalid.detail}；需经不可变包验证并受控重启`;
            continue;
          }
          const receipt = activations[0].valid ? activations[0].receipt : null;
          item.activationVersion = receipt?.version;
          item.activationManifestSha256 = receipt?.manifestSha256;
        }
        if (
          item.activationVersion !== installation.version ||
          item.activationManifestSha256 !== expectedManifestSha256
        ) {
          item.state =
            item.origin === 'development' ? 'action-required' : 'quarantined';
          item.detail = 'Host 激活收据与当前安装记录不匹配';
          continue;
        }
        item.pluginType = installation.manifest.pluginType;
        item.manifest = installation.manifest;
        if (installation.state !== 'enabled') {
          item.state = 'action-required';
          item.detail = `正式插件状态为 ${installation.state}，未启用`;
          continue;
        }
        const records = await this.pluginMigrationRecordEntity.find({
          where: { moduleId: Equal(item.moduleId) },
        });
        const migrationsReady = installation.manifest.migrations.every(
          migration =>
            records.some(
              row =>
                row.migrationId === migration.id &&
                row.version === migration.version &&
                row.checksum === migration.checksum &&
                row.state === 'applied'
            )
        );
        if (!migrationsReady) {
          item.state = 'action-required';
          item.detail = '正式插件存在未应用或不匹配的迁移，未自动执行 DDL';
          continue;
        }
        if (item.pluginType === 'phoenix.admin.branding') {
          this.pahPublicLoginBrandingService.assertInstalledBrandingReady(
            installation
          );
        }
        item.state = 'ready';
        item.detail = `Host 激活收据、安装记录与迁移台账 ${installation.manifest.migrations.length}/${installation.manifest.migrations.length} 已就绪`;
      } catch {
        item.state = 'quarantined';
        item.detail = '正式插件快速健康检查失败，Host 继续运行';
      }
    }

    for (const item of report.plugins) {
      const log = `[phoenix-plugin-health] module=${item.moduleId} origin=${item.origin} state=${item.state} detail=${item.detail}`;
      if (item.state === 'quarantined') this.logger.error(log);
      else if (item.state === 'action-required') this.logger.warn(log);
      else this.logger.info(log);
    }
    const result: PhoenixPluginStartupHealthResult = {
      state: overallState(report.plugins),
      plugins: report.plugins.map(item => ({
        moduleId: item.moduleId,
        origin: item.origin,
        state: item.state,
        detail: item.detail,
        ...(item.pluginType ? { pluginType: item.pluginType } : {}),
        ...(item.activationVersion
          ? { version: item.activationVersion }
          : item.manifest?.version
          ? { version: item.manifest.version }
          : {}),
        ...(item.activationManifestSha256
          ? { manifestSha256: item.activationManifestSha256 }
          : {}),
      })),
    };
    this.writeStatus(hostRoot, result);
    return result;
  }

  private writeStatus(
    hostRoot: string,
    result: PhoenixPluginStartupHealthResult
  ) {
    const file = path.join(hostRoot, '.runtime', 'pah-plugin-health.json');
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(
      temporary,
      `${JSON.stringify(
        { formatVersion: 1, checkedAt: new Date().toISOString(), ...result },
        null,
        2
      )}\n`,
      { mode: 0o600 }
    );
    renameSync(temporary, file);
  }
}
