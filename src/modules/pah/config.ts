import { ModuleConfig } from '@cool-midway/core';

/**
 * Phoenix Admin Host 模块配置。
 *
 * Pah 只负责宿主契约与生命周期编排，不执行第三方插件源码。
 */
export default () => {
  return {
    name: 'Phoenix Admin Host',
    description: 'Phoenix 业务插件登记、校验与安全生命周期管理',
    middlewares: [],
    globalMiddlewares: [],
    order: 5,
  } as ModuleConfig;
};
