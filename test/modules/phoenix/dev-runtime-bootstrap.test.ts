import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

const {
  runtimeFingerprint,
  waitForMidwayRuntime,
} = require('../../../scripts/pah-wait-for-midway-runtime.cjs');

describe('Midway 开发运行时启动门禁', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'pah-midway-runtime-'));
    roots.push(root);
    return root;
  }

  function write(root: string, relative: string, content = 'module.exports = {};') {
    const target = join(root, ...relative.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  it('等待所有产物生成并在连续稳定后放行', async () => {
    const root = fixture();
    const files = ['configuration.js', 'config/config.default.js'];
    write(root, files[0]);
    const waiting = waitForMidwayRuntime({
      baseDir: root,
      relativeFiles: files,
      timeoutMs: 500,
      pollMs: 10,
      stableMs: 40,
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    write(root, files[1]);
    await new Promise(resolve => setTimeout(resolve, 20));
    write(root, files[0], 'module.exports = { ready: true };');

    const result = await waiting;
    expect(result.files).toEqual(files);
    expect(result.waitedMs).toBeGreaterThanOrEqual(40);
    expect(runtimeFingerprint(root, files)).toMatchObject({
      ready: true,
      missing: [],
    });
  });

  it('缺少产物时按相对文件名 fail-closed', async () => {
    const root = fixture();
    await expect(
      waitForMidwayRuntime({
        baseDir: root,
        relativeFiles: ['configuration.js', 'config/config.default.js'],
        timeoutMs: 30,
        pollMs: 5,
        stableMs: 10,
      })
    ).rejects.toThrow(
      'missing=configuration.js,config/config.default.js'
    );
  });
});
