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
  PahPublicLoginBrandingSnapshotAssetV1,
  PahPublicLoginBrandingSnapshotV1,
  serializePahPublicLoginBrandingBootstrap,
  validatePahPublicLoginBrandingSnapshot,
  withPahPublicLoginBrandingRevision,
} from '../interface/public-login-branding';
import { PahPluginManifest } from '../interface/plugin';

const SELECTION_KEY = 'pah.public-login-branding.selection';
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

function sha256(content: Buffer | string) {
  return createHash('sha256').update(content).digest('hex');
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

  hostDefaultSnapshot() {
    const mark = this.defaultAsset();
    return withPahPublicLoginBrandingRevision({
      schemaVersion: RUNTIME_FORMAT_VERSION,
      mode: 'host-default',
      plugin: null,
      appName: 'Phoenix Admin',
      titleTemplate: '%s · Phoenix Admin',
      favicon: mark,
      login: {
        eyebrow: 'PHOENIXWING OPEN SOURCE',
        title: 'Phoenix Admin Host',
        subtitle:
          '面向 Phoenix 业务模块的统一管理工作台。保留成熟权限底座，提供可切换的 Ribbon 与大分组侧栏。',
        prompt: '登录 Phoenix Admin Host，继续管理您的工作区。',
        presentation: 'split',
      },
      assets: {
        logo: mark,
        logoDark: mark,
        compactLogo: mark,
        compactLogoDark: mark,
      },
    });
  }

  async reconcileOnStartup() {
    mkdirSync(this.runtimeRoot(), { recursive: true, mode: 0o700 });
    if (process.env.PAH_SAFE_MODE === 'true') {
      this.publishSnapshot(this.hostDefaultSnapshot());
      return;
    }
    const selection = await this.readSelection();
    try {
      const snapshot = await this.snapshotForSelection(selection);
      if (selection?.moduleId && snapshot.mode === 'host-default') {
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

  removeVerifiedPackageReceipt(
    moduleId: string,
    version: string,
    packageSha256: string
  ) {
    rmSync(this.receiptFile(moduleId, version, packageSha256), { force: true });
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
    const background = declarations.background
      ? this.snapshotAsset('background', declarations.background)
      : undefined;
    return withPahPublicLoginBrandingRevision({
      schemaVersion: RUNTIME_FORMAT_VERSION,
      mode: 'plugin',
      plugin: {
        moduleId: plugin.moduleId,
        version: plugin.version,
        packageSha256: receipt.packageSha256,
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
      },
    });
  }

  private readCurrentSnapshot() {
    try {
      const value = JSON.parse(readFileSync(this.currentFile(), 'utf8'));
      return validatePahPublicLoginBrandingSnapshot(value) ? value : null;
    } catch {
      return null;
    }
  }

  private publishSnapshot(snapshot: PahPublicLoginBrandingSnapshotV1) {
    if (!validatePahPublicLoginBrandingSnapshot(snapshot)) {
      throw new CoolCommException('拒绝发布不合法的公开登录品牌快照');
    }
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
    snapshot: PahPublicLoginBrandingSnapshotV1,
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
