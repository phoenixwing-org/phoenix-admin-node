import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const {
  pruneIgnoredRuntimeModules,
  readCompileReceipt,
} = require('../../../scripts/pah-prune-ignored-runtime-modules.cjs');

function writeReceipt(root: string, ignoredModuleIds: unknown[]) {
  const runtimeRoot = path.join(root, '.runtime');
  mkdirSync(runtimeRoot, { recursive: true });
  writeFileSync(
    path.join(runtimeRoot, 'pah-plugin-compile.json'),
    JSON.stringify({ formatVersion: 1, ignoredModuleIds, inspections: [] })
  );
}

describe('隔离插件运行时残留清理', () => {
  it('只删除 ignored 模块的旧 dist，保留有效模块', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-runtime-prune-'));
    try {
      writeReceipt(root, ['quarantined-plugin']);
      mkdirSync(path.join(root, 'dist/modules/quarantined-plugin'), {
        recursive: true,
      });
      mkdirSync(path.join(root, 'dist/modules/healthy-plugin'), {
        recursive: true,
      });
      writeFileSync(
        path.join(
          root,
          'dist/modules/quarantined-plugin/pah-plugin.artifacts.json'
        ),
        '{}'
      );
      writeFileSync(
        path.join(root, 'dist/modules/healthy-plugin/config.js'),
        'module.exports = {};\n'
      );

      const result = pruneIgnoredRuntimeModules(root);

      expect(result.ignoredModuleIds).toEqual(['quarantined-plugin']);
      expect(result.removedModuleIds).toEqual(['quarantined-plugin']);
      expect(
        existsSync(path.join(root, 'dist/modules/quarantined-plugin'))
      ).toBe(false);
      expect(existsSync(path.join(root, 'dist/modules/healthy-plugin'))).toBe(
        true
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('遇到 dist symlink 只移除链接，不删除链接目标', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-runtime-prune-'));
    const outside = mkdtempSync(path.join(tmpdir(), 'pah-runtime-outside-'));
    try {
      writeReceipt(root, ['linked-plugin']);
      mkdirSync(path.join(root, 'dist/modules'), { recursive: true });
      writeFileSync(path.join(outside, 'keep.txt'), 'keep');
      const link = path.join(root, 'dist/modules/linked-plugin');
      symlinkSync(outside, link, 'dir');
      expect(readlinkSync(link)).toBe(outside);

      pruneIgnoredRuntimeModules(root);

      expect(existsSync(link)).toBe(false);
      expect(existsSync(path.join(outside, 'keep.txt'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('清理断开的 dist symlink，不把它误判为不存在', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-runtime-prune-'));
    try {
      writeReceipt(root, ['broken-plugin']);
      mkdirSync(path.join(root, 'dist/modules'), { recursive: true });
      const link = path.join(root, 'dist/modules/broken-plugin');
      symlinkSync(path.join(root, 'missing-target'), link, 'dir');

      const result = pruneIgnoredRuntimeModules(root);

      expect(result.removedModuleIds).toEqual(['broken-plugin']);
      expect(existsSync(link)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('拒绝非法、重复或缺失的编译隔离收据', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-runtime-prune-'));
    try {
      expect(() => readCompileReceipt(root)).toThrow(
        '无法读取 Phoenix 插件编译隔离收据'
      );
      writeReceipt(root, ['../escape']);
      expect(() => readCompileReceipt(root)).toThrow(
        '包含不安全或重复的 moduleId'
      );
      writeReceipt(root, ['safe-plugin', 'safe-plugin']);
      expect(() => readCompileReceipt(root)).toThrow(
        '包含不安全或重复的 moduleId'
      );
      writeReceipt(root, ['base']);
      expect(() => readCompileReceipt(root)).toThrow(
        '包含不安全或重复的 moduleId'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
