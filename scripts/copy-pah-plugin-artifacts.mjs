import { createHash } from 'node:crypto';
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
} from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { loadAndVerifyManifest: loadAndVerifyHostBaseline } = require(
  './pah-host-baseline.cjs'
);
const {
  pruneIgnoredRuntimeModules,
} = require('./pah-prune-ignored-runtime-modules.cjs');

const descriptorName = 'pah-plugin.artifacts.json';
const descriptorRuntimeArtifactKeys = [
  'format',
  'id',
  'path',
  'runtime',
  'sha256',
  'size',
];
const runtimeArtifactIdPattern = /^[a-z][a-z0-9-]{0,63}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const sourceModules = path.resolve('src/modules');
const targetModules = path.resolve('dist/modules');
const pruneResult = pruneIgnoredRuntimeModules(process.cwd());
const ignoredModuleIds = new Set(pruneResult.ignoredModuleIds);
process.stdout.write(
  `[phoenix-plugin-health] host=node phase=artifact-copy ignored=${ignoredModuleIds.size} removed=${pruneResult.removedModuleIds.length}\n`
);
const hostSchemaDescriptorName = 'pah-host-schema.json';
const nodeBuiltinImports = new Set(
  builtinModules.flatMap(name => [name, name.startsWith('node:') ? name : `node:${name}`])
);

function fail(moduleId, message) {
  throw new Error(`Pah 插件 ${moduleId} 的运行时制品${message}`);
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function contained(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function validateArtifactPath(moduleId, artifactPath) {
  if (
    typeof artifactPath !== 'string' ||
    !artifactPath ||
    artifactPath.includes('\\') ||
    artifactPath.includes('\0') ||
    path.posix.isAbsolute(artifactPath) ||
    path.win32.isAbsolute(artifactPath)
  ) {
    fail(moduleId, ' path 必须是安全的 POSIX 相对路径');
  }
  const segments = artifactPath.split('/');
  if (
    segments.some(segment => !segment || segment === '.' || segment === '..') ||
    path.posix.normalize(artifactPath) !== artifactPath ||
    artifactPath === descriptorName ||
    artifactPath.startsWith('migrations/') ||
    path.posix.extname(artifactPath) !== '.cjs'
  ) {
    fail(moduleId, ' path 不合法或会覆盖受保护制品');
  }
  return segments;
}

function validateRuntimeArtifacts(moduleId, descriptor) {
  if (descriptor.runtimeArtifacts === undefined) return [];
  if (!Array.isArray(descriptor.runtimeArtifacts)) {
    fail(moduleId, ' runtimeArtifacts 必须是数组');
  }
  const ids = new Set();
  const paths = new Set();
  return descriptor.runtimeArtifacts.map((artifact, index) => {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      fail(moduleId, ` #${index + 1} 描述无效`);
    }
    const keys = Object.keys(artifact).sort();
    if (
      keys.length !== descriptorRuntimeArtifactKeys.length ||
      keys.some((key, keyIndex) => key !== descriptorRuntimeArtifactKeys[keyIndex])
    ) {
      fail(moduleId, ` ${artifact.id || `#${index + 1}`} 只能声明固定字段`);
    }
    if (!runtimeArtifactIdPattern.test(artifact.id) || ids.has(artifact.id)) {
      fail(moduleId, ` ${artifact.id || `#${index + 1}`} id 不合法或重复`);
    }
    if (artifact.runtime !== 'node' || artifact.format !== 'commonjs') {
      fail(moduleId, ` ${artifact.id} 只允许 node/commonjs`);
    }
    validateArtifactPath(moduleId, artifact.path);
    if (paths.has(artifact.path)) {
      fail(moduleId, ` ${artifact.id} path 重复`);
    }
    if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0) {
      fail(moduleId, ` ${artifact.id} size 必须是正安全整数`);
    }
    if (typeof artifact.sha256 !== 'string' || !sha256Pattern.test(artifact.sha256)) {
      fail(moduleId, ` ${artifact.id} sha256 必须是 64 位小写十六进制`);
    }
    ids.add(artifact.id);
    paths.add(artifact.path);
    return artifact;
  });
}

function skipSpaceAndComments(source, start) {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '/') {
      index = source.indexOf('\n', index + 2);
      if (index < 0) return source.length;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      index = source.indexOf('*/', index + 2);
      if (index < 0) return source.length;
      index += 2;
      continue;
    }
    break;
  }
  return index;
}

function readQuotedSpecifier(moduleId, artifactId, source, start) {
  const quote = source[start];
  let value = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === quote) return { value, end: index + 1 };
    if (character === '\\') {
      const escaped = source[index + 1];
      if (escaped === quote || escaped === '\\') {
        value += escaped;
        index += 1;
        continue;
      }
      fail(moduleId, ` ${artifactId} import specifier 含不允许的转义`);
    }
    if (character === '\n' || character === '\r') {
      fail(moduleId, ` ${artifactId} import specifier 未闭合`);
    }
    value += character;
  }
  fail(moduleId, ` ${artifactId} import specifier 未闭合`);
}

function collectRuntimeImports(moduleId, artifactId, source) {
  const imports = [];
  let index = 0;
  while (index < source.length) {
    index = skipSpaceAndComments(source, index);
    const character = source[index];
    if (character === '"' || character === "'" || character === '`') {
      const quote = character;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') index += 2;
        else if (source[index] === quote) {
          index += 1;
          break;
        } else index += 1;
      }
      continue;
    }
    if (!/[A-Za-z_$]/.test(character || '')) {
      index += 1;
      continue;
    }
    const identifierStart = index;
    index += 1;
    while (/[A-Za-z0-9_$]/.test(source[index] || '')) index += 1;
    const identifier = source.slice(identifierStart, index);
    if (identifier !== 'require' && identifier !== 'import') continue;

    let callIndex = skipSpaceAndComments(source, index);
    if (identifier === 'require' && source[callIndex] === '.') {
      callIndex = skipSpaceAndComments(source, callIndex + 1);
      if (source.slice(callIndex, callIndex + 7) !== 'resolve') continue;
      callIndex = skipSpaceAndComments(source, callIndex + 7);
    }
    if (source[callIndex] !== '(') {
      if (identifier === 'import') {
        fail(moduleId, ` ${artifactId} commonjs 制品不得包含静态 ESM import`);
      }
      continue;
    }
    const argumentIndex = skipSpaceAndComments(source, callIndex + 1);
    if (source[argumentIndex] !== '"' && source[argumentIndex] !== "'") {
      fail(moduleId, ` ${artifactId} 不得使用动态 ${identifier}`);
    }
    const specifier = readQuotedSpecifier(
      moduleId,
      artifactId,
      source,
      argumentIndex
    );
    const closeIndex = skipSpaceAndComments(source, specifier.end);
    if (source[closeIndex] !== ')') {
      fail(moduleId, ` ${artifactId} import 调用格式不受支持`);
    }
    imports.push(specifier.value);
    index = closeIndex + 1;
  }
  return imports;
}

function validateRuntimeImports(moduleId, artifact, source, declaredPaths) {
  for (const specifier of collectRuntimeImports(moduleId, artifact.id, source)) {
    if (nodeBuiltinImports.has(specifier)) continue;
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(artifact.path), specifier)
      );
      if (declaredPaths.has(resolved)) continue;
    }
    fail(moduleId, ` ${artifact.id} 引用了未声明的运行时依赖 ${specifier}`);
  }
}

async function readVerifiedRuntimeArtifact(moduleId, moduleRoot, artifact, declaredPaths) {
  const segments = validateArtifactPath(moduleId, artifact.path);
  let current = moduleRoot;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let info;
    try {
      info = await lstat(current);
    } catch {
      fail(moduleId, ` ${artifact.id} 文件不存在`);
    }
    if (info.isSymbolicLink()) {
      fail(moduleId, ` ${artifact.id} path 不得包含 symlink`);
    }
    if (index < segments.length - 1 && !info.isDirectory()) {
      fail(moduleId, ` ${artifact.id} path 中间项不是目录`);
    }
    if (index === segments.length - 1 && !info.isFile()) {
      fail(moduleId, ` ${artifact.id} 不是普通文件`);
    }
  }
  const realModuleRoot = await realpath(moduleRoot);
  const realArtifact = await realpath(current);
  if (!contained(realModuleRoot, realArtifact)) {
    fail(moduleId, ` ${artifact.id} realpath 越出插件根目录`);
  }
  const content = await readFile(realArtifact);
  if (content.byteLength !== artifact.size) {
    fail(moduleId, ` ${artifact.id} size 不匹配`);
  }
  if (sha256(content) !== artifact.sha256) {
    fail(moduleId, ` ${artifact.id} sha256 不匹配`);
  }
  validateRuntimeImports(
    moduleId,
    artifact,
    content.toString('utf8'),
    declaredPaths
  );
  return content;
}
async function isDirectory(target) {
  try {
    return (await lstat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function exists(target) {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function listPackagedRuntimeArtifacts(moduleId, moduleRoot, runtimeRoot) {
  if (!(await exists(runtimeRoot))) return [];
  const packaged = [];
  const visit = async directory => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        fail(moduleId, ' runtime path 不得包含 symlink');
      }
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.cjs')) {
        packaged.push(
          path.relative(moduleRoot, absolute).split(path.sep).join('/')
        );
      }
    }
  };
  const runtimeInfo = await lstat(runtimeRoot);
  if (runtimeInfo.isSymbolicLink() || !runtimeInfo.isDirectory()) {
    fail(moduleId, ' runtime 必须是普通目录且不得为 symlink');
  }
  await visit(runtimeRoot);
  return packaged.sort();
}

for (const entry of await readdir(sourceModules, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
  if (ignoredModuleIds.has(entry.name)) continue;
  const moduleRoot = path.join(sourceModules, entry.name);
  const descriptorPath = path.join(moduleRoot, descriptorName);
  const migrationsPath = path.join(moduleRoot, 'migrations');
  const runtimePath = path.join(moduleRoot, 'runtime');
  const hasMigrations = await isDirectory(migrationsPath);
  const hasRuntime = await exists(runtimePath);
  let descriptorBytes;
  let descriptor;
  try {
    descriptorBytes = await readFile(descriptorPath);
    descriptor = JSON.parse(descriptorBytes.toString('utf8'));
  } catch (error) {
    if (!hasMigrations && !hasRuntime && error?.code === 'ENOENT') continue;
    throw new Error(`Pah 插件 ${entry.name} 缺少或无法解析 ${descriptorName}`);
  }
  if (
    descriptor.formatVersion !== 1 ||
    descriptor.moduleId !== entry.name ||
    typeof descriptor.version !== 'string' ||
    !descriptor.version.trim()
  ) {
    throw new Error(`Pah 插件 ${entry.name} 的制品描述符不匹配`);
  }

  const runtimeArtifacts = validateRuntimeArtifacts(entry.name, descriptor);
  const declaredPaths = new Set(runtimeArtifacts.map(artifact => artifact.path));
  const packagedRuntimeArtifacts = await listPackagedRuntimeArtifacts(
    entry.name,
    moduleRoot,
    runtimePath
  );
  const undeclaredRuntimeArtifacts = packagedRuntimeArtifacts.filter(
    artifactPath => !declaredPaths.has(artifactPath)
  );
  if (undeclaredRuntimeArtifacts.length > 0) {
    fail(
      entry.name,
      ` 包含未声明的 runtime 文件 ${undeclaredRuntimeArtifacts.join(', ')}`
    );
  }
  const verifiedRuntimeArtifacts = [];
  for (const artifact of runtimeArtifacts) {
    verifiedRuntimeArtifacts.push({
      artifact,
      content: await readVerifiedRuntimeArtifact(
        entry.name,
        moduleRoot,
        artifact,
        declaredPaths
      ),
    });
  }

  const targetRoot = path.join(targetModules, entry.name);
  await mkdir(targetRoot, { recursive: true });
  await copyFile(descriptorPath, path.join(targetRoot, descriptorName));
  if (hasMigrations) {
    await cp(migrationsPath, path.join(targetRoot, 'migrations'), {
      recursive: true,
      force: true,
    });
  }
  for (const { artifact, content } of verifiedRuntimeArtifacts) {
    const target = path.join(targetRoot, ...artifact.path.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(moduleRoot, ...artifact.path.split('/')), target);
    const copied = await readFile(target);
    if (
      copied.byteLength !== content.byteLength ||
      sha256(copied) !== artifact.sha256
    ) {
      fail(entry.name, ` ${artifact.id} dist 复制后校验失败`);
    }
  }
}

const pahSourceRoot = path.join(sourceModules, 'pah');
const pahTargetRoot = path.join(targetModules, 'pah');
const hostSchemaDescriptorPath = path.join(
  pahSourceRoot,
  hostSchemaDescriptorName
);
const hostSchema = JSON.parse(await readFile(hostSchemaDescriptorPath, 'utf8'));
if (
  hostSchema.formatVersion !== 1 ||
  hostSchema.schemaId !== 'pah-host' ||
  !Number.isInteger(hostSchema.version) ||
  !Array.isArray(hostSchema.migrations) ||
  hostSchema.migrations.length === 0
) {
  throw new Error('Pah Host schema 描述符不合法');
}
const declaredPaths = [];
for (const migration of hostSchema.migrations) {
  if (
    !Number.isInteger(migration.version) ||
    typeof migration.path !== 'string' ||
    !/^schema\/[a-z0-9][a-z0-9._-]*\.sql$/u.test(migration.path) ||
    !/^sha256:[a-f0-9]{64}$/u.test(migration.checksum)
  ) {
    throw new Error(`Pah Host schema migration 声明不合法：${migration.id}`);
  }
  const content = await readFile(path.join(pahSourceRoot, migration.path));
  const checksum = `sha256:${createHash('sha256').update(content).digest('hex')}`;
  if (checksum !== migration.checksum) {
    throw new Error(`Pah Host schema migration 校验和不匹配：${migration.id}`);
  }
  declaredPaths.push(migration.path);
}
const packagedPaths = (await readdir(path.join(pahSourceRoot, 'schema')))
  .filter(name => name.endsWith('.sql'))
  .map(name => `schema/${name}`)
  .sort();
if (JSON.stringify([...declaredPaths].sort()) !== JSON.stringify(packagedPaths)) {
  throw new Error('Pah Host schema 声明与 SQL 制品不是一一对应');
}
await mkdir(pahTargetRoot, { recursive: true });
await cp(hostSchemaDescriptorPath, path.join(pahTargetRoot, hostSchemaDescriptorName), {
  force: true,
});
await cp(path.join(pahSourceRoot, 'schema'), path.join(pahTargetRoot, 'schema'), {
  recursive: true,
  force: true,
});

const hostBaselineSourceRoot = path.join(pahSourceRoot, 'host-baseline');
loadAndVerifyHostBaseline(hostBaselineSourceRoot);
await cp(
  hostBaselineSourceRoot,
  path.join(pahTargetRoot, 'host-baseline'),
  { recursive: true, force: true }
);
