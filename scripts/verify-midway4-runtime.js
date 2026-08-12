const assert = require('assert/strict');
const { readFileSync } = require('fs');
const { join } = require('path');
const { MidwayWebRouterService } = require('@midwayjs/core');
const { close, createApp } = require('@midwayjs/mock');

async function main() {
  let app;
  const host = process.env.MIDWAY4_DB_HOST || '127.0.0.1';
  const database =
    process.env.MIDWAY4_DB_DATABASE || 'cool_admin_midway4_validation';
  const port = Number(process.env.MIDWAY4_DB_PORT || 5432);
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('Midway 4 容器门禁只允许 loopback PostgreSQL');
  }
  if (database !== 'cool_admin_midway4_validation') {
    throw new Error('Midway 4 容器门禁数据库名称不在允许清单');
  }
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
              type: 'postgres',
              host,
              port,
              username:
                process.env.MIDWAY4_DB_USERNAME ||
                process.env.PGUSER ||
                process.env.USER ||
                'postgres',
              password:
                process.env.MIDWAY4_DB_PASSWORD || process.env.PGPASSWORD || '',
              database,
              synchronize: false,
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
        database,
        synchronize: false,
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
