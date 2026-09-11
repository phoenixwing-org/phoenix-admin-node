import { createHash } from 'crypto';
import { createReadStream, lstatSync } from 'fs';
import * as path from 'path';
import { TextDecoder } from 'util';
import { CoolCommException } from '@cool-midway/core';

export const PAH_FILES_MAX_BYTES = 32 * 1024 * 1024;

const previewMime = new Set([
  'application/json',
  'application/pdf',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain; charset=utf-8',
]);

export function safePahFileName(value: unknown) {
  const normalized =
    typeof value === 'string'
      ? path.basename(value).trim().normalize('NFC')
      : '';
  if (
    !normalized ||
    normalized.length > 255 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new CoolCommException('文件名必须是 1～255 字安全文本');
  }
  return normalized;
}

function startsWith(bytes: Buffer, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

export function detectPahFileMime(prefix: Buffer, validUtf8Text: boolean) {
  if (startsWith(prefix, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (startsWith(prefix, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (
    prefix.subarray(0, 6).toString('ascii') === 'GIF87a' ||
    prefix.subarray(0, 6).toString('ascii') === 'GIF89a'
  ) {
    return 'image/gif';
  }
  if (
    prefix.subarray(0, 4).toString('ascii') === 'RIFF' &&
    prefix.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (prefix.subarray(0, 5).toString('ascii') === '%PDF-') {
    return 'application/pdf';
  }
  if (
    startsWith(prefix, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(prefix, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(prefix, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return 'application/zip';
  }
  if (validUtf8Text) {
    const first = prefix.toString('utf8').trimStart()[0];
    return first === '{' || first === '['
      ? 'application/json'
      : 'text/plain; charset=utf-8';
  }
  throw new CoolCommException('文件类型不在 Host Files v1 安全白名单');
}

export async function inspectPahUpload(
  file: string,
  maximumBytes = PAH_FILES_MAX_BYTES
) {
  const stat = lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new CoolCommException('上传内容必须是普通文件');
  }
  if (stat.size < 1 || stat.size > maximumBytes) {
    throw new CoolCommException(
      `上传文件必须在 1B～${Math.floor(maximumBytes / 1024 / 1024)}MiB 之间`
    );
  }
  const hash = createHash('sha256');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const prefix: Buffer[] = [];
  let prefixBytes = 0;
  let size = 0;
  let validUtf8Text = true;
  let containsNul = false;
  for await (const chunk of createReadStream(file)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maximumBytes) {
      throw new CoolCommException('上传文件在读取期间超过 Host 上限');
    }
    hash.update(bytes);
    containsNul ||= bytes.includes(0);
    if (validUtf8Text) {
      try {
        decoder.decode(bytes, { stream: true });
      } catch {
        validUtf8Text = false;
      }
    }
    if (prefixBytes < 4096) {
      const take = bytes.subarray(0, 4096 - prefixBytes);
      prefix.push(take);
      prefixBytes += take.length;
    }
  }
  if (size !== stat.size) {
    throw new CoolCommException('上传文件在读取期间发生变化');
  }
  if (validUtf8Text) {
    try {
      decoder.decode();
    } catch {
      validUtf8Text = false;
    }
  }
  validUtf8Text &&= !containsNul;
  const leading = Buffer.concat(prefix);
  return {
    size,
    sha256: hash.digest('hex'),
    mime: detectPahFileMime(leading, validUtf8Text),
  };
}

export function canPreviewPahFileMime(mime: string) {
  return previewMime.has(mime);
}
