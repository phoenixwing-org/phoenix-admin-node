const { statSync } = require('fs');
const { join } = require('path');

const REQUIRED_MIDWAY_RUNTIME_FILES = Object.freeze([
  'configuration.js',
  'config/config.default.js',
  'config/config.local.js',
  'config/config.midway4.js',
  'config/config.prod.js',
]);

function runtimeFingerprint(baseDir, relativeFiles) {
  const items = [];
  const missing = [];
  for (const relative of relativeFiles) {
    try {
      const stat = statSync(join(baseDir, ...relative.split('/')));
      if (!stat.isFile() || stat.size === 0) {
        missing.push(relative);
        continue;
      }
      items.push(`${relative}:${stat.size}:${stat.mtimeMs}`);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
      missing.push(relative);
    }
  }
  return {
    ready: missing.length === 0,
    missing,
    value: items.join('|'),
  };
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitForMidwayRuntime(options = {}) {
  const baseDir = options.baseDir;
  if (typeof baseDir !== 'string' || !baseDir) {
    throw new TypeError('Midway runtime baseDir must be a non-empty string');
  }
  const relativeFiles = options.relativeFiles || REQUIRED_MIDWAY_RUNTIME_FILES;
  const timeoutMs = options.timeoutMs === undefined ? 30000 : options.timeoutMs;
  const pollMs = options.pollMs === undefined ? 100 : options.pollMs;
  const stableMs = options.stableMs === undefined ? 500 : options.stableMs;
  const startedAt = Date.now();
  let stableSince = 0;
  let previous = '';
  let latestMissing = [...relativeFiles];

  while (Date.now() - startedAt <= timeoutMs) {
    const fingerprint = runtimeFingerprint(baseDir, relativeFiles);
    latestMissing = fingerprint.missing;
    if (!fingerprint.ready) {
      stableSince = 0;
      previous = '';
    } else if (fingerprint.value !== previous) {
      previous = fingerprint.value;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= stableMs) {
      return {
        waitedMs: Date.now() - startedAt,
        files: [...relativeFiles],
      };
    }
    await delay(pollMs);
  }

  const detail = latestMissing.length
    ? `missing=${latestMissing.join(',')}`
    : 'compiled files did not remain stable';
  throw new Error(
    `Midway runtime is incomplete after ${timeoutMs}ms; ${detail}`
  );
}

module.exports = {
  REQUIRED_MIDWAY_RUNTIME_FILES,
  runtimeFingerprint,
  waitForMidwayRuntime,
};
