import { CoolCommException } from '@cool-midway/core';
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
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { Provide } from '@midwayjs/core';
import * as path from 'path';
import { PahPluginInstallationEntity } from '../entity/plugin';
import { PahPluginManifest } from '../interface/plugin';
import { resolvePahHostRoots } from './runtime-host';

const MODULE_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RECEIPT_DIRECTORY = path.join(
  '.runtime',
  'phoenix-plugin-activation',
  'receipts'
);
const CANDIDATE_DIRECTORY = path.join(
  '.runtime',
  'phoenix-plugin-activation',
  'candidates'
);

export interface PahPluginRuntimeDigestV1 {
  fileCount: number;
  size: number;
  sha256: string;
}

export interface PahPluginActivationReceiptV1 {
  formatVersion: 1;
  /**
   * 正式安装必须是 Host 管理的普通目录；本地开发仅允许双端根 symlink，
   * 且其字节必须先与不可变 .phoenix.cool 包逐项一致。
   */
  payloadMode?: 'release' | 'development';
  moduleId: string;
  version: string;
  pluginType: string | null;
  packageSha256: string;
  manifestSha256: string;
  payloads: {
    node: PahPluginRuntimeDigestV1;
    vue: PahPluginRuntimeDigestV1;
  };
}

function sha256(content: string | Buffer) {
  return createHash('sha256').update(content).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function pahPluginManifestSha256(manifest: PahPluginManifest) {
  return sha256(canonicalJson(manifest));
}

function requireModuleId(moduleId: string) {
  if (!MODULE_ID_PATTERN.test(moduleId)) {
    throw new CoolCommException(`插件 moduleId 不安全：${moduleId}`);
  }
}

function collectPayloadFiles(
  root: string,
  relative = ''
): Array<{
  path: string;
  size: number;
  sha256: string;
}> {
  const directory = path.join(root, ...relative.split('/').filter(Boolean));
  const files: Array<{ path: string; size: number; sha256: string }> = [];
  for (const name of readdirSync(directory).sort((left, right) =>
    left.localeCompare(right, 'en')
  )) {
    const next = relative ? `${relative}/${name}` : name;
    const absolute = path.join(root, ...next.split('/'));
    const current = lstatSync(absolute);
    if (current.isSymbolicLink()) {
      throw new CoolCommException(`正式插件 payload 不得包含 symlink：${next}`);
    }
    if (current.isDirectory()) {
      files.push(...collectPayloadFiles(root, next));
      continue;
    }
    if (!current.isFile()) {
      throw new CoolCommException(`正式插件 payload 含未知文件类型：${next}`);
    }
    files.push({
      path: next,
      size: current.size,
      sha256: sha256(readFileSync(absolute)),
    });
  }
  return files;
}

export function pahPluginRuntimeDigest(
  root: string,
  options: { allowDevelopmentRootSymlink?: boolean } = {}
): PahPluginRuntimeDigestV1 {
  const current = lstatSync(root);
  if (
    (!options.allowDevelopmentRootSymlink && current.isSymbolicLink()) ||
    (!current.isSymbolicLink() && !current.isDirectory())
  ) {
    throw new CoolCommException('正式插件 payload 必须是 Host 管理的普通目录');
  }
  const files = collectPayloadFiles(root);
  return {
    fileCount: files.length,
    size: files.reduce((total, item) => total + item.size, 0),
    sha256: sha256(canonicalJson(files)),
  };
}

export function pahPluginActivationReceiptFile(
  hostRoot: string,
  moduleId: string
) {
  requireModuleId(moduleId);
  return path.join(hostRoot, RECEIPT_DIRECTORY, `${moduleId}.json`);
}

export function pahPluginActivationCandidateFile(
  hostRoot: string,
  moduleId: string
) {
  requireModuleId(moduleId);
  return path.join(hostRoot, CANDIDATE_DIRECTORY, `${moduleId}.json`);
}

function parseReceipt(value: unknown): PahPluginActivationReceiptV1 | null {
  if (!value || typeof value !== 'object') return null;
  const receipt = value as PahPluginActivationReceiptV1;
  const digests = [receipt.payloads?.node, receipt.payloads?.vue];
  if (
    receipt.formatVersion !== 1 ||
    (receipt.payloadMode !== undefined &&
      !['release', 'development'].includes(receipt.payloadMode)) ||
    !MODULE_ID_PATTERN.test(receipt.moduleId) ||
    typeof receipt.version !== 'string' ||
    !receipt.version ||
    (receipt.pluginType !== null && typeof receipt.pluginType !== 'string') ||
    !SHA256_PATTERN.test(receipt.packageSha256) ||
    !SHA256_PATTERN.test(receipt.manifestSha256) ||
    digests.some(
      digest =>
        !digest ||
        !Number.isSafeInteger(digest.fileCount) ||
        digest.fileCount < 1 ||
        !Number.isSafeInteger(digest.size) ||
        digest.size < 1 ||
        !SHA256_PATTERN.test(digest.sha256)
    )
  ) {
    return null;
  }
  return receipt;
}

function runtimeMatches(
  expected: PahPluginRuntimeDigestV1,
  payloadRoot: string,
  payloadMode: 'release' | 'development' = 'release'
) {
  const actual = pahPluginRuntimeDigest(payloadRoot, {
    allowDevelopmentRootSymlink: payloadMode === 'development',
  });
  return (
    actual.fileCount === expected.fileCount &&
    actual.size === expected.size &&
    actual.sha256 === expected.sha256
  );
}

export function inspectPahPluginActivation(
  hostRoot: string,
  moduleId: string,
  runtime: 'node' | 'vue',
  payloadRoot: string
):
  | { valid: true; receipt: PahPluginActivationReceiptV1 }
  | { valid: false; detail: string } {
  let receipt: PahPluginActivationReceiptV1 | null = null;
  try {
    receipt = parseReceipt(
      JSON.parse(
        readFileSync(pahPluginActivationReceiptFile(hostRoot, moduleId), 'utf8')
      )
    );
  } catch {
    return {
      valid: false,
      detail: '正式 payload 缺少启动前可信 Host 激活收据',
    };
  }
  if (!receipt || receipt.moduleId !== moduleId) {
    return { valid: false, detail: '正式 payload 的 Host 激活收据无效' };
  }
  if (
    receipt.payloadMode === 'development' &&
    process.env.NODE_ENV !== 'local'
  ) {
    return {
      valid: false,
      detail: '开发 payload 激活收据不得用于非 local 环境',
    };
  }
  try {
    const expected = receipt.payloads[runtime];
    if (
      !runtimeMatches(expected, payloadRoot, receipt.payloadMode ?? 'release')
    ) {
      return {
        valid: false,
        detail: `正式 ${runtime} payload 与 Host 激活收据不匹配`,
      };
    }
  } catch (error) {
    return {
      valid: false,
      detail: `正式 ${runtime} payload 无法验证：${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  return { valid: true, receipt };
}

function atomicWrite(file: string, content: Buffer) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, file);
    try {
      const directory = openSync(path.dirname(file), 'r');
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } catch {
      // Some filesystems do not support fsync on directories. The file itself
      // is already durable and rename remains atomic on the same filesystem.
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

function restoreFiles(files: Array<{ file: string; previous: Buffer | null }>) {
  for (const item of files) {
    if (item.previous) atomicWrite(item.file, item.previous);
    else rmSync(item.file, { force: true });
  }
}

@Provide()
export class PahPluginRuntimeActivationService {
  recordVerifiedPackage(manifest: PahPluginManifest, packageSha256: string) {
    requireModuleId(manifest.moduleId);
    if (!SHA256_PATTERN.test(packageSha256)) {
      throw new CoolCommException('Phoenix 插件包 SHA-256 无效');
    }
    const { nodeRoot, vueRoot } = resolvePahHostRoots();
    const payloadRoots = {
      node: path.join(nodeRoot, 'src', 'modules', manifest.moduleId),
      vue: path.join(vueRoot, 'src', 'modules', manifest.moduleId),
    };
    const rootKinds = (['node', 'vue'] as const).map(runtime =>
      lstatSync(payloadRoots[runtime]).isSymbolicLink()
        ? 'development'
        : 'release'
    );
    if (rootKinds[0] !== rootKinds[1]) {
      throw new CoolCommException('Node/Vue payload 开发挂载模式不一致');
    }
    const payloadMode = rootKinds[0];
    if (payloadMode === 'development' && process.env.NODE_ENV !== 'local') {
      throw new CoolCommException(
        '只允许在 local 环境验证开发 symlink payload'
      );
    }
    const receipt: PahPluginActivationReceiptV1 = {
      formatVersion: 1,
      payloadMode,
      moduleId: manifest.moduleId,
      version: manifest.version,
      pluginType: manifest.pluginType ?? null,
      packageSha256,
      manifestSha256: pahPluginManifestSha256(manifest),
      payloads: {
        node: pahPluginRuntimeDigest(payloadRoots.node, {
          allowDevelopmentRootSymlink: payloadMode === 'development',
        }),
        vue: pahPluginRuntimeDigest(payloadRoots.vue, {
          allowDevelopmentRootSymlink: payloadMode === 'development',
        }),
      },
    };
    const content = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    const files = [nodeRoot, vueRoot].map(hostRoot => {
      const file = pahPluginActivationCandidateFile(
        hostRoot,
        manifest.moduleId
      );
      return {
        file,
        previous: existsSync(file) ? readFileSync(file) : null,
      };
    });
    try {
      for (const item of files) atomicWrite(item.file, content);
    } catch (error) {
      restoreFiles(files);
      throw error;
    }
    return { receipt, rollback: () => restoreFiles(files) };
  }

  activate(info: PahPluginInstallationEntity) {
    requireModuleId(info.moduleId);
    const { nodeRoot, vueRoot } = resolvePahHostRoots();
    const candidateFiles = [nodeRoot, vueRoot].map(hostRoot =>
      pahPluginActivationCandidateFile(hostRoot, info.moduleId)
    );
    let content: Buffer;
    let receipt: PahPluginActivationReceiptV1 | null;
    try {
      const [nodeCandidate, vueCandidate] = candidateFiles.map(file =>
        readFileSync(file)
      );
      if (!nodeCandidate.equals(vueCandidate)) {
        throw new Error('双端候选收据不一致');
      }
      content = nodeCandidate;
      receipt = parseReceipt(JSON.parse(content.toString('utf8')));
    } catch (error) {
      throw new CoolCommException(
        `缺少可验证的插件包激活候选：${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    if (
      !receipt ||
      receipt.moduleId !== info.moduleId ||
      receipt.version !== info.version ||
      receipt.pluginType !== (info.manifest.pluginType ?? null) ||
      receipt.manifestSha256 !== pahPluginManifestSha256(info.manifest)
    ) {
      throw new CoolCommException('插件包激活候选与当前安装记录不匹配');
    }
    if (
      receipt.payloadMode === 'development' &&
      process.env.NODE_ENV !== 'local'
    ) {
      throw new CoolCommException('开发 payload 激活候选不得用于非 local 环境');
    }
    const payloadRoots = {
      node: path.join(nodeRoot, 'src', 'modules', info.moduleId),
      vue: path.join(vueRoot, 'src', 'modules', info.moduleId),
    };
    for (const runtime of ['node', 'vue'] as const) {
      if (!existsSync(path.join(payloadRoots[runtime], 'config.ts'))) {
        throw new CoolCommException(`正式 ${runtime} payload 缺少 config.ts`);
      }
      if (
        !runtimeMatches(
          receipt.payloads[runtime],
          payloadRoots[runtime],
          receipt.payloadMode ?? 'release'
        )
      ) {
        throw new CoolCommException(
          `正式 ${runtime} payload 与已验证插件包不匹配`
        );
      }
    }
    const files = [nodeRoot, vueRoot].map(hostRoot => {
      const file = pahPluginActivationReceiptFile(hostRoot, info.moduleId);
      return {
        file,
        previous: existsSync(file) ? readFileSync(file) : null,
      };
    });
    try {
      for (const item of files) atomicWrite(item.file, content);
    } catch (error) {
      restoreFiles(files);
      throw error;
    }
    return () => restoreFiles(files);
  }

  deactivate(moduleId: string) {
    requireModuleId(moduleId);
    const { nodeRoot, vueRoot } = resolvePahHostRoots();
    const files = [nodeRoot, vueRoot].map(hostRoot => {
      const file = pahPluginActivationReceiptFile(hostRoot, moduleId);
      return {
        file,
        previous: existsSync(file) ? readFileSync(file) : null,
      };
    });
    try {
      for (const item of files) rmSync(item.file, { force: true });
    } catch (error) {
      restoreFiles(files);
      throw error;
    }
    return () => restoreFiles(files);
  }

  remove(moduleId: string) {
    requireModuleId(moduleId);
    const { nodeRoot, vueRoot } = resolvePahHostRoots();
    const files = [nodeRoot, vueRoot].flatMap(hostRoot =>
      [
        pahPluginActivationReceiptFile(hostRoot, moduleId),
        pahPluginActivationCandidateFile(hostRoot, moduleId),
      ].map(file => ({
        file,
        previous: existsSync(file) ? readFileSync(file) : null,
      }))
    );
    try {
      for (const item of files) rmSync(item.file, { force: true });
    } catch (error) {
      restoreFiles(files);
      throw error;
    }
    return () => restoreFiles(files);
  }
}
