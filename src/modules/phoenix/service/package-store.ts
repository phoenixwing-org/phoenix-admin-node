import { CoolCommException } from '@cool-midway/core';
import { createHash, randomUUID } from 'crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import * as path from 'path';
import { pDataPath } from '../../../comm/path';

const MODULE_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PHOENIX_PACKAGE_SUFFIX = '.phoenix.cool';

export interface PahRetainedPluginPackageV1 {
  formatVersion: 1;
  moduleId: string;
  version: string;
  filename: string;
  packageSha256: string;
  size: number;
  sourceCommit: string;
  storedAt: string;
}

function sha256(content: Buffer) {
  return createHash('sha256').update(content).digest('hex');
}

function requireIdentity(moduleId: unknown, version: unknown) {
  if (typeof moduleId !== 'string' || !MODULE_ID_PATTERN.test(moduleId)) {
    throw new CoolCommException(`插件 moduleId 不安全：${moduleId}`);
  }
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    throw new CoolCommException(`插件版本不安全：${version}`);
  }
}

function safeFilename(filename: unknown) {
  if (
    typeof filename !== 'string' ||
    !filename ||
    filename !== path.basename(filename) ||
    !filename.endsWith(PHOENIX_PACKAGE_SUFFIX) ||
    /[\0\r\n]/.test(filename)
  ) {
    throw new CoolCommException('Phoenix 插件包文件名不安全');
  }
  return filename;
}

function storeRoot() {
  const testRoot = process.env.PAH_PLUGIN_PACKAGE_STORE_ROOT?.trim();
  if (testRoot && process.env.JEST_WORKER_ID) {
    return path.resolve(testRoot);
  }
  if (process.env.NODE_ENV === 'test') {
    return path.join(
      path.resolve(process.env.PHOENIX_ADMIN_NODE_ROOT || process.cwd()),
      '.runtime',
      'phoenix-plugin-test-packages'
    );
  }
  return path.join(pDataPath(), 'phoenix-plugin', 'packages');
}

function requireDirectory(directory: string, label: string) {
  const stat = lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new CoolCommException(`${label} 必须是普通目录`);
  }
}

function ensureSecureDirectory(directory: string) {
  if (existsSync(directory)) {
    requireDirectory(directory, 'Phoenix 插件包仓');
  } else {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  chmodSync(directory, 0o700);
}

function versionRoot(moduleId: string, version: string, create = false) {
  requireIdentity(moduleId, version);
  const root = storeRoot();
  const moduleRoot = path.join(root, moduleId);
  const target = path.join(moduleRoot, version);
  if (create) {
    ensureSecureDirectory(root);
    ensureSecureDirectory(moduleRoot);
    ensureSecureDirectory(target);
  }
  return target;
}

function recordFiles(moduleId: string, version: string, packageSha256: string) {
  requireIdentity(moduleId, version);
  if (!SHA256_PATTERN.test(packageSha256)) {
    throw new CoolCommException('Phoenix 插件包 SHA-256 不安全');
  }
  const root = versionRoot(moduleId, version);
  return {
    packageFile: path.join(root, `${packageSha256}${PHOENIX_PACKAGE_SUFFIX}`),
    metadataFile: path.join(root, `${packageSha256}.json`),
  };
}

function atomicWrite(file: string, content: Buffer, mode = 0o600) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { flag: 'wx', mode });
    chmodSync(temporary, mode);
    renameSync(temporary, file);
    chmodSync(file, mode);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function parseMetadata(content: Buffer): PahRetainedPluginPackageV1 {
  let value: PahRetainedPluginPackageV1;
  try {
    value = JSON.parse(content.toString('utf8'));
  } catch {
    throw new CoolCommException('Phoenix 插件包仓元数据损坏');
  }
  requireIdentity(value?.moduleId, value?.version);
  safeFilename(value?.filename);
  if (
    value?.formatVersion !== 1 ||
    !SHA256_PATTERN.test(value?.packageSha256 || '') ||
    !Number.isSafeInteger(value?.size) ||
    value.size < 1 ||
    !/^[a-f0-9]{40}$/.test(value?.sourceCommit || '') ||
    !value?.storedAt ||
    Number.isNaN(Date.parse(value.storedAt))
  ) {
    throw new CoolCommException('Phoenix 插件包仓元数据不合法');
  }
  return value;
}

function readVerifiedRecord(
  moduleId: string,
  version: string,
  packageSha256: string
) {
  const files = recordFiles(moduleId, version, packageSha256);
  for (const [label, file] of [
    ['插件包', files.packageFile],
    ['插件包元数据', files.metadataFile],
  ] as const) {
    if (!existsSync(file)) return null;
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new CoolCommException(`${label} 必须是普通文件`);
    }
    if ((stat.mode & 0o077) !== 0) {
      throw new CoolCommException(`${label} 权限必须限制为当前用户可读写`);
    }
  }
  const metadata = parseMetadata(readFileSync(files.metadataFile));
  const content = readFileSync(files.packageFile);
  if (
    metadata.moduleId !== moduleId ||
    metadata.version !== version ||
    metadata.packageSha256 !== packageSha256 ||
    metadata.size !== content.length ||
    sha256(content) !== packageSha256
  ) {
    throw new CoolCommException('Phoenix 插件包仓内容与元数据不一致');
  }
  return { metadata, packageFile: files.packageFile };
}

export function retainVerifiedPluginPackage(input: {
  moduleId: string;
  version: string;
  filename: string;
  packageSha256: string;
  packageBytes: Buffer;
  sourceCommit: string;
}) {
  requireIdentity(input.moduleId, input.version);
  const filename = safeFilename(input.filename);
  if (
    !SHA256_PATTERN.test(input.packageSha256) ||
    sha256(input.packageBytes) !== input.packageSha256 ||
    !/^[a-f0-9]{40}$/.test(input.sourceCommit)
  ) {
    throw new CoolCommException('Phoenix 插件包仓写入身份不合法');
  }
  versionRoot(input.moduleId, input.version, true);
  const files = recordFiles(input.moduleId, input.version, input.packageSha256);
  const packageExisted = existsSync(files.packageFile);
  const metadataExisted = existsSync(files.metadataFile);
  if (packageExisted || metadataExisted) {
    const existing = readVerifiedRecord(
      input.moduleId,
      input.version,
      input.packageSha256
    );
    if (!existing) {
      throw new CoolCommException('Phoenix 插件包仓存在不完整记录');
    }
    return {
      metadata: existing.metadata,
      rollback: () => undefined,
    };
  }

  const metadata: PahRetainedPluginPackageV1 = {
    formatVersion: 1,
    moduleId: input.moduleId,
    version: input.version,
    filename,
    packageSha256: input.packageSha256,
    size: input.packageBytes.length,
    sourceCommit: input.sourceCommit,
    storedAt: new Date().toISOString(),
  };
  try {
    atomicWrite(files.packageFile, input.packageBytes);
    atomicWrite(
      files.metadataFile,
      Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`)
    );
  } catch (error) {
    rmSync(files.packageFile, { force: true });
    rmSync(files.metadataFile, { force: true });
    throw error;
  }
  return {
    metadata,
    rollback: () => {
      rmSync(files.metadataFile, { force: true });
      rmSync(files.packageFile, { force: true });
    },
  };
}

export function retainedPluginPackage(
  moduleId: string,
  version: string,
  packageSha256: string
) {
  return readVerifiedRecord(moduleId, version, packageSha256);
}

export function latestRetainedPluginPackage(
  moduleId: string,
  version: string,
  sourceCommit?: string | null
): PahRetainedPluginPackageV1 | null {
  const root = versionRoot(moduleId, version);
  if (!existsSync(root)) return null;
  requireDirectory(root, 'Phoenix 插件版本包仓');
  const records = readdirSync(root)
    .filter(name => SHA256_PATTERN.test(name.replace(/\.json$/, '')))
    .filter(name => name.endsWith('.json'))
    .map(name =>
      readVerifiedRecord(moduleId, version, name.replace(/\.json$/, ''))
    )
    .filter(Boolean)
    .map(item => item!.metadata)
    .filter(item => !sourceCommit || item.sourceCommit === sourceCommit)
    .sort((left, right) => right.storedAt.localeCompare(left.storedAt));
  return records[0] ?? null;
}
