import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  createReadStream,
  existsSync,
  fsyncSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { createHash, randomUUID } from 'crypto';
import * as path from 'path';
import { CoolCommException } from '@cool-midway/core';
import { Config, Provide } from '@midwayjs/core';
import { Readable } from 'stream';

export interface PahFileProviderPutResult {
  providerId: string;
  storageIdentity: string;
  storageKey: string;
  deduplicated: boolean;
  writeReceiptId: string;
}

export interface PahFileProvider {
  readonly providerId: string;
  put(
    source: string,
    sha256: string,
    size: number
  ): Promise<PahFileProviderPutResult>;
  open(
    storageKey: string,
    expectedSha256: string,
    expectedSize: number
  ): Promise<Readable>;
  commitWrite(writeReceiptId: string): Promise<void>;
}

async function hashFile(file: string) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    hash.update(bytes);
  }
  return { sha256: hash.digest('hex'), size };
}

async function hashDescriptor(descriptor: number) {
  const hash = createHash('sha256');
  let size = 0;
  const stream = createReadStream('', {
    fd: descriptor,
    autoClose: false,
    start: 0,
  });
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    hash.update(bytes);
  }
  return { sha256: hash.digest('hex'), size };
}

function ordinaryFile(file: string, label: string) {
  const info = lstatSync(file);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new CoolCommException(`${label}必须是普通文件`);
  }
  return info;
}

function fsyncDirectory(directory: string) {
  const descriptor = openSync(directory, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export class PahLocalFileProvider implements PahFileProvider {
  readonly providerId = 'local';
  private readonly root: string;
  private readonly pendingRoot: string;

  constructor(root: string) {
    if (!path.isAbsolute(root)) {
      throw new CoolCommException('Files Provider 根目录必须是绝对路径');
    }
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const info = lstatSync(root);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new CoolCommException('Files Provider 根目录必须是普通目录');
    }
    chmodSync(root, 0o700);
    this.root = realpathSync(root);
    this.pendingRoot = path.join(this.root, '.pending');
    mkdirSync(this.pendingRoot, { recursive: true, mode: 0o700 });
    const pendingInfo = lstatSync(this.pendingRoot);
    if (
      pendingInfo.isSymbolicLink() ||
      !pendingInfo.isDirectory() ||
      realpathSync(this.pendingRoot) !== this.pendingRoot
    ) {
      throw new CoolCommException('Files Provider pending 目录不安全');
    }
    chmodSync(this.pendingRoot, 0o700);
  }

  private pendingReceipt(writeReceiptId: string) {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(
        writeReceiptId
      )
    ) {
      throw new CoolCommException('Files Provider write receipt 不合法');
    }
    return path.join(this.pendingRoot, `${writeReceiptId}.json`);
  }

  private createPendingReceipt(
    writeReceiptId: string,
    storageKey: string,
    sha256: string,
    size: number
  ) {
    const receipt = this.pendingReceipt(writeReceiptId);
    writeFileSync(
      receipt,
      `${JSON.stringify({
        formatVersion: 1,
        providerId: this.providerId,
        storageKey,
        sha256,
        size,
      })}\n`,
      { encoding: 'utf8', mode: 0o600, flag: 'wx' }
    );
    chmodSync(receipt, 0o600);
    const descriptor = openSync(receipt, 'r');
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    fsyncDirectory(this.pendingRoot);
  }

  private resolve(storageKey: string) {
    const match = storageKey.match(/^([a-f0-9]{2})\/([a-f0-9]{64})$/u);
    if (!match || match[1] !== match[2].slice(0, 2)) {
      throw new CoolCommException('Files Provider storage key 不合法');
    }
    const target = path.join(this.root, match[1], match[2]);
    if (!target.startsWith(`${this.root}${path.sep}`)) {
      throw new CoolCommException('Files Provider storage key 越界');
    }
    return { target, digest: match[2] };
  }

  private ensureBucket(prefix: string) {
    const bucket = path.join(this.root, prefix);
    mkdirSync(bucket, { recursive: true, mode: 0o700 });
    const info = lstatSync(bucket);
    if (
      info.isSymbolicLink() ||
      !info.isDirectory() ||
      realpathSync(bucket) !== bucket
    ) {
      throw new CoolCommException('Files Provider bucket 不安全');
    }
    chmodSync(bucket, 0o700);
    return bucket;
  }

  private async verifyExisting(
    file: string,
    expectedSha256: string,
    expectedSize: number
  ) {
    ordinaryFile(file, 'Files Provider blob');
    const actual = await hashFile(file);
    if (actual.size !== expectedSize || actual.sha256 !== expectedSha256) {
      throw new CoolCommException('Files Provider 内容寻址对象完整性冲突');
    }
  }

  async put(source: string, sha256: string, size: number) {
    if (
      !/^[a-f0-9]{64}$/u.test(sha256) ||
      !Number.isSafeInteger(size) ||
      size < 1
    ) {
      throw new CoolCommException('Files Provider 写入收据不合法');
    }
    ordinaryFile(source, '上传文件');
    const storageKey = `${sha256.slice(0, 2)}/${sha256}`;
    const writeReceiptId = randomUUID();
    this.createPendingReceipt(writeReceiptId, storageKey, sha256, size);
    const { target } = this.resolve(storageKey);
    this.ensureBucket(sha256.slice(0, 2));
    if (existsSync(target)) {
      await this.verifyExisting(target, sha256, size);
      return {
        providerId: this.providerId,
        storageIdentity: `sha256:${sha256}`,
        storageKey,
        deduplicated: true,
        writeReceiptId,
      };
    }

    const temporary = path.join(
      path.dirname(target),
      `.${sha256}.${randomUUID()}.tmp`
    );
    let deduplicated = false;
    try {
      copyFileSync(source, temporary, constants.COPYFILE_EXCL);
      chmodSync(temporary, 0o600);
      const descriptor = openSync(temporary, 'r');
      try {
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      await this.verifyExisting(temporary, sha256, size);
      try {
        linkSync(temporary, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await this.verifyExisting(target, sha256, size);
        deduplicated = true;
      }
      chmodSync(target, 0o600);
      fsyncDirectory(path.dirname(target));
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    return {
      providerId: this.providerId,
      storageIdentity: `sha256:${sha256}`,
      storageKey,
      deduplicated,
      writeReceiptId,
    };
  }

  async commitWrite(writeReceiptId: string) {
    const receipt = this.pendingReceipt(writeReceiptId);
    ordinaryFile(receipt, 'Files Provider write receipt');
    unlinkSync(receipt);
    fsyncDirectory(this.pendingRoot);
  }

  async open(storageKey: string, expectedSha256: string, expectedSize: number) {
    const { target, digest } = this.resolve(storageKey);
    if (digest !== expectedSha256) {
      throw new CoolCommException('Files Provider 描述符与 storage key 不匹配');
    }
    let descriptor: number | undefined;
    try {
      descriptor = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = fstatSync(descriptor);
      if (!info.isFile()) {
        throw new CoolCommException('Files Provider blob 必须是普通文件');
      }
      const actual = await hashDescriptor(descriptor);
      if (actual.size !== expectedSize || actual.sha256 !== expectedSha256) {
        throw new CoolCommException('Files Provider 内容寻址对象完整性冲突');
      }
      const stream = createReadStream('', {
        fd: descriptor,
        autoClose: true,
        start: 0,
      });
      descriptor = undefined;
      return stream;
    } catch (error) {
      if (error instanceof CoolCommException) throw error;
      throw new CoolCommException('Files Provider 无法安全读取内容对象');
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
}

@Provide()
export class PahFileProviderRegistry {
  @Config('module.phoenix.files')
  config: { root: string };

  private localProvider?: PahLocalFileProvider;

  defaultProvider() {
    if (!this.localProvider) {
      this.localProvider = new PahLocalFileProvider(this.config.root);
    }
    return this.localProvider;
  }

  resolve(providerId: string) {
    if (providerId !== 'local') {
      throw new CoolCommException(`Files Provider 不受支持：${providerId}`);
    }
    return this.defaultProvider();
  }
}
