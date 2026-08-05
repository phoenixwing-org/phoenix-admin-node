import { CoolConfig } from '@cool-midway/core';
import { MidwayConfig } from '@midwayjs/core';
import { entities } from '../entities';
import { TenantSubscriber } from '../modules/base/db/tenant';

// 正式构建默认保持关闭；安装器可在全新数据库的第一次启动中显式开启，
// 从而复用 Cool 原生 db.json / menu.json 初始化流程。初始化完成后的常规
// 启动继续传 false，避免对既有数据库执行 synchronize 或重复导入。
const synchronize = process.env.PAH_DB_SYNCHRONIZE === 'true';
const initialize = process.env.PAH_DB_INITIALIZE === 'true';

/**
 * 本地开发 npm run prod 读取的配置文件
 */
export default {
  typeorm: {
    dataSource: {
      default: {
        type: 'postgres',
        host: process.env.PAH_DB_HOST || '127.0.0.1',
        port: Number(process.env.PAH_DB_PORT || 5432),
        username: process.env.PAH_DB_USERNAME || 'postgres',
        password: process.env.PAH_DB_PASSWORD || '',
        database: process.env.PAH_DB_DATABASE || 'phoenix_admin',
        // 自动建表 注意：线上部署的时候不要使用，有可能导致数据丢失
        synchronize,
        // 打印日志
        logging: false,
        // 是否开启缓存
        cache: true,
        // 实体路径
        entities,
        // 订阅者
        subscribers: [TenantSubscriber],
      },
    },
  },
  cool: {
    // 实体与路径，跟生成代码、前端请求、swagger文档相关 注意：线上不建议开启，以免暴露敏感信息
    eps: false,
    // 是否自动导入模块数据库
    initDB: initialize,
    // 判断是否初始化的方式
    initJudge: 'db',
    // 是否自动导入模块菜单
    initMenu: initialize,
  } as CoolConfig,
} as MidwayConfig;
