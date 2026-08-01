export const PAH_PLUGIN_FORMAT_VERSION = 1 as const;

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

export interface PahPluginManifest {
  formatVersion: number;
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
      routeIds: string[];
    }>;
  };
  apiPrefix: string;
  capabilities: Array<{
    id: string;
    description: string;
    risk: 'read' | 'write' | 'admin';
  }>;
  resourcePolicies: string[];
  auditCategories: Array<{ id: string; description: string }>;
  migrations: Array<{
    id: string;
    version: number;
    checksum: string;
    description: string;
  }>;
  healthChecks: Array<{ id: string; path: string }>;
  hostReuse: PahHostReuseCapability[];
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
  verified: ['staged', 'rejected', 'failed'],
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
  }
  for (const duplicate of duplicates(
    capabilities.map(item => item?.id).filter(isText)
  )) {
    errors.push(`重复能力码：${duplicate}`);
  }
  const capabilityIds = new Set(
    capabilities.map(item => item?.id).filter(isText)
  );
  for (const route of routes) {
    if (isText(route?.capability) && !capabilityIds.has(route.capability)) {
      errors.push(`路由引用未声明能力码：${route.capability}`);
    }
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
      !/^sha256:[a-f0-9]{32,128}$/.test(migration.checksum)
    ) {
      errors.push(`迁移校验和格式错误：${String(migration.id ?? '')}`);
    }
    if (!isText(migration.description) || !migration.description.trim()) {
      errors.push(`缺少迁移说明：${String(migration.id ?? '')}`);
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
