import { BaseService, CoolCommException } from '@cool-midway/core';
import { Context } from '@midwayjs/koa';
import { ILogger, Inject, Logger, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import * as path from 'path';
import { Equal, Repository } from 'typeorm';
import { BaseSysParamEntity } from '../../base/entity/sys/param';
import { PahPluginInstallationEntity } from '../entity/plugin';
import {
  PahPublicBrandContributionV1,
  PahPublicLoginBrandingAssetDeclaration,
  PahPublicLoginBrandingSnapshot,
  PahPublicLoginBrandingSnapshotAssetV1,
  PahPublicLoginBrandingSnapshotV2,
  serializePahPublicLoginBrandingBootstrap,
  validatePahPublicLoginBrandingSnapshot,
  withPahPublicLoginBrandingRevision,
} from '../interface/public-login-branding';
import {
  PahPluginManifest,
  validatePhoenixPluginManifest,
} from '../interface/plugin';

const SELECTION_KEY = 'pah.public-login-branding.selection';
const HOST_WORKBENCH_CONFIG_KEY = 'pah.workbench-branding.host-default';
const RUNTIME_FORMAT_VERSION = 1 as const;
const ASSET_NAMES = [
  'favicon',
  'logo',
  'logoDark',
  'compactLogo',
  'compactLogoDark',
  'background',
] as const;

type AssetName = (typeof ASSET_NAMES)[number];

interface BrandingReceiptV1 {
  formatVersion: 1;
  moduleId: string;
  version: string;
  packageSha256: string;
  assets: Partial<Record<AssetName, PahPublicLoginBrandingAssetDeclaration>>;
}

interface BrandingSelectionV1 {
  schemaVersion: 1;
  revision: string;
  moduleId: string | null;
  version: string | null;
  packageSha256: string | null;
}

interface HostWorkbenchBrandingConfigV1 {
  schemaVersion: 1;
  revision: string;
  title: string;
  subtitle: { mode: 'web-origin' } | { mode: 'text'; text: string };
  logo: PahPublicLoginBrandingSnapshotAssetV1;
  logoDark: PahPublicLoginBrandingSnapshotAssetV1;
}

interface WorkbenchBrandingUpload {
  data?: string;
  filename?: string;
}

export interface PahHostWorkbenchBrandingInput {
  title: unknown;
  subtitleMode: unknown;
  subtitleText?: unknown;
  expectedRevision: unknown;
}

function sha256(content: Buffer | string) {
  return createHash('sha256').update(content).digest('hex');
}

function isSafePublicText(value: unknown, max: number) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= max &&
    value === value.normalize('NFC') &&
    !/[<>\u0000-\u001f\u007f]/.test(value)
  );
}

function workbenchConfigRevision(
  value: Omit<HostWorkbenchBrandingConfigV1, 'revision'>
) {
  return sha256(JSON.stringify(value));
}

function withWorkbenchConfigRevision(
  value: Omit<HostWorkbenchBrandingConfigV1, 'revision'>
): HostWorkbenchBrandingConfigV1 {
  return { ...value, revision: workbenchConfigRevision(value) };
}

function isWorkbenchConfig(
  value: unknown
): value is HostWorkbenchBrandingConfigV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, any>;
  const validAsset = (asset: unknown) => {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset))
      return false;
    const item = asset as Record<string, unknown>;
    return (
      Object.keys(item).every(key =>
        ['url', 'sha256', 'mime', 'size'].includes(key)
      ) &&
      typeof item.url === 'string' &&
      item.url.length > 0 &&
      item.url.length <= 300 &&
      !item.url.includes('\\') &&
      !item.url.includes('..') &&
      !/^(?:[a-z]+:)?\/\//i.test(item.url) &&
      typeof item.sha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(item.sha256) &&
      (item.url === '/pah-phoenixwing-mark.svg' ||
        new RegExp(
          `^public-login-branding/assets/${item.sha256}/[a-zA-Z0-9._-]+\\.svg$`
        ).test(item.url)) &&
      item.mime === 'image/svg+xml' &&
      Number.isSafeInteger(item.size) &&
      Number(item.size) > 0 &&
      Number(item.size) <= 256 * 1024
    );
  };
  if (
    Object.keys(input).some(
      key =>
        ![
          'schemaVersion',
          'revision',
          'title',
          'subtitle',
          'logo',
          'logoDark',
        ].includes(key)
    ) ||
    input.schemaVersion !== 1 ||
    typeof input.revision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.revision) ||
    !isSafePublicText(input.title, 80) ||
    input.title.includes('%s') ||
    !input.subtitle ||
    typeof input.subtitle !== 'object' ||
    Array.isArray(input.subtitle) ||
    !validAsset(input.logo) ||
    !validAsset(input.logoDark)
  ) {
    return false;
  }
  if (input.subtitle.mode === 'web-origin') {
    if (Object.keys(input.subtitle).some(key => key !== 'mode')) return false;
  } else if (input.subtitle.mode === 'text') {
    if (
      Object.keys(input.subtitle).some(
        key => !['mode', 'text'].includes(key)
      ) ||
      !isSafePublicText(input.subtitle.text, 160)
    ) {
      return false;
    }
  } else {
    return false;
  }
  const { revision, ...withoutRevision } =
    input as HostWorkbenchBrandingConfigV1;
  return revision === workbenchConfigRevision(withoutRevision);
}

function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function safeSegment(value: string, label: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
    throw new CoolCommException(`${label} 不安全`);
  }
  return value;
}

function assertNoSymlink(root: string, file: string) {
  const relative = path.relative(root, file);
  if (!inside(root, file) || !relative || path.isAbsolute(relative)) {
    throw new CoolCommException('品牌资源越出已安装插件目录');
  }
  let cursor = root;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    if (lstatSync(cursor).isSymbolicLink()) {
      throw new CoolCommException(`品牌资源不得经过符号链接：${relative}`);
    }
  }
}

function validateSvg(content: Buffer, label: string) {
  const value = content.toString('utf8');
  if (
    !/^\s*<svg(?:\s|>)/i.test(value) ||
    /<(?:script|foreignObject|iframe|object|embed|audio|video)\b/i.test(
      value
    ) ||
    /\son[a-z]+\s*=/i.test(value) ||
    /\b(?:href|src)\s*=/i.test(value) ||
    /@import\b|url\s*\(/i.test(value)
  ) {
    throw new CoolCommException(`${label} 包含活动内容或外链`);
  }
}

function writeExclusive(file: string, content: Buffer | string) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(file, content, { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = readFileSync(file);
    const expected = Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (!existing.equals(expected)) {
      throw new CoolCommException(`不可变品牌制品冲突：${file}`);
    }
    return false;
  }
}

function atomicReplace(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}-${randomUUID()}.tmp`
  );
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, content, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, file);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

function isSelection(value: unknown): value is BrandingSelectionV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    input.schemaVersion === 1 &&
    typeof input.revision === 'string' &&
    /^[a-f0-9]{64}$/.test(input.revision) &&
    (input.moduleId === null ||
      (typeof input.moduleId === 'string' &&
        /^[a-z][a-z0-9-]*$/.test(input.moduleId))) &&
    (input.version === null || typeof input.version === 'string') &&
    (input.packageSha256 === null ||
      (typeof input.packageSha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(input.packageSha256)))
  );
}

@Provide()
export class PahPublicLoginBrandingService extends BaseService {
  @Inject()
  ctx: Context;

  @InjectEntityModel(PahPluginInstallationEntity)
  pluginInstallationEntity: Repository<PahPluginInstallationEntity>;

  @InjectEntityModel(BaseSysParamEntity)
  baseSysParamEntity: Repository<BaseSysParamEntity>;

  @Logger()
  logger: ILogger;

  private hostWorkbenchConfigCache?: HostWorkbenchBrandingConfigV1;

  private developmentPreview?: {
    manifest: PahPluginManifest;
    sourceIdentitySha256: string;
    assets: Partial<Record<AssetName, PahPublicLoginBrandingAssetDeclaration>>;
  };

  private runtimeRoot() {
    return path.resolve(
      process.env.PAH_PUBLIC_LOGIN_BRANDING_ROOT ||
        path.join(process.cwd(), '.runtime', 'pah-public-login-branding')
    );
  }

  private currentFile() {
    return path.join(this.runtimeRoot(), 'current.json');
  }

  private receiptFile(
    moduleId: string,
    version: string,
    packageSha256: string
  ) {
    return path.join(
      this.runtimeRoot(),
      'receipts',
      safeSegment(moduleId, 'moduleId'),
      safeSegment(version, 'version'),
      `${safeSegment(packageSha256, 'packageSha256')}.json`
    );
  }

  private defaultAsset(): PahPublicLoginBrandingSnapshotAssetV1 {
    const source = path.join(
      process.cwd(),
      'public',
      'pah-phoenixwing-mark.svg'
    );
    const content = readFileSync(source);
    return {
      url: '/pah-phoenixwing-mark.svg',
      sha256: sha256(content),
      mime: 'image/svg+xml',
      size: content.length,
    };
  }

  private builtinWorkbenchConfig() {
    const mark = this.defaultAsset();
    return withWorkbenchConfigRevision({
      schemaVersion: 1,
      title: 'Phoenix Admin',
      subtitle: { mode: 'web-origin' },
      logo: mark,
      logoDark: mark,
    });
  }

  private currentHostWorkbenchConfig() {
    return this.hostWorkbenchConfigCache || this.builtinWorkbenchConfig();
  }

  private assertHostWorkbenchAssets(config: HostWorkbenchBrandingConfigV1) {
    const builtIn = this.defaultAsset();
    for (const asset of [config.logo, config.logoDark]) {
      if (asset.url === builtIn.url) {
        if (JSON.stringify(asset) !== JSON.stringify(builtIn)) {
          throw new CoolCommException('Host 内置工作台 Logo 收据不匹配');
        }
        continue;
      }
      const match = asset.url.match(
        /^public-login-branding\/assets\/([a-f0-9]{64})\/([a-zA-Z0-9._-]+\.svg)$/
      );
      if (!match) throw new CoolCommException('工作台 Logo 路径不合法');
      const stored = this.readPublicAsset(match[1], match[2]);
      if (
        stored.mime !== asset.mime ||
        stored.content.length !== asset.size ||
        sha256(stored.content) !== asset.sha256
      ) {
        throw new CoolCommException('工作台 Logo 收据与静态资源不匹配');
      }
    }
  }

  private assertSnapshotAssets(snapshot: PahPublicLoginBrandingSnapshot) {
    const assets = [
      snapshot.favicon,
      snapshot.assets.logo,
      snapshot.assets.logoDark,
      snapshot.assets.compactLogo,
      snapshot.assets.compactLogoDark,
      snapshot.assets.background,
      ...('workbench' in snapshot
        ? [snapshot.workbench.logo, snapshot.workbench.logoDark]
        : []),
    ].filter(Boolean) as PahPublicLoginBrandingSnapshotAssetV1[];
    const builtIn = this.defaultAsset();
    const checked = new Set<string>();
    for (const asset of assets) {
      const identity = JSON.stringify(asset);
      if (checked.has(identity)) continue;
      checked.add(identity);
      if (asset.url === builtIn.url) {
        if (identity !== JSON.stringify(builtIn)) {
          throw new CoolCommException('Host 内置品牌资源收据不匹配');
        }
        continue;
      }
      const match = asset.url.match(
        /^public-login-branding\/assets\/([a-f0-9]{64})\/([a-zA-Z0-9._-]+)$/
      );
      if (!match || match[1] !== asset.sha256) {
        throw new CoolCommException('公开品牌资源路径与 SHA 不匹配');
      }
      const stored = this.readPublicAsset(match[1], match[2]);
      if (
        stored.mime !== asset.mime ||
        stored.content.length !== asset.size ||
        sha256(stored.content) !== asset.sha256
      ) {
        throw new CoolCommException('公开品牌资源收据与静态资源不匹配');
      }
    }
  }

  private async loadHostWorkbenchConfig() {
    const row = await this.baseSysParamEntity.findOneBy({
      keyName: HOST_WORKBENCH_CONFIG_KEY,
    });
    if (!row) {
      this.hostWorkbenchConfigCache = this.builtinWorkbenchConfig();
      return this.hostWorkbenchConfigCache;
    }
    try {
      const value = JSON.parse(row.data);
      if (isWorkbenchConfig(value)) {
        this.assertHostWorkbenchAssets(value);
        this.hostWorkbenchConfigCache = value;
        return value;
      }
    } catch {}
    this.hostWorkbenchConfigCache = this.builtinWorkbenchConfig();
    this.logger?.warn(
      '[public-login-branding] invalid Host workbench config; use built-in default'
    );
    return this.hostWorkbenchConfigCache;
  }

  hostDefaultSnapshot(): PahPublicLoginBrandingSnapshotV2 {
    let workbench = this.currentHostWorkbenchConfig();
    try {
      this.assertHostWorkbenchAssets(workbench);
    } catch {
      workbench = this.builtinWorkbenchConfig();
      this.logger?.warn(
        '[public-login-branding] Host workbench asset invalid; use built-in default'
      );
    }
    const loginSubtitle =
      workbench.subtitle.mode === 'text'
        ? workbench.subtitle.text
        : '面向团队协作与业务管理的统一工作台。';
    return withPahPublicLoginBrandingRevision({
      schemaVersion: 2,
      mode: 'host-default',
      plugin: null,
      appName: workbench.title,
      titleTemplate: `%s · ${workbench.title}`,
      favicon: workbench.logo,
      login: {
        eyebrow: 'PHOENIXWING OPEN SOURCE',
        title: workbench.title,
        subtitle: loginSubtitle,
        prompt: `登录 ${workbench.title}，继续管理您的工作区。`,
        presentation: 'split',
      },
      assets: {
        logo: workbench.logo,
        logoDark: workbench.logoDark,
        compactLogo: workbench.logo,
        compactLogoDark: workbench.logoDark,
      },
      workbench: {
        title: workbench.title,
        subtitle: workbench.subtitle,
        logo: workbench.logo,
        logoDark: workbench.logoDark,
      },
    });
  }

  async reconcileOnStartup() {
    mkdirSync(this.runtimeRoot(), { recursive: true, mode: 0o700 });
    await this.loadHostWorkbenchConfig();
    if (process.env.PAH_SAFE_MODE === 'true') {
      this.publishSnapshot(this.hostDefaultSnapshot());
      return;
    }
    const selection = await this.readSelection();
    try {
      const snapshot = await this.snapshotForSelection(selection);
      if (selection && selection.revision !== snapshot.revision) {
        await this.replaceSelection(snapshot, selection.revision);
      } else {
        this.publishSnapshot(snapshot);
      }
    } catch (error) {
      const current = this.readCurrentSnapshot();
      if (
        current?.mode === 'plugin' &&
        current.plugin?.moduleId === selection?.moduleId &&
        current.plugin.version === selection?.version &&
        current.plugin.packageSha256 === selection?.packageSha256
      ) {
        this.logger.warn(
          `[public-login-branding] candidate reconcile failed; keep last-known-good module=${selection?.moduleId}`
        );
        return;
      }
      const fallback = this.hostDefaultSnapshot();
      if (selection?.moduleId) {
        try {
          await this.replaceSelection(fallback, selection.revision);
        } catch {
          this.publishSnapshot(fallback);
        }
      } else {
        this.publishSnapshot(fallback);
      }
      this.logger.error(
        `[public-login-branding] selection invalid; fallback to Host default: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  bootstrapScript() {
    return serializePahPublicLoginBrandingBootstrap(
      this.readCurrentSnapshot() || this.hostDefaultSnapshot()
    );
  }

  currentStatus() {
    return this.readCurrentSnapshot() || this.hostDefaultSnapshot();
  }

  async hostWorkbenchBrandingStatus() {
    this.requireHostAdmin();
    const config = await this.loadHostWorkbenchConfig();
    return {
      config,
      activeSnapshot: this.currentStatus(),
    };
  }

  async saveHostWorkbenchBranding(
    input: PahHostWorkbenchBrandingInput,
    upload?: WorkbenchBrandingUpload
  ) {
    this.requireHostAdmin();
    const current = await this.loadHostWorkbenchConfig();
    if (input.expectedRevision !== current.revision) {
      throw new CoolCommException('工作台品牌配置已变化，请刷新后重试');
    }
    const title =
      typeof input.title === 'string'
        ? input.title.trim().normalize('NFC')
        : '';
    if (!isSafePublicText(title, 80)) {
      throw new CoolCommException('工作台主标题必须是 1～80 字安全文本');
    }
    if (title.includes('%s')) {
      throw new CoolCommException('工作台主标题不得包含标题模板占位符 %s');
    }
    const subtitle = this.parseWorkbenchSubtitle(
      input.subtitleMode,
      input.subtitleText
    );
    const logo = upload?.data
      ? this.storeHostWorkbenchLogo(upload)
      : current.logo;
    const next = withWorkbenchConfigRevision({
      schemaVersion: 1,
      title,
      subtitle,
      logo,
      logoDark: logo,
    });
    return this.persistHostWorkbenchConfig(current, next);
  }

  async resetHostWorkbenchBranding(expectedRevision: unknown) {
    this.requireHostAdmin();
    const current = await this.loadHostWorkbenchConfig();
    if (expectedRevision !== current.revision) {
      throw new CoolCommException('工作台品牌配置已变化，请刷新后重试');
    }
    return this.persistHostWorkbenchConfig(
      current,
      this.builtinWorkbenchConfig()
    );
  }

  private parseWorkbenchSubtitle(
    mode: unknown,
    text: unknown
  ): HostWorkbenchBrandingConfigV1['subtitle'] {
    if (mode === 'web-origin') return { mode };
    if (mode !== 'text') {
      throw new CoolCommException('工作台副标题模式不受支持');
    }
    const normalized =
      typeof text === 'string' ? text.trim().normalize('NFC') : '';
    if (!isSafePublicText(normalized, 160)) {
      throw new CoolCommException('工作台副标题必须是 1～160 字安全文本');
    }
    return { mode, text: normalized };
  }

  private storeHostWorkbenchLogo(
    upload: WorkbenchBrandingUpload
  ): PahPublicLoginBrandingSnapshotAssetV1 {
    if (!upload.data || !upload.filename) {
      throw new CoolCommException('工作台 Logo 上传不完整');
    }
    if (path.extname(path.basename(upload.filename)).toLowerCase() !== '.svg') {
      throw new CoolCommException('工作台 Logo 只接受 SVG 文件');
    }
    const uploadStat = lstatSync(upload.data);
    if (uploadStat.isSymbolicLink() || !uploadStat.isFile()) {
      throw new CoolCommException('工作台 Logo 必须是普通文件');
    }
    const content = readFileSync(upload.data);
    if (content.length === 0 || content.length > 256 * 1024) {
      throw new CoolCommException('工作台 Logo 必须在 1B～256KiB 之间');
    }
    validateSvg(content, '工作台 Logo');
    const digest = sha256(content);
    const filename = 'workbench-logo.svg';
    const assetDirectory = path.join(this.runtimeRoot(), 'assets', digest);
    writeExclusive(path.join(assetDirectory, filename), content);
    writeExclusive(
      path.join(assetDirectory, `${filename}.json`),
      JSON.stringify({
        sha256: digest,
        mime: 'image/svg+xml',
        size: content.length,
      })
    );
    return {
      url: `public-login-branding/assets/${digest}/${filename}`,
      sha256: digest,
      mime: 'image/svg+xml',
      size: content.length,
    };
  }

  private async persistHostWorkbenchConfig(
    current: HostWorkbenchBrandingConfigV1,
    next: HostWorkbenchBrandingConfigV1
  ) {
    const storedBefore = this.readCurrentSnapshot();
    const publicBefore = storedBefore || this.hostDefaultSnapshot();
    if (!storedBefore) this.publishSnapshot(publicBefore);
    const row = await this.baseSysParamEntity.findOneBy({
      keyName: HOST_WORKBENCH_CONFIG_KEY,
    });
    if (row) {
      try {
        const authoritative = JSON.parse(row.data);
        if (
          isWorkbenchConfig(authoritative) &&
          authoritative.revision !== current.revision
        ) {
          this.hostWorkbenchConfigCache = authoritative;
          throw new CoolCommException('工作台品牌配置已被其他管理员修改');
        }
      } catch (error) {
        if (error instanceof CoolCommException) throw error;
      }
    } else if (current.revision !== this.builtinWorkbenchConfig().revision) {
      this.hostWorkbenchConfigCache = this.builtinWorkbenchConfig();
      throw new CoolCommException('工作台品牌配置已被其他管理员修改');
    }

    try {
      if (row) {
        const result = await this.baseSysParamEntity.update(
          { id: row.id, data: row.data },
          { data: JSON.stringify(next) }
        );
        if (result.affected !== 1) {
          throw new CoolCommException('工作台品牌配置已被其他管理员修改');
        }
      } else {
        await this.baseSysParamEntity.insert({
          keyName: HOST_WORKBENCH_CONFIG_KEY,
          name: 'Host Workbench Branding',
          data: JSON.stringify(next),
          dataType: 0,
          remark: 'Host-owned workbench branding configuration',
        });
      }
    } catch (error) {
      await this.loadHostWorkbenchConfig();
      throw error;
    }

    this.hostWorkbenchConfigCache = next;
    const selection = await this.readSelection();
    if (!selection?.moduleId && publicBefore.mode === 'host-default') {
      await this.replaceSelection(
        this.hostDefaultSnapshot(),
        selection?.revision || publicBefore.revision
      );
    }
    this.logger?.info(
      `[public-login-branding] Host workbench config updated revision=${next.revision}`
    );
    return {
      config: next,
      activeSnapshot: this.currentStatus(),
    };
  }

  readPublicAsset(digest: string, filename: string) {
    safeSegment(digest, '资源 SHA');
    safeSegment(filename, '资源文件名');
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      throw new CoolCommException('品牌资源 SHA 不合法');
    }
    const metadataFile = path.join(
      this.runtimeRoot(),
      'assets',
      digest,
      `${filename}.json`
    );
    const contentFile = path.join(
      this.runtimeRoot(),
      'assets',
      digest,
      filename
    );
    if (!existsSync(metadataFile) || !existsSync(contentFile)) {
      throw new CoolCommException('品牌资源不存在');
    }
    const metadata = JSON.parse(readFileSync(metadataFile, 'utf8')) as {
      sha256: string;
      mime: string;
      size: number;
    };
    const content = readFileSync(contentFile);
    if (
      metadata.sha256 !== digest ||
      metadata.size !== content.length ||
      sha256(content) !== digest
    ) {
      throw new CoolCommException('品牌资源完整性校验失败');
    }
    return { content, mime: metadata.mime };
  }

  recordVerifiedPackage(
    manifest: PahPluginManifest,
    packageSha256: string,
    vueModuleRoot: string
  ) {
    const contribution = manifest.uiContributions;
    if (!contribution?.login || !contribution.brand) return { recorded: false };
    const assets = this.storeBrandAssets(manifest, vueModuleRoot);
    const receipt: BrandingReceiptV1 = {
      formatVersion: RUNTIME_FORMAT_VERSION,
      moduleId: manifest.moduleId,
      version: manifest.version,
      packageSha256,
      assets,
    };
    const receiptCreated = writeExclusive(
      this.receiptFile(manifest.moduleId, manifest.version, packageSha256),
      JSON.stringify(receipt)
    );
    return { recorded: true, receiptCreated, receipt };
  }

  publishDevelopmentPreview(
    manifest: PahPluginManifest,
    sourceIdentitySha256: string,
    vueModuleRoot: string
  ) {
    if (process.env.NODE_ENV !== 'local') {
      throw new CoolCommException('品牌开发预览只允许 local 环境');
    }
    if (!/^[a-f0-9]{64}$/.test(sourceIdentitySha256)) {
      throw new CoolCommException('品牌开发挂载源码身份不合法');
    }
    const validation = validatePhoenixPluginManifest(manifest);
    if (!validation.valid) {
      throw new CoolCommException(validation.errors.join('；'));
    }
    if (
      manifest.pluginType !== 'phoenix.admin.branding' ||
      !manifest.uiContributions?.login ||
      !manifest.uiContributions.brand
    ) {
      throw new CoolCommException('开发预览插件未声明公开登录品牌贡献');
    }
    const assets = this.storeBrandAssets(manifest, vueModuleRoot);
    const snapshot = this.compileManifestSnapshot(
      manifest,
      sourceIdentitySha256,
      assets
    );
    this.publishSnapshot(snapshot);
    this.developmentPreview = {
      manifest,
      sourceIdentitySha256,
      assets,
    };
    return snapshot;
  }

  publishDevelopmentFallback() {
    if (process.env.NODE_ENV !== 'local') {
      throw new CoolCommException('品牌开发回退只允许 local 环境');
    }
    this.developmentPreview = undefined;
    const snapshot = this.hostDefaultSnapshot();
    this.publishSnapshot(snapshot);
    return snapshot;
  }

  assertInstalledBrandingReady(plugin: PahPluginInstallationEntity) {
    this.assertSnapshotAssets(this.compilePluginSnapshot(plugin));
  }

  private storeBrandAssets(manifest: PahPluginManifest, vueModuleRoot: string) {
    const contribution = manifest.uiContributions;
    if (!contribution?.login || !contribution.brand) {
      throw new CoolCommException('插件未声明公开登录品牌贡献');
    }
    const root = realpathSync(vueModuleRoot);
    const assets = this.brandAssets(contribution.brand);
    for (const [name, declaration] of Object.entries(assets) as Array<
      [AssetName, PahPublicLoginBrandingAssetDeclaration]
    >) {
      const prefix = `vue/${manifest.moduleId}/`;
      const relative = declaration.path.slice(prefix.length);
      const source = path.resolve(root, ...relative.split('/'));
      assertNoSymlink(root, source);
      const resolved = realpathSync(source);
      if (!inside(root, resolved) || !statSync(resolved).isFile()) {
        throw new CoolCommException(`品牌资源越界：${name}`);
      }
      const content = readFileSync(resolved);
      if (
        content.length !== declaration.size ||
        sha256(content) !== declaration.sha256
      ) {
        throw new CoolCommException(`品牌资源 size/SHA 不匹配：${name}`);
      }
      if (declaration.mime === 'image/svg+xml') validateSvg(content, name);
      const extension = path.extname(declaration.path).toLowerCase();
      const filename = `${name}${extension}`;
      const assetDirectory = path.join(
        this.runtimeRoot(),
        'assets',
        declaration.sha256
      );
      writeExclusive(path.join(assetDirectory, filename), content);
      writeExclusive(
        path.join(assetDirectory, `${filename}.json`),
        JSON.stringify({
          sha256: declaration.sha256,
          mime: declaration.mime,
          size: declaration.size,
        })
      );
    }
    return assets;
  }

  removeVerifiedPackageReceipt(
    moduleId: string,
    version: string,
    packageSha256: string
  ) {
    rmSync(this.receiptFile(moduleId, version, packageSha256), { force: true });
  }

  removeVerifiedPackageReceiptsForLifecycle(moduleId: string, version: string) {
    const directory = path.join(
      this.runtimeRoot(),
      'receipts',
      safeSegment(moduleId, 'moduleId'),
      safeSegment(version, 'version')
    );
    const names = existsSync(directory) ? readdirSync(directory) : [];
    const receipts = names.map(name => {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) {
        throw new CoolCommException('品牌插件包收据目录包含未知文件');
      }
      const file = path.join(directory, name);
      const current = lstatSync(file);
      if (current.isSymbolicLink() || !current.isFile()) {
        throw new CoolCommException('品牌插件包收据必须是普通文件');
      }
      return { file, content: readFileSync(file) };
    });
    rmSync(directory, { recursive: true, force: true });
    return () => {
      for (const receipt of receipts) {
        writeExclusive(receipt.file, receipt.content);
      }
    };
  }

  async select(moduleId: string, expectedRevision: string) {
    this.requireHostAdmin();
    if (process.env.PAH_SAFE_MODE === 'true') {
      throw new CoolCommException('安全模式下只能使用 Host 默认登录品牌');
    }
    const plugin = await this.pluginInstallationEntity.findOne({
      where: { moduleId: Equal(moduleId) },
    });
    if (!plugin || plugin.state !== 'enabled') {
      throw new CoolCommException('只能选择已启用的品牌插件');
    }
    const snapshot = this.compilePluginSnapshot(plugin);
    await this.replaceSelection(snapshot, expectedRevision);
    return snapshot;
  }

  async reset(expectedRevision: string) {
    this.requireHostAdmin();
    const snapshot = this.hostDefaultSnapshot();
    await this.replaceSelection(snapshot, expectedRevision);
    return snapshot;
  }

  async deactivateForLifecycle(moduleId: string) {
    const selection = await this.readSelection();
    if (selection?.moduleId !== moduleId) return async () => undefined;
    const previous = this.readCurrentSnapshot();
    if (!previous) throw new CoolCommException('活动品牌缺少可回滚快照');
    const fallback = this.hostDefaultSnapshot();
    await this.replaceSelection(fallback, selection.revision);
    return async () => {
      const current = await this.readSelection();
      if (current?.revision !== fallback.revision) return;
      await this.replaceSelection(previous, fallback.revision);
    };
  }

  private brandAssets(brand: PahPublicBrandContributionV1) {
    return Object.fromEntries(
      ASSET_NAMES.flatMap(name => (brand[name] ? [[name, brand[name]]] : []))
    ) as Partial<Record<AssetName, PahPublicLoginBrandingAssetDeclaration>>;
  }

  private findReceipt(moduleId: string, version: string) {
    const directory = path.join(
      this.runtimeRoot(),
      'receipts',
      safeSegment(moduleId, 'moduleId'),
      safeSegment(version, 'version')
    );
    if (!existsSync(directory)) {
      throw new CoolCommException(
        `品牌插件 ${moduleId}@${version} 缺少受控包收据`
      );
    }
    const files = readdirSync(directory).filter(name =>
      /^[a-f0-9]{64}\.json$/.test(name)
    );
    if (files.length !== 1) {
      throw new CoolCommException(
        `品牌插件 ${moduleId}@${version} 包收据不唯一`
      );
    }
    const receipt = JSON.parse(
      readFileSync(path.join(directory, files[0]), 'utf8')
    ) as BrandingReceiptV1;
    if (
      receipt.formatVersion !== 1 ||
      receipt.moduleId !== moduleId ||
      receipt.version !== version ||
      `${receipt.packageSha256}.json` !== files[0]
    ) {
      throw new CoolCommException('品牌插件包收据身份不匹配');
    }
    return receipt;
  }

  private snapshotAsset(
    name: AssetName,
    declaration: PahPublicLoginBrandingAssetDeclaration
  ): PahPublicLoginBrandingSnapshotAssetV1 {
    const extension = path.posix.extname(declaration.path).toLowerCase();
    return {
      url: `public-login-branding/assets/${declaration.sha256}/${name}${extension}`,
      sha256: declaration.sha256,
      mime: declaration.mime,
      size: declaration.size,
    };
  }

  private compilePluginSnapshot(
    plugin: PahPluginInstallationEntity,
    requiredPackageSha256?: string | null
  ) {
    const contribution = plugin.manifest.uiContributions;
    if (
      plugin.manifest.pluginType !== 'phoenix.admin.branding' ||
      !contribution?.login ||
      !contribution.brand
    ) {
      throw new CoolCommException('插件未声明公开登录品牌贡献');
    }
    const receipt = this.findReceipt(plugin.moduleId, plugin.version);
    if (
      requiredPackageSha256 &&
      receipt.packageSha256 !== requiredPackageSha256
    ) {
      throw new CoolCommException('品牌选择绑定的插件包 SHA 已变化');
    }
    const declarations = this.brandAssets(contribution.brand);
    for (const [name, declaration] of Object.entries(declarations)) {
      const recorded = receipt.assets[name as AssetName];
      if (
        !recorded ||
        JSON.stringify(recorded) !== JSON.stringify(declaration)
      ) {
        throw new CoolCommException(`品牌资源收据已变化：${name}`);
      }
    }
    return this.compileManifestSnapshot(
      plugin.manifest,
      receipt.packageSha256,
      declarations
    );
  }

  private compileManifestSnapshot(
    manifest: PahPluginManifest,
    packageSha256: string,
    declarations: Partial<
      Record<AssetName, PahPublicLoginBrandingAssetDeclaration>
    >
  ) {
    const contribution = manifest.uiContributions!;
    const background = declarations.background
      ? this.snapshotAsset('background', declarations.background)
      : undefined;
    const pluginAssets = {
      logo: this.snapshotAsset('logo', contribution.brand.logo),
      logoDark: this.snapshotAsset('logoDark', contribution.brand.logoDark),
      compactLogo: this.snapshotAsset(
        'compactLogo',
        contribution.brand.compactLogo
      ),
      compactLogoDark: this.snapshotAsset(
        'compactLogoDark',
        contribution.brand.compactLogoDark
      ),
      ...(background ? { background } : {}),
    };
    const pluginWorkbench =
      contribution.contractVersion === 1
        ? {
            title: contribution.brand.appName,
            subtitle: {
              mode: 'text' as const,
              text: contribution.login.subtitle,
            },
          }
        : contribution.workbench;
    const base = {
      mode: 'plugin',
      plugin: {
        moduleId: manifest.moduleId,
        version: manifest.version,
        packageSha256,
      },
      appName: contribution.brand.appName,
      titleTemplate: contribution.brand.titleTemplate,
      favicon: this.snapshotAsset('favicon', contribution.brand.favicon),
      login: {
        eyebrow: contribution.login.eyebrow,
        title: contribution.login.title,
        subtitle: contribution.login.subtitle,
        prompt: contribution.login.prompt,
        presentation: contribution.login.presentation,
      },
      assets: {
        logo: pluginAssets.logo,
        logoDark: pluginAssets.logoDark,
        compactLogo: pluginAssets.compactLogo,
        compactLogoDark: pluginAssets.compactLogoDark,
        ...(background ? { background } : {}),
      },
    } as const;
    if (contribution.contractVersion === 2) {
      return withPahPublicLoginBrandingRevision({
        ...base,
        schemaVersion: 2,
        workbench: {
          title: pluginWorkbench.title,
          subtitle: pluginWorkbench.subtitle,
          logo: pluginAssets.compactLogo,
          logoDark: pluginAssets.compactLogoDark,
        },
      });
    }
    return withPahPublicLoginBrandingRevision({
      ...base,
      schemaVersion: 1,
    });
  }

  private readCurrentSnapshot() {
    try {
      const value = JSON.parse(readFileSync(this.currentFile(), 'utf8'));
      if (!validatePahPublicLoginBrandingSnapshot(value)) return null;
      this.assertSnapshotAssets(value);
      return value;
    } catch {
      return null;
    }
  }

  private publishSnapshot(snapshot: PahPublicLoginBrandingSnapshot) {
    if (!validatePahPublicLoginBrandingSnapshot(snapshot)) {
      throw new CoolCommException('拒绝发布不合法的公开登录品牌快照');
    }
    this.assertSnapshotAssets(snapshot);
    const revisionFile = path.join(
      this.runtimeRoot(),
      'revisions',
      `${snapshot.revision}.json`
    );
    const content = JSON.stringify(snapshot);
    writeExclusive(revisionFile, content);
    atomicReplace(this.currentFile(), content);
  }

  private async readSelection() {
    const row = await this.baseSysParamEntity.findOneBy({
      keyName: SELECTION_KEY,
    });
    if (!row) return null;
    try {
      const value = JSON.parse(row.data);
      return isSelection(value) ? value : null;
    } catch {
      return null;
    }
  }

  private async replaceSelection(
    snapshot: PahPublicLoginBrandingSnapshot,
    expectedRevision: string
  ) {
    const previous = this.readCurrentSnapshot() || this.hostDefaultSnapshot();
    const row = await this.baseSysParamEntity.findOneBy({
      keyName: SELECTION_KEY,
    });
    let existing: BrandingSelectionV1 | null = null;
    if (row) {
      try {
        const parsed = JSON.parse(row.data);
        existing = isSelection(parsed) ? parsed : null;
      } catch {}
    }
    const currentRevision = existing?.revision || previous.revision;
    if (expectedRevision !== currentRevision) {
      throw new CoolCommException('品牌快照已变化，请刷新后重试');
    }
    const next: BrandingSelectionV1 = {
      schemaVersion: RUNTIME_FORMAT_VERSION,
      revision: snapshot.revision,
      moduleId: snapshot.plugin?.moduleId || null,
      version: snapshot.plugin?.version || null,
      packageSha256: snapshot.plugin?.packageSha256 || null,
    };
    this.publishSnapshot(snapshot);
    try {
      if (row) {
        const result = await this.baseSysParamEntity.update(
          { id: row.id, data: row.data },
          { data: JSON.stringify(next) }
        );
        if (result.affected !== 1) {
          throw new CoolCommException('品牌选择已被其他管理员修改');
        }
      } else {
        await this.baseSysParamEntity.insert({
          keyName: SELECTION_KEY,
          name: 'Public Login Branding Snapshot',
          data: JSON.stringify(next),
          dataType: 0,
          remark: 'Host-owned public login branding selection',
        });
      }
    } catch (error) {
      const authoritative = await this.readSelection();
      try {
        this.publishSnapshot(await this.snapshotForSelection(authoritative));
      } catch {
        this.publishSnapshot(
          authoritative?.revision === previous.revision
            ? previous
            : this.hostDefaultSnapshot()
        );
      }
      throw error;
    }
  }

  private async snapshotForSelection(selection: BrandingSelectionV1 | null) {
    if (!selection?.moduleId) return this.hostDefaultSnapshot();
    const plugin = await this.pluginInstallationEntity.findOne({
      where: { moduleId: Equal(selection.moduleId) },
    });
    if (!plugin || plugin.state !== 'enabled')
      return this.hostDefaultSnapshot();
    return this.compilePluginSnapshot(plugin, selection.packageSha256);
  }

  private requireHostAdmin() {
    if (this.ctx?.admin?.username !== 'admin') {
      throw new CoolCommException('只有 Host 管理员可以切换公开登录品牌');
    }
  }
}
