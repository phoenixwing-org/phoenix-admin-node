import { CoolConfig } from '@cool-midway/core';
import { MidwayConfig } from '@midwayjs/core';
import { randomBytes } from 'crypto';
import { TenantSubscriber } from '../modules/base/db/tenant';

const host = process.env.MIDWAY4_DB_HOST || '127.0.0.1';
const database =
  process.env.MIDWAY4_DB_DATABASE || 'cool_admin_midway4_validation';
const port = Number(process.env.MIDWAY4_DB_PORT || 5432);
// 候选服务只监听 loopback；每次启动生成临时密钥，既不写源码，也不形成正式凭据。
const runtimeSecret = randomBytes(32).toString('hex');

if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  throw new Error('Midway 4 联调数据库只允许 loopback PostgreSQL');
}
if (database !== 'cool_admin_midway4_validation') {
  throw new Error('Midway 4 联调数据库名称不在允许清单');
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Midway 4 联调数据库端口无效');
}

/**
 * Midway 4 联调专用配置。
 *
 * 只允许本机、精确命名的 PostgreSQL 隔离库，不连接默认 MySQL、共享开发库
 * 或生产库。synchronize/initDB/initMenu 仅作用于该联调库。
 */
export default {
  keys: runtimeSecret,
  koa: {
    hostname: '127.0.0.1',
    port: 8001,
  },
  typeorm: {
    dataSource: {
      default: {
        type: 'postgres',
        host,
        port,
        username:
          process.env.MIDWAY4_DB_USERNAME || process.env.PGUSER || 'postgres',
        password:
          process.env.MIDWAY4_DB_PASSWORD || process.env.PGPASSWORD || '',
        database,
        synchronize: true,
        logging: false,
        entities: ['**/modules/*/entity'],
        subscribers: [TenantSubscriber],
      },
    },
  },
  cool: {
    eps: true,
    initDB: true,
    initJudge: 'db',
    initMenu: true,
  } as CoolConfig,
  module: {
    base: {
      jwt: {
        secret: runtimeSecret,
      },
    },
    user: {
      jwt: {
        secret: runtimeSecret,
      },
    },
  },
} as MidwayConfig;
