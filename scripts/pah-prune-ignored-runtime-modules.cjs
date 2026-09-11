const {
  existsSync,
  lstatSync,
  readFileSync,
  rmSync,
  unlinkSync,
} = require('node:fs');
const path = require('node:path');

const MODULE_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
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
const RECEIPT_RELATIVE_PATH = path.join('.runtime', 'pah-plugin-compile.json');

function readCompileReceipt(root) {
  const receiptPath = path.join(root, RECEIPT_RELATIVE_PATH);
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  } catch {
    throw new Error(`无法读取 Phoenix 插件编译隔离收据：${receiptPath}`);
  }
  if (
    !receipt ||
    receipt.formatVersion !== 1 ||
    !Array.isArray(receipt.ignoredModuleIds)
  ) {
    throw new Error('Phoenix 插件编译隔离收据格式无效');
  }
  const ignoredModuleIds = [];
  const seen = new Set();
  for (const moduleId of receipt.ignoredModuleIds) {
    if (
      typeof moduleId !== 'string' ||
      !MODULE_ID_PATTERN.test(moduleId) ||
      HOST_MODULE_IDS.has(moduleId) ||
      seen.has(moduleId)
    ) {
      throw new Error('Phoenix 插件编译隔离收据包含不安全或重复的 moduleId');
    }
    seen.add(moduleId);
    ignoredModuleIds.push(moduleId);
  }
  return {
    ignoredModuleIds: ignoredModuleIds.sort(),
    receiptPath,
  };
}

function removeRuntimeModule(target) {
  let info;
  try {
    info = lstatSync(target);
  } catch {
    return false;
  }
  if (info.isSymbolicLink()) unlinkSync(target);
  else rmSync(target, { recursive: true, force: true });
  return true;
}

function pruneIgnoredRuntimeModules(root = process.cwd()) {
  const absoluteRoot = path.resolve(root);
  const { ignoredModuleIds, receiptPath } = readCompileReceipt(absoluteRoot);
  const modulesRoot = path.join(absoluteRoot, 'dist', 'modules');
  const removedModuleIds = [];
  for (const moduleId of ignoredModuleIds) {
    const target = path.join(modulesRoot, moduleId);
    if (path.dirname(target) !== modulesRoot) {
      throw new Error(`拒绝清理越出 dist/modules 的插件路径：${moduleId}`);
    }
    if (removeRuntimeModule(target)) removedModuleIds.push(moduleId);
  }
  return { ignoredModuleIds, removedModuleIds, receiptPath };
}

function logResult(result) {
  process.stdout.write(
    `[phoenix-plugin-health] host=node phase=runtime-prune ignored=${result.ignoredModuleIds.length} removed=${result.removedModuleIds.length}\n`
  );
}

if (require.main === module) {
  try {
    logResult(pruneIgnoredRuntimeModules(process.cwd()));
  } catch (error) {
    process.stderr.write(
      `[phoenix-plugin-health] host=node phase=runtime-prune state=failed detail=${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    process.exitCode = 1;
  }
}

module.exports = {
  MODULE_ID_PATTERN,
  pruneIgnoredRuntimeModules,
  readCompileReceipt,
};
