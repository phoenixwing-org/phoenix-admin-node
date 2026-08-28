import { createHash } from 'crypto';

export const PAH_PUBLIC_LOGIN_BRANDING_SCHEMA_VERSION = 2 as const;
export const PAH_PUBLIC_LOGIN_BRANDING_PRESENTATIONS = [
  'split',
  'centered',
  'hero-image',
] as const;
export const PAH_PUBLIC_LOGIN_BRANDING_ASSET_MIME_TYPES = [
  'image/svg+xml',
  'image/png',
  'image/webp',
  'image/x-icon',
] as const;

export type PahPublicLoginBrandingPresentation =
  (typeof PAH_PUBLIC_LOGIN_BRANDING_PRESENTATIONS)[number];
export type PahPublicLoginBrandingAssetMime =
  (typeof PAH_PUBLIC_LOGIN_BRANDING_ASSET_MIME_TYPES)[number];

const PAH_PUBLIC_LOGIN_BRANDING_EXTENSION_MIME = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
} as const satisfies Record<string, PahPublicLoginBrandingAssetMime>;

export interface PahPublicLoginBrandingAssetDeclaration {
  path: string;
  sha256: string;
  mime: PahPublicLoginBrandingAssetMime;
  size: number;
}

export interface PahPublicLoginContributionV1 {
  id: string;
  mode: 'host-auth-shell';
  eyebrow: string;
  title: string;
  subtitle: string;
  prompt: string;
  presentation: PahPublicLoginBrandingPresentation;
}

export interface PahPublicBrandContributionV1 {
  id: string;
  appName: string;
  titleTemplate: string;
  favicon: PahPublicLoginBrandingAssetDeclaration;
  logo: PahPublicLoginBrandingAssetDeclaration;
  logoDark: PahPublicLoginBrandingAssetDeclaration;
  compactLogo: PahPublicLoginBrandingAssetDeclaration;
  compactLogoDark: PahPublicLoginBrandingAssetDeclaration;
  background?: PahPublicLoginBrandingAssetDeclaration;
}

export interface PahPublicLoginBrandingUiContributionsV1 {
  contractVersion: 1;
  login: PahPublicLoginContributionV1;
  brand: PahPublicBrandContributionV1;
  /** 登录后首页仍是普通 route contribution，不进入公开登录快照。 */
  home?: unknown;
}

export interface PahWorkbenchBrandingContributionV2 {
  title: string;
  subtitle: { mode: 'web-origin' } | { mode: 'text'; text: string };
  logoVariant: 'compact';
}

export interface PahPublicLoginBrandingUiContributionsV2
  extends Omit<PahPublicLoginBrandingUiContributionsV1, 'contractVersion'> {
  contractVersion: 2;
  workbench: PahWorkbenchBrandingContributionV2;
}

export type PahPublicLoginBrandingUiContributions =
  | PahPublicLoginBrandingUiContributionsV1
  | PahPublicLoginBrandingUiContributionsV2;

export interface PahPublicLoginBrandingSnapshotAssetV1 {
  /** Host wrapper 会把相对路径解析到当前同源公开快照 endpoint。 */
  url: string;
  sha256: string;
  mime: PahPublicLoginBrandingAssetMime;
  size: number;
}

export interface PahPublicLoginBrandingSnapshotV1 {
  schemaVersion: 1;
  revision: string;
  mode: 'host-default' | 'plugin';
  plugin: null | {
    moduleId: string;
    version: string;
    packageSha256: string;
  };
  appName: string;
  titleTemplate: string;
  favicon: PahPublicLoginBrandingSnapshotAssetV1;
  login: {
    eyebrow: string;
    title: string;
    subtitle: string;
    prompt: string;
    presentation: PahPublicLoginBrandingPresentation;
  };
  assets: {
    logo: PahPublicLoginBrandingSnapshotAssetV1;
    logoDark: PahPublicLoginBrandingSnapshotAssetV1;
    compactLogo: PahPublicLoginBrandingSnapshotAssetV1;
    compactLogoDark: PahPublicLoginBrandingSnapshotAssetV1;
    background?: PahPublicLoginBrandingSnapshotAssetV1;
  };
}

export interface PahPublicLoginBrandingSnapshotV2
  extends Omit<PahPublicLoginBrandingSnapshotV1, 'schemaVersion'> {
  schemaVersion: 2;
  workbench: {
    title: string;
    subtitle: { mode: 'web-origin' } | { mode: 'text'; text: string };
    logo: PahPublicLoginBrandingSnapshotAssetV1;
    logoDark: PahPublicLoginBrandingSnapshotAssetV1;
  };
}

export type PahPublicLoginBrandingSnapshot =
  | PahPublicLoginBrandingSnapshotV1
  | PahPublicLoginBrandingSnapshotV2;

const ASSET_KEYS = [
  'favicon',
  'logo',
  'logoDark',
  'compactLogo',
  'compactLogoDark',
  'background',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  errors: string[]
) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${label} 包含未声明字段：${key}`);
  }
}

function isPlainPublicText(value: unknown, max: number) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= max &&
    !/[<>\u0000-\u001f\u007f]/.test(value)
  );
}

function validateAsset(
  value: unknown,
  moduleId: string,
  label: string,
  errors: string[]
) {
  if (!isRecord(value)) {
    errors.push(`${label} 必须是资源声明`);
    return;
  }
  exactKeys(value, ['path', 'sha256', 'mime', 'size'], label, errors);
  const expectedPrefix = `vue/${moduleId}/assets/`;
  if (
    typeof value.path !== 'string' ||
    !value.path.startsWith(expectedPrefix) ||
    value.path.includes('\\') ||
    value.path.includes('..') ||
    !/^[a-zA-Z0-9/_-]+\.(?:svg|png|webp|ico)$/.test(value.path)
  ) {
    errors.push(`${label}.path 必须位于 ${expectedPrefix}`);
  }
  if (
    typeof value.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.sha256)
  ) {
    errors.push(`${label}.sha256 必须是小写 SHA-256`);
  }
  if (!PAH_PUBLIC_LOGIN_BRANDING_ASSET_MIME_TYPES.includes(value.mime as any)) {
    errors.push(`${label}.mime 不受支持`);
  }
  const extension =
    typeof value.path === 'string'
      ? value.path.slice(value.path.lastIndexOf('.')).toLowerCase()
      : '';
  if (
    extension in PAH_PUBLIC_LOGIN_BRANDING_EXTENSION_MIME &&
    PAH_PUBLIC_LOGIN_BRANDING_EXTENSION_MIME[
      extension as keyof typeof PAH_PUBLIC_LOGIN_BRANDING_EXTENSION_MIME
    ] !== value.mime
  ) {
    errors.push(`${label}.mime 与文件扩展名不匹配`);
  }
  if (
    !Number.isSafeInteger(value.size) ||
    Number(value.size) <= 0 ||
    Number(value.size) > 8 * 1024 * 1024
  ) {
    errors.push(`${label}.size 必须在 1B～8MiB 之间`);
  }
}

export function validatePahPublicLoginBrandingContributions(
  moduleId: string,
  pluginType: unknown,
  input: unknown
) {
  const errors: string[] = [];
  if (input === undefined) return { valid: true, errors };
  if (!isRecord(input)) {
    return { valid: false, errors: ['uiContributions 必须是对象'] };
  }
  exactKeys(
    input,
    ['contractVersion', 'login', 'brand', 'home', 'workbench'],
    'uiContributions',
    errors
  );
  const hasPublicLogin = input.login !== undefined || input.brand !== undefined;
  if (!hasPublicLogin) return { valid: errors.length === 0, errors };
  if (pluginType !== 'phoenix.admin.branding') {
    errors.push('公开登录品牌贡献只允许 phoenix.admin.branding 插件声明');
  }
  if (![1, 2].includes(Number(input.contractVersion))) {
    errors.push('uiContributions.contractVersion 必须为 1 或 2');
  }

  if (!isRecord(input.login)) {
    errors.push('uiContributions.login 必须是对象');
  } else {
    exactKeys(
      input.login,
      ['id', 'mode', 'eyebrow', 'title', 'subtitle', 'prompt', 'presentation'],
      'uiContributions.login',
      errors
    );
    if (
      typeof input.login.id !== 'string' ||
      !input.login.id.startsWith(`${moduleId}-`)
    ) {
      errors.push('uiContributions.login.id 必须位于插件命名空间');
    }
    if (input.login.mode !== 'host-auth-shell') {
      errors.push('uiContributions.login.mode 必须为 host-auth-shell');
    }
    for (const [key, max] of [
      ['eyebrow', 80],
      ['title', 100],
      ['subtitle', 240],
      ['prompt', 160],
    ] as const) {
      if (!isPlainPublicText(input.login[key], max)) {
        errors.push(`uiContributions.login.${key} 必须是安全公开文本`);
      }
    }
    if (
      !PAH_PUBLIC_LOGIN_BRANDING_PRESENTATIONS.includes(
        input.login.presentation as any
      )
    ) {
      errors.push('uiContributions.login.presentation 不受支持');
    }
  }

  if (!isRecord(input.brand)) {
    errors.push('uiContributions.brand 必须是对象');
  } else {
    exactKeys(
      input.brand,
      ['id', 'appName', 'titleTemplate', ...ASSET_KEYS],
      'uiContributions.brand',
      errors
    );
    if (
      typeof input.brand.id !== 'string' ||
      !input.brand.id.startsWith(`${moduleId}-`)
    ) {
      errors.push('uiContributions.brand.id 必须位于插件命名空间');
    }
    if (!isPlainPublicText(input.brand.appName, 80)) {
      errors.push('uiContributions.brand.appName 必须是安全公开文本');
    }
    const titleTemplate = input.brand.titleTemplate;
    if (
      !isPlainPublicText(titleTemplate, 120) ||
      (typeof titleTemplate === 'string' &&
        titleTemplate.split('%s').length !== 2)
    ) {
      errors.push('uiContributions.brand.titleTemplate 必须精确包含一个 %s');
    }
    for (const key of ASSET_KEYS) {
      if (key === 'background' && input.brand[key] === undefined) continue;
      validateAsset(
        input.brand[key],
        moduleId,
        `uiContributions.brand.${key}`,
        errors
      );
    }
  }

  if (input.contractVersion === 2) {
    if (!isRecord(input.workbench)) {
      errors.push('uiContributions.workbench 必须是对象');
    } else {
      exactKeys(
        input.workbench,
        ['title', 'subtitle', 'logoVariant'],
        'uiContributions.workbench',
        errors
      );
      if (!isPlainPublicText(input.workbench.title, 80)) {
        errors.push('uiContributions.workbench.title 必须是安全公开文本');
      }
      if (input.workbench.logoVariant !== 'compact') {
        errors.push('uiContributions.workbench.logoVariant 首版只支持 compact');
      }
      if (!isRecord(input.workbench.subtitle)) {
        errors.push('uiContributions.workbench.subtitle 必须是对象');
      } else if (input.workbench.subtitle.mode === 'web-origin') {
        exactKeys(
          input.workbench.subtitle,
          ['mode'],
          'uiContributions.workbench.subtitle',
          errors
        );
      } else if (input.workbench.subtitle.mode === 'text') {
        exactKeys(
          input.workbench.subtitle,
          ['mode', 'text'],
          'uiContributions.workbench.subtitle',
          errors
        );
        if (!isPlainPublicText(input.workbench.subtitle.text, 160)) {
          errors.push(
            'uiContributions.workbench.subtitle.text 必须是安全公开文本'
          );
        }
      } else {
        errors.push('uiContributions.workbench.subtitle.mode 不受支持');
      }
    }
  } else if (input.workbench !== undefined) {
    errors.push('uiContributions.workbench 需要 contractVersion=2');
  }

  return { valid: errors.length === 0, errors };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, canonicalValue(value[key])])
  );
}

export function pahPublicLoginBrandingRevision(
  snapshot: Omit<PahPublicLoginBrandingSnapshot, 'revision'>
) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalValue(snapshot)))
    .digest('hex');
}

export function withPahPublicLoginBrandingRevision<
  T extends Omit<PahPublicLoginBrandingSnapshot, 'revision'>
>(snapshot: T): T & { revision: string } {
  return { ...snapshot, revision: pahPublicLoginBrandingRevision(snapshot) };
}

export function validatePahPublicLoginBrandingSnapshot(
  value: unknown
): value is PahPublicLoginBrandingSnapshot {
  if (!isRecord(value)) return false;
  const validSnapshotAsset = (asset: unknown) => {
    if (!isRecord(asset)) return false;
    if (
      Object.keys(asset).some(
        key => !['url', 'sha256', 'mime', 'size'].includes(key)
      )
    ) {
      return false;
    }
    const extension =
      typeof asset.url === 'string'
        ? asset.url.slice(asset.url.lastIndexOf('.')).toLowerCase()
        : '';
    return (
      typeof asset.url === 'string' &&
      asset.url.length > 0 &&
      asset.url.length <= 300 &&
      !asset.url.includes('\\') &&
      !asset.url.includes('..') &&
      !/^(?:[a-z]+:)?\/\//i.test(asset.url) &&
      typeof asset.sha256 === 'string' &&
      /^[a-f0-9]{64}$/.test(asset.sha256) &&
      PAH_PUBLIC_LOGIN_BRANDING_ASSET_MIME_TYPES.includes(asset.mime as any) &&
      extension in PAH_PUBLIC_LOGIN_BRANDING_EXTENSION_MIME &&
      PAH_PUBLIC_LOGIN_BRANDING_EXTENSION_MIME[
        extension as keyof typeof PAH_PUBLIC_LOGIN_BRANDING_EXTENSION_MIME
      ] === asset.mime &&
      Number.isSafeInteger(asset.size) &&
      Number(asset.size) > 0 &&
      Number(asset.size) <= 8 * 1024 * 1024
    );
  };
  if (
    ![1, PAH_PUBLIC_LOGIN_BRANDING_SCHEMA_VERSION].includes(
      Number(value.schemaVersion)
    ) ||
    typeof value.revision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.revision) ||
    !['host-default', 'plugin'].includes(String(value.mode)) ||
    !isPlainPublicText(value.appName, 80) ||
    !isPlainPublicText(value.titleTemplate, 120) ||
    !isRecord(value.login) ||
    !isRecord(value.assets) ||
    !isRecord(value.favicon)
  ) {
    return false;
  }
  if (
    Object.keys(value).some(
      key =>
        ![
          'schemaVersion',
          'revision',
          'mode',
          'plugin',
          'appName',
          'titleTemplate',
          'favicon',
          'login',
          'assets',
          'workbench',
        ].includes(key)
    ) ||
    !validSnapshotAsset(value.favicon) ||
    Object.keys(value.login).some(
      key =>
        !['eyebrow', 'title', 'subtitle', 'prompt', 'presentation'].includes(
          key
        )
    ) ||
    !isPlainPublicText(value.login.eyebrow, 80) ||
    !isPlainPublicText(value.login.title, 100) ||
    !isPlainPublicText(value.login.subtitle, 240) ||
    !isPlainPublicText(value.login.prompt, 160) ||
    !PAH_PUBLIC_LOGIN_BRANDING_PRESENTATIONS.includes(
      value.login.presentation as any
    ) ||
    Object.keys(value.assets).some(
      key =>
        ![
          'logo',
          'logoDark',
          'compactLogo',
          'compactLogoDark',
          'background',
        ].includes(key)
    ) ||
    !validSnapshotAsset(value.assets.logo) ||
    !validSnapshotAsset(value.assets.logoDark) ||
    !validSnapshotAsset(value.assets.compactLogo) ||
    !validSnapshotAsset(value.assets.compactLogoDark) ||
    (value.assets.background !== undefined &&
      !validSnapshotAsset(value.assets.background))
  ) {
    return false;
  }
  if (value.schemaVersion === 2) {
    if (!isRecord(value.workbench)) return false;
    if (
      Object.keys(value.workbench).some(
        key => !['title', 'subtitle', 'logo', 'logoDark'].includes(key)
      ) ||
      !isPlainPublicText(value.workbench.title, 80) ||
      !isRecord(value.workbench.subtitle) ||
      !validSnapshotAsset(value.workbench.logo) ||
      !validSnapshotAsset(value.workbench.logoDark)
    ) {
      return false;
    }
    if (value.workbench.subtitle.mode === 'web-origin') {
      if (Object.keys(value.workbench.subtitle).some(key => key !== 'mode')) {
        return false;
      }
    } else if (value.workbench.subtitle.mode === 'text') {
      if (
        Object.keys(value.workbench.subtitle).some(
          key => !['mode', 'text'].includes(key)
        ) ||
        !isPlainPublicText(value.workbench.subtitle.text, 160)
      ) {
        return false;
      }
    } else {
      return false;
    }
  } else if (value.workbench !== undefined) {
    return false;
  }
  if (value.mode === 'host-default' && value.plugin !== null) return false;
  if (value.mode === 'plugin') {
    if (!isRecord(value.plugin)) return false;
    if (
      Object.keys(value.plugin).some(
        key => !['moduleId', 'version', 'packageSha256'].includes(key)
      ) ||
      typeof value.plugin.moduleId !== 'string' ||
      !/^[a-z][a-z0-9-]*$/.test(value.plugin.moduleId) ||
      !isPlainPublicText(value.plugin.version, 80) ||
      typeof value.plugin.packageSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.plugin.packageSha256)
    ) {
      return false;
    }
  }
  const candidate = value as unknown as PahPublicLoginBrandingSnapshot;
  const { revision, ...withoutRevision } = candidate;
  return revision === pahPublicLoginBrandingRevision(withoutRevision);
}

function escapedJson(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * 固定 Host wrapper。插件只能影响已经验证的 JSON 数据，不能贡献可执行脚本。
 * 相对资源 URL 由 wrapper 相对当前同源 endpoint 解析。
 */
export function serializePahPublicLoginBrandingBootstrap(
  snapshot: PahPublicLoginBrandingSnapshot
) {
  return `;(()=>{const s=${escapedJson(
    snapshot
  )};const b=document.currentScript&&document.currentScript.src;const u=a=>a&&a.url&&!a.url.startsWith('/')?Object.freeze({...a,url:new URL(a.url,b).pathname}):Object.freeze(a);s.favicon=u(s.favicon);s.assets=Object.freeze({...s.assets,logo:u(s.assets.logo),logoDark:u(s.assets.logoDark),compactLogo:u(s.assets.compactLogo),compactLogoDark:u(s.assets.compactLogoDark),...(s.assets.background?{background:u(s.assets.background)}:{})});s.login=Object.freeze(s.login);if(s.workbench)s.workbench=Object.freeze({...s.workbench,subtitle:Object.freeze(s.workbench.subtitle),logo:u(s.workbench.logo),logoDark:u(s.workbench.logoDark)});if(s.plugin)s.plugin=Object.freeze(s.plugin);Object.defineProperty(window,'__PAH_PUBLIC_LOGIN_BRANDING__',{value:Object.freeze(s),configurable:false,writable:false});})();\n`;
}
