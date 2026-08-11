const assert = require('assert/strict');
const { readFileSync } = require('fs');
const { join } = require('path');
const { MidwayWebRouterService } = require('@midwayjs/core');
const { close, createApp } = require('@midwayjs/mock');

async function main() {
  let app;
  try {
    app = await createApp({
      appDir: process.cwd(),
      baseDir: join(process.cwd(), 'dist'),
      imports: [require('../dist/index')],
      globalConfig: {
        koa: {
          port: 0,
        },
        midwayLogger: {
          default: {
            level: 'warn',
          },
          clients: {
            coreLogger: {
              level: 'warn',
            },
          },
        },
        typeorm: {
          dataSource: {
            default: {
              type: 'sqlite',
              database: ':memory:',
              synchronize: true,
              logging: false,
              entities: ['**/modules/*/entity'],
            },
          },
        },
        cool: {
          eps: false,
          initDB: false,
          initMenu: false,
        },
      },
    });

    // Cool 的事件总线基于 EventEmitter，onServerReady 的异步监听器会在
    // createApp 返回后继续完成。等待一次插件中心初始化，避免测试关闭容器时
    // 与该异步工作竞争。
    await new Promise(resolve => setTimeout(resolve, 250));

    const routerService = await app
      .getApplicationContext()
      .getAsync(MidwayWebRouterService);
    const routes = await routerService.getFlattenRouterTable();

    assert.ok(routes.length > 0, 'Midway 4 detector did not load controllers');
    assert.ok(
      routes.some(route => route.fullUrl === '/admin/base/open/login'),
      'Cool Admin login route was not registered'
    );

    console.log(
      JSON.stringify({
        midway: JSON.parse(
          readFileSync(
            join(require.resolve('@midwayjs/core'), '../../package.json'),
            'utf8'
          )
        ).version,
        routes: routes.length,
        loginRoute: true,
      })
    );
  } finally {
    if (app) await close(app);
  }
}

main().then(
  () => process.exit(0),
  error => {
    console.error(error);
    process.exit(1);
  }
);
