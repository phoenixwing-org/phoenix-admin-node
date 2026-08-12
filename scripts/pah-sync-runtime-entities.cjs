#!/usr/bin/env node

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
  rmSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const path = require('node:path');

function requireAdminNodeRoot(value) {
  const root = path.resolve(value);
  const manifestPath = path.join(root, 'package.json');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error(`无法读取 Phoenix Admin Node package.json：${manifestPath}`);
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
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => (
    left.name.localeCompare(right.name, 'en')
  ))) {
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

function discoverRuntimeEntities(root) {
  const modulesRoot = path.join(root, 'src', 'modules');
  if (!existsSync(modulesRoot)) return [];
  if (!isDirectory(modulesRoot)) {
    throw new Error(`Admin Node modules 路径不是目录：${modulesRoot}`);
  }

  const files = [];
  for (const entry of readdirSync(modulesRoot, { withFileTypes: true }).sort((left, right) => (
    left.name.localeCompare(right.name, 'en')
  ))) {
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
  const imports = files.map((file, index) => (
    `import * as pluginEntity${index} from './${file.replace(/\.ts$/, '')}';`
  ));
  const values = files.map((_, index) => `...Object.values(pluginEntity${index})`);
  const exportBlock = values.length === 0
    ? 'export const pluginEntities = [];\n'
    : `export const pluginEntities = [\n  ${values.join(',\n  ')},\n];\n`;
  return `// 自动生成的插件实体清单，请勿手动修改\n${imports.join('\n')}${imports.length ? '\n' : ''}${exportBlock}`;
}

function replaceFileAtomically(target, content) {
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
        if (!existsSync(target) && existsSync(backup)) renameSync(backup, target);
        throw replaceError;
      }
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
    if (existsSync(backup) && existsSync(target)) rmSync(backup, { force: true });
  }
}

function syncRuntimeEntities(inputRoot) {
  const root = requireAdminNodeRoot(inputRoot);
  const discovered = discoverRuntimeEntities(root);
  const fixed = fixedHostEntityFiles(root);
  const missingHostFiles = [...fixed].filter(file => !discovered.includes(file));
  if (missingHostFiles.length > 0) {
    throw new Error(`Host 固定实体文件缺失：${missingHostFiles.join('、')}`);
  }
  const files = discovered.filter(file => !fixed.has(file));
  const content = renderRuntimeEntities(files);
  const output = path.join(root, 'src', 'entities.plugin.ts');
  replaceFileAtomically(output, content);
  return {
    root,
    output,
    count: files.length,
    files,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

function cliRoot(argv) {
  const rootIndex = argv.indexOf('--root');
  if (rootIndex === -1) return process.cwd();
  if (!argv[rootIndex + 1]) throw new Error('--root 缺少目录参数');
  return argv[rootIndex + 1];
}

if (require.main === module) {
  try {
    const result = syncRuntimeEntities(cliRoot(process.argv.slice(2)));
    process.stdout.write(
      `[Pah entities] synchronized count=${result.count} sha256=${result.sha256}\n`
    );
  } catch (error) {
    process.stderr.write(
      `[Pah entities] failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}

module.exports = {
  discoverRuntimeEntities,
  fixedHostEntityFiles,
  renderRuntimeEntities,
  syncRuntimeEntities,
};
