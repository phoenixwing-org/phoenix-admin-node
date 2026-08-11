const { join } = require('path');
const { MidwayPerformanceManager } = require('@midwayjs/core');
const { close, createApp, processArgsParser } = require('@midwayjs/mock');

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

  process.once('SIGINT', shutdown);
  process.once('SIGQUIT', shutdown);
  process.once('SIGTERM', shutdown);

  app = await createApp({
    appDir: process.cwd(),
    baseDir: join(process.cwd(), 'dist'),
    imports: [require('../dist/index')],
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
