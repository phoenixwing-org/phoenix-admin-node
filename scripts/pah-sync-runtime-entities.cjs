const { execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const path = require('node:path');

const MODULE_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const HOST_MODULE_IDS = new Set([
  'base',
  'demo',
  'dict',
  // `phoenix` is the canonical Host module directory. `pah` remains here only
  // for frozen pre-rename fixtures and must never be treated as a business plugin.
  'pah',
  'phoenix',
  'plugin',
  'recycle',
  'space',
  'swagger',
  'task',
  'user',
]);

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function safeRealDirectory(value) {
  try {
    const resolved = realpathSync(value);
    return statSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function gitValue(root, args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
  } catch {
    return null;
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function collectRuntimePayloadFiles(root, relative = '') {
  const directory = path.join(root, ...relative.split('/').filter(Boolean));
  const files = [];
  for (const name of readdirSync(directory).sort((left, right) =>
    left.localeCompare(right, 'en')
  )) {
    const next = relative ? `${relative}/${name}` : name;
    const absolute = path.join(root, ...next.split('/'));
    const current = lstatSync(absolute);
    if (current.isSymbolicLink()) {
      throw new Error(`正式插件 payload 不得包含 symlink：${next}`);
    }
    if (current.isDirectory()) {
      files.push(...collectRuntimePayloadFiles(root, next));
      continue;
    }
    if (!current.isFile()) {
      throw new Error(`正式插件 payload 含未知文件类型：${next}`);
    }
    const content = readFileSync(absolute);
    files.push({
      path: next,
      size: current.size,
      sha256: createHash('sha256').update(content).digest('hex'),
    });
  }
  return files;
}

function runtimePayloadDigest(root) {
  const current = lstatSync(root);
  if (current.isSymbolicLink() || !current.isDirectory()) {
    throw new Error('正式插件 payload 必须是 Host 管理的普通目录');
  }
  const files = collectRuntimePayloadFiles(root);
  return {
    fileCount: files.length,
    size: files.reduce((total, item) => total + item.size, 0),
    sha256: createHash('sha256').update(canonicalJson(files)).digest('hex'),
  };
}

function inspectReleaseEntityModule(root, moduleId, moduleRoot) {
  const receiptFile = path.join(
    root,
    '.runtime',
    'phoenix-plugin-activation',
    'receipts',
    `${moduleId}.json`
  );
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
  } catch {
    return {
      eligible: false,
      detail: '正式 payload 缺少启动前可信 Host 激活收据',
    };
  }
  const expected = receipt && receipt.payloads && receipt.payloads.node;
  if (
    !receipt ||
    receipt.formatVersion !== 1 ||
    receipt.moduleId !== moduleId ||
    typeof receipt.version !== 'string' ||
    !receipt.version ||
    (receipt.pluginType !== null && typeof receipt.pluginType !== 'string') ||
    !SHA256_PATTERN.test(receipt.packageSha256 || '') ||
    !SHA256_PATTERN.test(receipt.manifestSha256 || '') ||
    !expected ||
    !Number.isSafeInteger(expected.fileCount) ||
    expected.fileCount < 1 ||
    !Number.isSafeInteger(expected.size) ||
    expected.size < 1 ||
    !SHA256_PATTERN.test(expected.sha256 || '')
  ) {
    return { eligible: false, detail: '正式 payload 的 Host 激活收据无效' };
  }
  try {
    const actual = runtimePayloadDigest(moduleRoot);
    if (
      actual.fileCount !== expected.fileCount ||
      actual.size !== expected.size ||
      actual.sha256 !== expected.sha256
    ) {
      return {
        eligible: false,
        detail: '正式 node payload 与 Host 激活收据不匹配',
      };
    }
  } catch (error) {
    return {
      eligible: false,
      detail: `正式 node payload 无法验证：${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  if (!existsSync(path.join(moduleRoot, 'config.ts'))) {
    return { eligible: false, detail: '正式 node payload 缺少 config.ts' };
  }
  if (receipt.pluginType === 'phoenix.admin.branding') {
    return {
      eligible: false,
      state: 'ready',
      detail: `trusted release ${receipt.version}; policy=no-entities`,
    };
  }
  return {
    eligible: true,
    state: 'ready',
    detail: `trusted release ${receipt.version}`,
  };
}

function inspectDevelopmentEntityModule(moduleId, moduleRoot) {
  const nodeSource = safeRealDirectory(moduleRoot);
  if (!nodeSource)
    return { eligible: false, detail: 'Node symlink 目标不存在' };
  const productRootValue = gitValue(nodeSource, [
    'rev-parse',
    '--show-toplevel',
  ]);
  const productRoot = productRootValue
    ? safeRealDirectory(productRootValue)
    : null;
  if (!productRoot)
    return { eligible: false, detail: '不属于可验证的 Git 产品仓' };
  const sourceCommit = gitValue(productRoot, ['rev-parse', 'HEAD']);
  if (!sourceCommit || !COMMIT_PATTERN.test(sourceCommit)) {
    return { eligible: false, detail: '产品 HEAD 无法验证' };
  }
  const packageRoot = path.resolve(nodeSource, '..', '..');
  const manifestFile = path.join(packageRoot, 'manifest.json');
  const webSource = safeRealDirectory(path.join(packageRoot, 'vue', moduleId));
  if (
    !inside(productRoot, packageRoot) ||
    !inside(productRoot, nodeSource) ||
    !webSource ||
    !inside(productRoot, webSource)
  ) {
    return { eligible: false, detail: '双端 payload 越出同一产品 Git 根' };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  } catch {
    return { eligible: false, detail: 'manifest 无法读取' };
  }
  if (
    !manifest ||
    manifest.formatVersion !== 2 ||
    manifest.moduleId !== moduleId ||
    manifest.activationMode !== 'restart' ||
    !manifest.entrypoints ||
    manifest.entrypoints.node !== `midway/${moduleId}/config.ts` ||
    manifest.entrypoints.web !== `vue/${moduleId}/config.ts` ||
    !existsSync(path.join(nodeSource, 'config.ts')) ||
    !existsSync(path.join(webSource, 'config.ts'))
  ) {
    return { eligible: false, detail: 'manifest 身份或双端入口不匹配' };
  }
  if (manifest.pluginType === 'phoenix.admin.branding') {
    return {
      eligible: false,
      state: 'ready',
      detail: 'policy=no-entities 品牌插件不参与实体聚合',
    };
  }
  const relativePaths = [manifestFile, nodeSource, webSource].map(item =>
    path.relative(productRoot, item)
  );
  const dirty = gitValue(productRoot, [
    'status',
    '--porcelain',
    '--',
    ...relativePaths,
  ]);
  if (dirty === null || dirty.length > 0) {
    return {
      eligible: false,
      detail: 'manifest 或双端 payload 存在未归档修改',
    };
  }
  return { eligible: true, detail: `clean development ${sourceCommit}` };
}

function preflightRuntimeEntityModules(root) {
  const modulesRoot = path.join(root, 'src', 'modules');
  const ignoredModuleIds = [];
  const inspections = [];
  if (!existsSync(modulesRoot)) return { ignoredModuleIds, inspections };
  for (const moduleId of readdirSync(modulesRoot).sort()) {
    if (HOST_MODULE_IDS.has(moduleId)) continue;
    const moduleRoot = path.join(modulesRoot, moduleId);
    let current;
    try {
      current = lstatSync(moduleRoot);
    } catch {
      ignoredModuleIds.push(moduleId);
      inspections.push({
        moduleId,
        eligible: false,
        detail: '模块在扫描期间发生变化',
      });
      continue;
    }
    if (!current.isSymbolicLink()) {
      if (current.isDirectory()) {
        const inspection = inspectReleaseEntityModule(
          root,
          moduleId,
          moduleRoot
        );
        inspections.push({ moduleId, ...inspection });
        if (!inspection.eligible) ignoredModuleIds.push(moduleId);
      }
      continue;
    }
    if (!MODULE_ID_PATTERN.test(moduleId)) {
      ignoredModuleIds.push(moduleId);
      inspections.push({
        moduleId,
        eligible: false,
        detail: 'moduleId 格式不安全',
      });
      continue;
    }
    const inspection = inspectDevelopmentEntityModule(moduleId, moduleRoot);
    inspections.push({ moduleId, ...inspection });
    if (!inspection.eligible) ignoredModuleIds.push(moduleId);
  }
  return { ignoredModuleIds, inspections };
}

function requireAdminNodeRoot(value) {
  const root = path.resolve(value);
  const manifestPath = path.join(root, 'package.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error(
      `无法读取 Phoenix Admin Node package.json：${manifestPath}`
    );
  }
  if (manifest.name !== 'phoenix-admin-node') {
    throw new Error(`实体生成根目录不是 Phoenix Admin Node：${root}`);
  }
  return root;
}

function isDirectory(value) {
  return statSync(value).isDirectory();
}

function collectEntityFiles(directory, relative = '') {
  if (!existsSync(directory)) return [];
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
    (left, right) => left.name.localeCompare(right.name, 'en')
  )) {
    const absolute = path.join(directory, entry.name);
    const currentRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const current = lstatSync(absolute);
    if (current.isSymbolicLink()) {
      throw new Error(`实体目录内部不得包含符号链接：${currentRelative}`);
    }
    if (current.isDirectory()) {
      result.push(...collectEntityFiles(absolute, currentRelative));
      continue;
    }
    if (current.isFile() && entry.name.endsWith('.ts')) {
      result.push(currentRelative);
    }
  }
  return result;
}

function discoverRuntimeEntities(root, ignoredModuleIds = new Set()) {
  const modulesRoot = path.join(root, 'src', 'modules');
  if (!existsSync(modulesRoot)) return [];
  if (!isDirectory(modulesRoot)) {
    throw new Error(`Admin Node modules 路径不是目录：${modulesRoot}`);
  }

  const files = [];
  for (const entry of readdirSync(modulesRoot, { withFileTypes: true }).sort(
    (left, right) => left.name.localeCompare(right.name, 'en')
  )) {
    if (ignoredModuleIds.has(entry.name)) continue;
    const moduleRoot = path.join(modulesRoot, entry.name);
    const current = lstatSync(moduleRoot);
    if (!current.isDirectory() && !current.isSymbolicLink()) continue;
    if (!isDirectory(moduleRoot)) {
      throw new Error(`Admin Node 模块链接未指向目录：${moduleRoot}`);
    }
    const entityRoot = path.join(moduleRoot, 'entity');
    for (const relative of collectEntityFiles(entityRoot)) {
      files.push(`modules/${entry.name}/entity/${relative}`);
    }
  }
  return files;
}

function fixedHostEntityFiles(root) {
  const fixedEntry = path.join(root, 'src', 'entities.ts');
  if (!existsSync(fixedEntry)) {
    throw new Error(`缺少 Phoenix Admin Host 固定实体入口：${fixedEntry}`);
  }
  const content = readFileSync(fixedEntry, 'utf8');
  if (!content.includes("import { pluginEntities } from './entities.plugin'")) {
    throw new Error('Host 固定实体入口没有引用 ./entities.plugin');
  }
  const files = new Set();
  const pattern = /from '\.\/(modules\/[^']+\.ts|modules\/[^']+)'/g;
  for (const match of content.matchAll(pattern)) {
    files.add(match[1].endsWith('.ts') ? match[1] : `${match[1]}.ts`);
  }
  return files;
}

function renderRuntimeEntities(files) {
  const imports = files.map(
    (file, index) =>
      `import * as pluginEntity${index} from './${file.replace(/\.ts$/, '')}';`
  );
  const values = files.map(
    (_, index) => `...Object.values(pluginEntity${index})`
  );
  const exportBlock =
    values.length === 0
      ? 'export const pluginEntities = [];\n'
      : `export const pluginEntities = [\n  ${values.join(',\n  ')},\n];\n`;
  return `// 自动生成的插件实体清单，请勿手动修改\n${imports.join('\n')}${
    imports.length ? '\n' : ''
  }${exportBlock}`;
}

function replaceFileAtomically(target, content) {
  if (existsSync(target) && readFileSync(target, 'utf8') === content) {
    return false;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const backup = `${target}.${process.pid}.${randomUUID()}.bak`;
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, content, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    try {
      renameSync(temporary, target);
    } catch (error) {
      if (!existsSync(target)) throw error;
      renameSync(target, backup);
      try {
        renameSync(temporary, target);
        rmSync(backup, { force: true });
      } catch (replaceError) {
        if (!existsSync(target) && existsSync(backup))
          renameSync(backup, target);
        throw replaceError;
      }
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
    if (existsSync(backup) && existsSync(target))
      rmSync(backup, { force: true });
  }
  return true;
}

function writeRuntimeTsconfig(root, ignoredModuleIds) {
  const base = path.join(root, 'tsconfig.json');
  if (!existsSync(base)) return null;
  const target = path.join(root, '.runtime', 'tsconfig.phoenix.json');
  const value = {
    extends: '../tsconfig.json',
    include: ['../src/**/*.ts'],
    exclude: [
      '../dist',
      '../node_modules',
      '../test',
      ...ignoredModuleIds.map(moduleId => `../src/modules/${moduleId}/**/*`),
    ],
  };
  replaceFileAtomically(target, `${JSON.stringify(value, null, 2)}\n`);
  return target;
}

function renderEntitySelection(root, ignoredModuleIds) {
  const ignored = new Set(ignoredModuleIds);
  const discovered = discoverRuntimeEntities(root, ignored);
  const fixed = fixedHostEntityFiles(root);
  const missingHostFiles = [...fixed].filter(
    file => !discovered.includes(file)
  );
  if (missingHostFiles.length > 0) {
    throw new Error(`Host 固定实体文件缺失：${missingHostFiles.join('、')}`);
  }
  const files = discovered.filter(file => !fixed.has(file));
  return { files, content: renderRuntimeEntities(files) };
}

function checkTypeScriptCompatibility(root, ignoredModuleIds) {
  try {
    const selection = renderEntitySelection(root, ignoredModuleIds);
    replaceFileAtomically(
      path.join(root, 'src', 'entities.plugin.ts'),
      selection.content
    );
    const tsconfig = writeRuntimeTsconfig(root, ignoredModuleIds);
    if (!tsconfig) return { valid: true, detail: 'fixture without tsconfig' };
    execFileSync(
      process.execPath,
      [
        require.resolve('typescript/bin/tsc'),
        '-p',
        tsconfig,
        '--noEmit',
        '--pretty',
        'false',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
      }
    );
    return { valid: true, detail: 'Host TypeScript compatibility passed' };
  } catch (error) {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error
        ? String(error.stderr || '')
        : '';
    const stdout =
      error && typeof error === 'object' && 'stdout' in error
        ? String(error.stdout || '')
        : '';
    const firstDiagnostic = `${stdout}\n${stderr}`
      .split(/\r?\n/)
      .map(line => line.trim())
      .find(Boolean);
    return {
      valid: false,
      detail:
        firstDiagnostic ||
        (error instanceof Error ? error.message : String(error)) ||
        'TypeScript compatibility command failed',
    };
  }
}

function verifyPluginCompatibility(root, preflight, explicitIgnoredModuleIds) {
  const externalModuleIds = preflight.inspections.map(item => item.moduleId);
  const identityRejected = preflight.inspections
    .filter(item => !item.eligible)
    .map(item => item.moduleId);
  const baselineIgnored = [
    ...new Set([...explicitIgnoredModuleIds, ...externalModuleIds]),
  ].sort();
  const baseline = checkTypeScriptCompatibility(root, baselineIgnored);
  if (!baseline.valid) {
    throw new Error(`纯 Host TypeScript 基线失败：${baseline.detail}`);
  }
  for (const inspection of preflight.inspections.filter(
    item => item.eligible
  )) {
    const ignored = [
      ...new Set([
        ...explicitIgnoredModuleIds,
        ...identityRejected,
        ...externalModuleIds.filter(
          moduleId => moduleId !== inspection.moduleId
        ),
      ]),
    ].sort();
    const compatibility = checkTypeScriptCompatibility(root, ignored);
    if (compatibility.valid) {
      inspection.detail = `${inspection.detail}; TypeScript compatibility passed`;
    } else {
      inspection.eligible = false;
      inspection.detail = `Host TypeScript compatibility failed: ${compatibility.detail}`;
    }
  }
}

function writeCompileInspection(root, ignoredModuleIds, inspections) {
  const target = path.join(root, '.runtime', 'pah-plugin-compile.json');
  replaceFileAtomically(
    target,
    `${JSON.stringify(
      {
        formatVersion: 1,
        ignoredModuleIds,
        inspections,
      },
      null,
      2
    )}\n`
  );
  return target;
}

function syncRuntimeEntities(inputRoot, options = {}) {
  const root = requireAdminNodeRoot(inputRoot);
  const preflight = preflightRuntimeEntityModules(root);
  const explicitIgnoredModuleIds = options.ignoredModuleIds || [];
  verifyPluginCompatibility(root, preflight, explicitIgnoredModuleIds);
  const ignoredModuleIds = new Set([
    ...explicitIgnoredModuleIds,
    ...preflight.inspections
      .filter(item => !item.eligible)
      .map(item => item.moduleId),
  ]);
  const sortedIgnoredModuleIds = [...ignoredModuleIds].sort();
  const { files, content } = renderEntitySelection(
    root,
    sortedIgnoredModuleIds
  );
  const output = path.join(root, 'src', 'entities.plugin.ts');
  replaceFileAtomically(output, content);
  const tsconfig = writeRuntimeTsconfig(root, sortedIgnoredModuleIds);
  const inspectionFile = writeCompileInspection(
    root,
    sortedIgnoredModuleIds,
    preflight.inspections
  );
  return {
    root,
    output,
    count: files.length,
    files,
    ignoredModuleIds: sortedIgnoredModuleIds,
    inspections: preflight.inspections,
    inspectionFile,
    tsconfig,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

function cliRoot(argv) {
  const rootIndex = argv.indexOf('--root');
  if (rootIndex === -1) return process.cwd();
  if (!argv[rootIndex + 1]) throw new Error('--root 缺少目录参数');
  return argv[rootIndex + 1];
}

function cliIgnoredModuleIds(argv) {
  const result = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--ignore-module') continue;
    const moduleId = argv[index + 1];
    if (!moduleId || !/^[a-z][a-z0-9-]*$/.test(moduleId)) {
      throw new Error('--ignore-module 缺少安全 moduleId');
    }
    result.push(moduleId);
    index += 1;
  }
  return result;
}

if (require.main === module) {
  try {
    const argv = process.argv.slice(2);
    const result = syncRuntimeEntities(cliRoot(argv), {
      ignoredModuleIds: cliIgnoredModuleIds(argv),
    });
    for (const inspection of result.inspections) {
      const state =
        inspection.state || (inspection.eligible ? 'ready' : 'quarantined');
      process.stdout.write(
        `[phoenix-plugin-health] host=node phase=entities module=${inspection.moduleId} state=${state} detail=${inspection.detail}\n`
      );
    }
    process.stdout.write(
      `[Pah entities] synchronized count=${result.count} ignored=${result.ignoredModuleIds.length} sha256=${result.sha256}\n`
    );
  } catch (error) {
    process.stderr.write(
      `[Pah entities] failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    process.exitCode = 1;
  }
}

module.exports = {
  discoverRuntimeEntities,
  fixedHostEntityFiles,
  renderRuntimeEntities,
  preflightRuntimeEntityModules,
  verifyPluginCompatibility,
  syncRuntimeEntities,
  writeRuntimeTsconfig,
};
