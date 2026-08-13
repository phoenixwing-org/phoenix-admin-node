const { join } = require('path');
const { MidwayPerformanceManager } = require('@midwayjs/core');
const { close, createApp, processArgsParser } = require('@midwayjs/mock');
const {
  pruneIgnoredRuntimeModules,
} = require('./pah-prune-ignored-runtime-modules.cjs');

process.env.MIDWAY_TS_MODE = 'false';

let app;
let closing = false;

async function shutdown() {
  if (closing) return;
  closing = true;
  if (app) await close(app);
  process.exit(0);
}

async function main() {
  const args = processArgsParser(process.argv);
  if (args.port) process.env.MIDWAY_HTTP_PORT = args.port;

  const pruneResult = pruneIgnoredRuntimeModules(process.cwd());
  process.stdout.write(
    `[phoenix-plugin-health] host=node phase=runtime-prune ignored=${pruneResult.ignoredModuleIds.length} removed=${pruneResult.removedModuleIds.length}\n`
  );

  process.once('SIGINT', shutdown);
  process.once('SIGQUIT', shutdown);
  process.once('SIGTERM', shutdown);

  app = await createApp({
    appDir: process.cwd(),
    baseDir: join(process.cwd(), 'dist'),
    // watch 模式只编译源码，不执行 bundle，因此没有 dist/index。
    // 直接载入应用 Configuration，再由其显式 detector 扫描 dist。
    imports: [require('../dist/configuration')],
    ...args,
  });

  if (process.send) {
    process.send({
      title: 'server-ready',
      port: process.env.MIDWAY_HTTP_PORT,
      ssl: args.ssl || process.env.MIDWAY_HTTP_SSL === 'true',
    });
    setTimeout(() => {
      process.send({
        title: 'perf-init',
        data: MidwayPerformanceManager.getInitialPerformanceEntries(),
      });
    }, 500);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
