import {
  PahPublicLoginBrandingUiContributionsV1,
  validatePahPublicLoginBrandingContributions,
} from './public-login-branding';

export const PAH_PLUGIN_FORMAT_VERSION = 2 as const;

export const PAH_HOST_REUSE_CAPABILITIES = [
  'identity',
  'users',
  'departments',
  'roles',
  'menus',
  'dictionary',
  'files',
  'tasks',
  'audit',
  'parameters',
  'backup',
] as const;

export type PahHostReuseCapability =
  (typeof PAH_HOST_REUSE_CAPABILITIES)[number];

export const PAH_CAPABILITY_HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
] as const;

export type PahCapabilityHttpMethod =
  (typeof PAH_CAPABILITY_HTTP_METHODS)[number];

export interface PahCapabilityEndpoint {
  /** HTTP method is part of the permission boundary; read and write paths may coincide. */
  method: PahCapabilityHttpMethod;
  /** Absolute Host API template. Named parameters match exactly one path segment. */
  path: string;
}

export type PahDictionaryItemClass = 'core' | 'default' | 'transitional';

export interface PahDictionaryContribution {
  id: string;
  typeKey: string;
  typeName: string;
  policyVersion: number;
  retainOnUninstall: true;
  installPresets?: string[];
  items: Array<{
    value: string;
    name: string;
    orderNum: number;
    itemClass: PahDictionaryItemClass;
    presets?: string[];
    /** Simple classification annotations; no tag catalog or relation table. */
    tags?: string[];
    /** Defaults to true. Core protocol values can never be disabled. */
    enabled?: boolean;
    customizable?: Array<'name' | 'orderNum' | 'enabled' | 'tags'>;
  }>;
}

export type PahPluginLifecycleState =
  | 'uploaded'
  | 'verified'
  | 'staged'
  | 'migrated'
  | 'installed'
  | 'enabled'
  | 'disabled'
  | 'uninstalled'
  | 'rejected'
  | 'failed';

export interface PahPluginMigrationDeclaration {
  id: string;
  version: number;
  checksum: string;
  description: string;
  artifact: {
    /** 首版只接受受控构建随包发布的 SQL，不动态加载 Migration 类。 */
    format: 'sql';
    /** 相对编译期插件根目录，固定放在 migrations/ 下。 */
    path: string;
  };
}

export interface PahPluginManifest {
  formatVersion: number;
  /** Site-level plugin class; ordinary business plugins omit it. */
  pluginType?: string;
  moduleId: string;
  name: string;
  version: string;
  publisher: string;
  license: string;
  hostCompatibility: string;
  wingCompatibility?: string;
  activationMode: 'restart';
  /** 面向用户的短路由前缀；省略时默认 /{moduleId}。 */
  routePrefix?: string;
  entrypoints: {
    web: string;
    node: string;
  };
  routes: Array<{
    id: string;
    path: string;
    title: string;
    /** 可序列化图标 ID；新数据必须使用 pnw:* / cool:* 等显式命名空间。 */
    icon?: string;
    moduleId: string;
    capability: string;
    /** 编译期接入 Host 的前端视图；生产安装不执行上传源码。 */
    viewPath: string;
    /** 详情等深链接保持可路由，但不出现在导航中。 */
    isShow?: boolean;
  }>;
  navigation: {
    preferredGroupId: string;
    preferredGroupLabel: string;
    modules: Array<{
      id: string;
      label: string;
      /** 可序列化图标 ID；省略时使用 pnw:folder。 */
      icon?: string;
      routeIds: string[];
    }>;
  };
  apiPrefix: string;
  capabilities: Array<{
    id: string;
    description: string;
    risk: 'read' | 'write' | 'admin';
    /**
     * Explicit Host endpoints guarded by this semantic capability.
     *
     * Older manifests may omit this field and retain Cool's historical
     * capability-id-to-path convention. REST-style or parameterized routes
     * must declare endpoints so non-root authorization is executable.
     */
    endpoints?: PahCapabilityEndpoint[];
  }>;
  resourcePolicies: string[];
  auditCategories: Array<{ id: string; description: string }>;
  /** Product-owned catalog; Pah materializes it through Cool dictionary storage. */
  dictionaryContributions?: PahDictionaryContribution[];
  migrations: PahPluginMigrationDeclaration[];
  healthChecks: Array<{ id: string; path: string }>;
  hostReuse: PahHostReuseCapability[];
  /** Host validates login/brand; post-login home remains a normal route contribution. */
  uiContributions?: PahPublicLoginBrandingUiContributionsV1;
  dataOwnership: {
    tables: string[];
    retainedOnUninstall: boolean;
  };
  uninstall: {
    retainDataByDefault: boolean;
    requiresBackup: boolean;
    purgeCapability: string;
  };
}

export interface PahManifestValidationResult {
  valid: boolean;
  errors: string[];
}

const transitions: Record<
  PahPluginLifecycleState,
  readonly PahPluginLifecycleState[]
> = {
  uploaded: ['verified', 'rejected', 'failed'],
  verified: ['staged', 'uninstalled', 'rejected', 'failed'],
  staged: ['migrated', 'failed'],
  migrated: ['installed', 'failed'],
  installed: ['enabled', 'disabled', 'uninstalled', 'failed'],
  enabled: ['disabled', 'failed'],
  disabled: ['enabled', 'uninstalled', 'failed'],
  uninstalled: [],
  rejected: [],
  failed: ['uploaded', 'uninstalled'],
};

export function canTransitionPahPlugin(
  from: PahPluginLifecycleState,
  to: PahPluginLifecycleState
) {
  return transitions[from]?.includes(to) ?? false;
}

function duplicates(values: string[]) {
  const seen = new Set<string>();
  const result = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) result.add(value);
    seen.add(value);
  }
  return [...result];
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

const PAH_ICON_ID_PATTERN = /^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9._-]*$/;

/**
 * 插件 manifest 只能保存显式命名空间图标 ID。
 * 裸字符串属于旧运行时兼容输入，不能进入新的持久化契约。
 */
export function isPahIconId(value: unknown): value is string {
  return isText(value) && PAH_ICON_ID_PATTERN.test(value);
}

function isSafeEntrypoint(value: unknown) {
  return (
    isText(value) &&
    !!value &&
    !value.startsWith('/') &&
    !value.includes('..') &&
    !value.includes('\\')
  );
}

function isSafeViewPath(value: unknown, moduleId: string) {
  return (
    isText(value) &&
    value.startsWith(`modules/${moduleId}/`) &&
    value.endsWith('.vue') &&
    !value.includes('..') &&
    !value.includes('\\')
  );
}

function isSafeMigrationArtifactPath(value: unknown) {
  if (!isText(value) || value.includes('\\')) return false;
  const segments = value.split('/');
  return (
    segments.length >= 2 &&
    segments[0] === 'migrations' &&
    value.endsWith('.sql') &&
    segments.every(segment => /^[a-z0-9][a-z0-9._-]*$/.test(segment))
  );
}

function isSafeCapabilityEndpointPath(value: unknown, apiPrefix: string) {
  if (!isText(value) || !apiPrefix || !value.startsWith(apiPrefix)) {
    return false;
  }
  if (
    value.includes('\\') ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes('..') ||
    value.includes('*') ||
    value.includes(',') ||
    value.includes(' ')
  ) {
    return false;
  }
  const segments = value.split('/').slice(1);
  return (
    segments.length >= 3 &&
    segments.every(
      segment =>
        /^[a-zA-Z0-9._-]+$/.test(segment) ||
        /^:[a-zA-Z][a-zA-Z0-9_]*$/.test(segment)
    )
  );
}

/** Encode one endpoint into the comma-safe Cool menu permission token. */
export function encodePahCapabilityEndpoint(endpoint: PahCapabilityEndpoint) {
  return `${endpoint.method} ${endpoint.path}`;
}

/**
 * Materialized Cool permission values for one semantic capability.
 * The semantic id remains the stable contribution key even when runtime
 * permission tokens are explicit HTTP endpoint templates.
 */
export function pahCapabilityPermissionTokens(
  capability: PahPluginManifest['capabilities'][number]
) {
  return capability.endpoints?.length
    ? [capability.id, ...capability.endpoints.map(encodePahCapabilityEndpoint)]
    : [capability.id];
}

/**
 * 校验跨前后端插件的声明边界。
 *
 * 首版只接收 restart 激活模式；这里不加载入口文件，更不会 eval 插件内容。
 */
export function validatePahPluginManifest(
  manifest: unknown
): PahManifestValidationResult {
  const errors: string[] = [];

  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['manifest 必须是对象'] };
  }
  const input = manifest as Partial<PahPluginManifest>;

  const moduleId = isText(input.moduleId) ? input.moduleId : '';
  const routePrefix = isText(input.routePrefix)
    ? input.routePrefix
    : `/${moduleId}`;
  if (input.formatVersion !== PAH_PLUGIN_FORMAT_VERSION) {
    errors.push('formatVersion 不受支持');
  }
  if (!/^[a-z][a-z0-9-]*$/.test(moduleId)) {
    errors.push('moduleId 只能使用小写字母、数字和连字符');
  }
  if (!isText(input.name) || !input.name.trim()) errors.push('缺少插件名称');
  if (!isText(input.version) || !input.version.trim())
    errors.push('缺少插件版本');
  if (!isText(input.publisher) || !input.publisher.trim())
    errors.push('缺少发布者');
  if (!isText(input.license) || !input.license.trim())
    errors.push('缺少许可证声明');
  if (
    input.pluginType !== undefined &&
    input.pluginType !== 'phoenix.admin.branding'
  ) {
    errors.push(`pluginType 不受支持：${String(input.pluginType)}`);
  }
  if (input.activationMode !== 'restart') {
    errors.push('首版插件只允许受控重启激活');
  }
  if (!isSafeEntrypoint(input.entrypoints?.web)) {
    errors.push('Web 入口必须是包内安全相对路径');
  }
  if (!isSafeEntrypoint(input.entrypoints?.node)) {
    errors.push('Node 入口必须是包内安全相对路径');
  }
  if (input.apiPrefix !== `/admin/${moduleId}/`) {
    errors.push(`apiPrefix 必须限定为 /admin/${moduleId}/`);
  }
  if (!/^\/[a-z][a-z0-9-]*$/.test(routePrefix)) {
    errors.push(`routePrefix 必须是单段安全路径：${routePrefix}`);
  }
  errors.push(
    ...validatePahPublicLoginBrandingContributions(
      moduleId,
      input.pluginType,
      input.uiContributions
    ).errors
  );

  const routes = Array.isArray(input.routes) ? input.routes : [];
  if (!Array.isArray(input.routes)) errors.push('routes 必须是数组');
  const routeIds = new Set(routes.map(route => route?.id).filter(isText));
  for (const route of routes) {
    if (!route || typeof route !== 'object') {
      errors.push('路由声明必须是对象');
      continue;
    }
    if (!isText(route.id) || !route.id.startsWith(`${moduleId}-`)) {
      errors.push(`路由 ID 越界：${String(route.id ?? '')}`);
    }
    if (
      !isText(route.path) ||
      (route.path !== routePrefix && !route.path.startsWith(`${routePrefix}/`))
    ) {
      errors.push(`路由路径越界：${String(route.path ?? '')}`);
    }
    if (
      !isText(route.capability) ||
      !route.capability.startsWith(`${moduleId}:`)
    ) {
      errors.push(`路由能力码越界：${String(route.capability ?? '')}`);
    }
    if (!isSafeViewPath(route.viewPath, moduleId)) {
      errors.push(
        `路由视图必须位于 modules/${moduleId}/：${String(route.viewPath ?? '')}`
      );
    }
    if (route.isShow !== undefined && typeof route.isShow !== 'boolean') {
      errors.push(`路由显示标识必须为布尔值：${String(route.id ?? '')}`);
    }
    if (route.icon !== undefined && !isPahIconId(route.icon)) {
      errors.push(`路由图标必须使用显式命名空间：${String(route.icon)}`);
    }
  }
  for (const duplicate of duplicates(
    routes.map(route => route?.id).filter(isText)
  )) {
    errors.push(`重复路由 ID：${duplicate}`);
  }
  for (const duplicate of duplicates(
    routes.map(route => route?.path).filter(isText)
  )) {
    errors.push(`重复路由路径：${duplicate}`);
  }

  const navigationModules = Array.isArray(input.navigation?.modules)
    ? input.navigation.modules
    : [];
  if (!Array.isArray(input.navigation?.modules)) {
    errors.push('navigation.modules 必须是数组');
  }
  for (const module of navigationModules) {
    if (!module || typeof module !== 'object') {
      errors.push('导航模块声明必须是对象');
      continue;
    }
    if (!isText(module.id) || !module.id.startsWith(`${moduleId}-`)) {
      errors.push(`导航模块 ID 越界：${String(module.id ?? '')}`);
    }
    if (module.icon !== undefined && !isPahIconId(module.icon)) {
      errors.push(`导航模块图标必须使用显式命名空间：${String(module.icon)}`);
    }
    if (!Array.isArray(module.routeIds)) {
      errors.push(`导航模块缺少 routeIds：${String(module.id ?? '')}`);
      continue;
    }
    for (const routeId of module.routeIds.filter(isText)) {
      if (!routeIds.has(routeId)) errors.push(`导航引用未知路由：${routeId}`);
    }
  }

  const capabilities = Array.isArray(input.capabilities)
    ? input.capabilities
    : [];
  if (!Array.isArray(input.capabilities))
    errors.push('capabilities 必须是数组');
  for (const capability of capabilities) {
    if (
      !capability ||
      typeof capability !== 'object' ||
      !isText(capability.id) ||
      !capability.id.startsWith(`${moduleId}:`)
    ) {
      errors.push(`能力码越界：${String(capability?.id ?? '')}`);
    }
    if (
      capability?.endpoints !== undefined &&
      !Array.isArray(capability.endpoints)
    ) {
      errors.push(`能力 endpoint 必须是数组：${String(capability?.id ?? '')}`);
      continue;
    }
    if (
      Array.isArray(capability?.endpoints) &&
      capability.endpoints.length === 0
    ) {
      errors.push(`能力 endpoints 不能为空：${String(capability?.id ?? '')}`);
    }
    for (const endpoint of capability?.endpoints ?? []) {
      if (
        !endpoint ||
        typeof endpoint !== 'object' ||
        !PAH_CAPABILITY_HTTP_METHODS.includes(endpoint.method as any)
      ) {
        errors.push(
          `能力 endpoint method 不受支持：${String(capability?.id ?? '')}`
        );
      }
      if (
        !endpoint ||
        typeof endpoint !== 'object' ||
        !isSafeCapabilityEndpointPath(endpoint.path, input.apiPrefix ?? '')
      ) {
        errors.push(
          `能力 endpoint 路径越界或不安全：${String(
            endpoint && typeof endpoint === 'object' ? endpoint.path ?? '' : ''
          )}`
        );
      }
    }
    for (const duplicate of duplicates(
      (capability?.endpoints ?? [])
        .map(endpoint =>
          endpoint && typeof endpoint === 'object'
            ? `${String(endpoint.method)} ${String(endpoint.path)}`
            : ''
        )
        .filter(Boolean)
    )) {
      errors.push(`能力内重复 endpoint：${duplicate}`);
    }
  }
  for (const duplicate of duplicates(
    capabilities.map(item => item?.id).filter(isText)
  )) {
    errors.push(`重复能力码：${duplicate}`);
  }
  const capabilityIds = new Set(
    capabilities.map(item => item?.id).filter(isText)
  );
  for (const duplicate of duplicates(
    capabilities
      .flatMap(capability =>
        (capability?.endpoints ?? []).map(endpoint =>
          endpoint && typeof endpoint === 'object'
            ? `${String(endpoint.method)} ${String(endpoint.path)}`
            : ''
        )
      )
      .filter(Boolean)
  )) {
    errors.push(`多个能力重复声明 endpoint：${duplicate}`);
  }
  for (const route of routes) {
    if (isText(route?.capability) && !capabilityIds.has(route.capability)) {
      errors.push(`路由引用未声明能力码：${route.capability}`);
    }
  }

  const dictionaryContributions = Array.isArray(input.dictionaryContributions)
    ? input.dictionaryContributions
    : [];
  if (
    input.dictionaryContributions !== undefined &&
    !Array.isArray(input.dictionaryContributions)
  ) {
    errors.push('dictionaryContributions 必须是数组');
  }
  for (const contribution of dictionaryContributions) {
    if (
      !contribution ||
      typeof contribution !== 'object' ||
      !isText(contribution.id) ||
      !contribution.id.startsWith(`${moduleId}-`)
    ) {
      errors.push(`字典贡献 ID 越界：${String(contribution?.id ?? '')}`);
      continue;
    }
    if (
      !isText(contribution.typeKey) ||
      contribution.typeKey.length > 128 ||
      !contribution.typeKey.startsWith(`${moduleId}.`) ||
      !/^[a-z][a-z0-9-]*(\.[a-zA-Z][a-zA-Z0-9-]*)+$/.test(contribution.typeKey)
    ) {
      errors.push(
        `字典 typeKey 越界或不安全：${String(contribution.typeKey ?? '')}`
      );
    }
    if (!isText(contribution.typeName) || !contribution.typeName.trim()) {
      errors.push(`字典类型缺少名称：${contribution.id}`);
    }
    if (
      !Number.isInteger(contribution.policyVersion) ||
      contribution.policyVersion < 1
    ) {
      errors.push(`字典策略版本无效：${contribution.id}`);
    }
    if (contribution.retainOnUninstall !== true) {
      errors.push(`字典贡献卸载时必须保留：${contribution.id}`);
    }
    if (!Array.isArray(contribution.items) || contribution.items.length === 0) {
      errors.push(`字典贡献缺少 items：${contribution.id}`);
      continue;
    }
    const installPresets = Array.isArray(contribution.installPresets)
      ? contribution.installPresets
      : [];
    if (
      contribution.installPresets !== undefined &&
      !Array.isArray(contribution.installPresets)
    ) {
      errors.push(`字典安装 presets 必须是数组：${contribution.id}`);
    }
    for (const preset of installPresets) {
      if (!isText(preset) || !/^[a-z][a-z0-9-]*$/.test(preset)) {
        errors.push(
          `字典安装 preset 无效：${contribution.id}:${String(preset)}`
        );
      }
    }
    for (const duplicate of duplicates(installPresets.filter(isText))) {
      errors.push(`字典重复安装 preset：${contribution.id}:${duplicate}`);
    }
    for (const item of contribution.items) {
      if (
        !item ||
        typeof item !== 'object' ||
        !isText(item.value) ||
        !item.value.trim() ||
        item.value.length > 128 ||
        /[,\s]/.test(item.value)
      ) {
        errors.push(`字典 item value 无效：${contribution.id}`);
        continue;
      }
      if (!isText(item.name) || !item.name.trim()) {
        errors.push(`字典 item 缺少名称：${contribution.id}:${item.value}`);
      }
      if (!Number.isInteger(item.orderNum) || item.orderNum < 0) {
        errors.push(`字典 item 排序无效：${contribution.id}:${item.value}`);
      }
      if (!['core', 'default', 'transitional'].includes(item.itemClass)) {
        errors.push(`字典 item class 无效：${contribution.id}:${item.value}`);
      }
      const presets = Array.isArray(item.presets) ? item.presets : [];
      if (item.presets !== undefined && !Array.isArray(item.presets)) {
        errors.push(
          `字典 item presets 必须是数组：${contribution.id}:${item.value}`
        );
      }
      for (const preset of presets) {
        if (!isText(preset) || !/^[a-z][a-z0-9-]*$/.test(preset)) {
          errors.push(
            `字典 item preset 无效：${contribution.id}:${item.value}:${String(
              preset
            )}`
          );
        }
      }
      for (const duplicate of duplicates(presets.filter(isText))) {
        errors.push(
          `字典 item 重复 preset：${contribution.id}:${item.value}:${duplicate}`
        );
      }
      if (item.itemClass === 'core' && presets.length) {
        errors.push(
          `core 字典协议项不能受 preset 过滤：${contribution.id}:${item.value}`
        );
      }
      const tags = Array.isArray(item.tags) ? item.tags : [];
      if (item.tags !== undefined && !Array.isArray(item.tags)) {
        errors.push(
          `字典 item tags 必须是数组：${contribution.id}:${item.value}`
        );
      }
      if (tags.length > 32) {
        errors.push(
          `字典 item tags 不能超过 32 个：${contribution.id}:${item.value}`
        );
      }
      for (const tag of tags) {
        if (!isText(tag) || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(tag)) {
          errors.push(
            `字典 item tag 无效：${contribution.id}:${item.value}:${String(
              tag
            )}`
          );
        }
      }
      for (const duplicate of duplicates(tags.filter(isText))) {
        errors.push(
          `字典 item 重复 tag：${contribution.id}:${item.value}:${duplicate}`
        );
      }
      if (item.enabled !== undefined && typeof item.enabled !== 'boolean') {
        errors.push(
          `字典 item enabled 必须是布尔值：${contribution.id}:${item.value}`
        );
      }
      if (item.itemClass === 'core' && item.enabled === false) {
        errors.push(
          `core 字典协议项不能停用：${contribution.id}:${item.value}`
        );
      }
      if (
        item.customizable !== undefined &&
        (!Array.isArray(item.customizable) ||
          item.customizable.some(
            field => !['name', 'orderNum', 'enabled', 'tags'].includes(field)
          ))
      ) {
        errors.push(
          `字典 item 可定制字段无效：${contribution.id}:${item.value}`
        );
      }
      for (const duplicate of duplicates(
        Array.isArray(item.customizable) ? item.customizable.filter(isText) : []
      )) {
        errors.push(
          `字典 item 重复可定制字段：${contribution.id}:${item.value}:${duplicate}`
        );
      }
      if (
        item.itemClass === 'core' &&
        Array.isArray(item.customizable) &&
        item.customizable.some(field => field !== 'name')
      ) {
        errors.push(
          `core 字典协议项只能定制名称：${contribution.id}:${item.value}`
        );
      }
    }
    for (const duplicate of duplicates(
      contribution.items.map(item => item?.value).filter(isText)
    )) {
      errors.push(`字典贡献重复 item：${contribution.id}:${duplicate}`);
    }
  }
  for (const duplicate of duplicates(
    dictionaryContributions.map(item => item?.id).filter(isText)
  )) {
    errors.push(`重复字典贡献 ID：${duplicate}`);
  }
  for (const duplicate of duplicates(
    dictionaryContributions.map(item => item?.typeKey).filter(isText)
  )) {
    errors.push(`重复字典 typeKey：${duplicate}`);
  }

  const migrations = Array.isArray(input.migrations) ? input.migrations : [];
  if (!Array.isArray(input.migrations)) errors.push('migrations 必须是数组');
  for (const migration of migrations) {
    if (!migration || typeof migration !== 'object') {
      errors.push('迁移声明必须是对象');
      continue;
    }
    if (!isText(migration.id) || !migration.id.startsWith(`${moduleId}-`)) {
      errors.push(`迁移 ID 越界：${String(migration.id ?? '')}`);
    }
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      errors.push(`迁移版本必须是正整数：${String(migration.id ?? '')}`);
    }
    if (
      !isText(migration.checksum) ||
      !/^sha256:[a-f0-9]{64}$/.test(migration.checksum)
    ) {
      errors.push(`迁移校验和格式错误：${String(migration.id ?? '')}`);
    }
    if (!isText(migration.description) || !migration.description.trim()) {
      errors.push(`缺少迁移说明：${String(migration.id ?? '')}`);
    }
    if (migration.artifact?.format !== 'sql') {
      errors.push(`迁移制品格式不受支持：${String(migration.id ?? '')}`);
    }
    if (!isSafeMigrationArtifactPath(migration.artifact?.path)) {
      errors.push(
        `迁移制品路径不安全：${String(migration.artifact?.path ?? '')}`
      );
    }
  }
  for (const duplicate of duplicates(
    migrations.map(item => item?.id).filter(isText)
  )) {
    errors.push(`重复迁移 ID：${duplicate}`);
  }
  for (const duplicate of duplicates(
    migrations.map(item => String(item?.version ?? '')).filter(Boolean)
  )) {
    errors.push(`重复迁移版本：${duplicate}`);
  }
  for (const duplicate of duplicates(
    migrations.map(item => item?.artifact?.path).filter(isText)
  )) {
    errors.push(`重复迁移制品路径：${duplicate}`);
  }

  const healthChecks = Array.isArray(input.healthChecks)
    ? input.healthChecks
    : [];
  if (!Array.isArray(input.healthChecks))
    errors.push('healthChecks 必须是数组');
  for (const check of healthChecks) {
    if (
      !check ||
      typeof check !== 'object' ||
      !isText(check.id) ||
      !check.id.startsWith(`${moduleId}-`)
    ) {
      errors.push(`健康检查 ID 越界：${String(check?.id ?? '')}`);
    }
    if (!isText(check?.path) || !check.path.startsWith(`/admin/${moduleId}/`)) {
      errors.push(`健康检查路径越界：${String(check?.path ?? '')}`);
    }
  }

  const allowedReuse = new Set<string>(PAH_HOST_REUSE_CAPABILITIES);
  const hostReuse = Array.isArray(input.hostReuse) ? input.hostReuse : [];
  if (!Array.isArray(input.hostReuse)) errors.push('hostReuse 必须是数组');
  for (const capability of hostReuse) {
    if (!allowedReuse.has(capability)) {
      errors.push(`未知 Host 复用能力：${capability}`);
    }
  }
  const tables = Array.isArray(input.dataOwnership?.tables)
    ? input.dataOwnership.tables.filter(isText)
    : [];
  if (!Array.isArray(input.dataOwnership?.tables)) {
    errors.push('dataOwnership.tables 必须是数组');
  }
  for (const duplicate of duplicates(tables)) {
    errors.push(`重复数据表声明：${duplicate}`);
  }
  if (!input.dataOwnership?.retainedOnUninstall) {
    errors.push('卸载必须默认保留业务数据');
  }
  if (!input.uninstall?.retainDataByDefault) {
    errors.push('卸载策略必须默认保留数据');
  }
  if (!input.uninstall?.requiresBackup) {
    errors.push('卸载前必须要求备份');
  }
  if (
    !isText(input.uninstall?.purgeCapability) ||
    !input.uninstall.purgeCapability.startsWith(`${moduleId}:`)
  ) {
    errors.push('永久清除能力码必须属于插件命名空间');
  }

  return { valid: errors.length === 0, errors };
}
