import { ModuleConfig } from '@cool-midway/core';

/**
 * Phoenix Admin Host 模块配置。
 *
 * Pah 只负责宿主契约与生命周期编排，不执行第三方插件源码。
 */
export default () => {
  const list = (value?: string) => [
    ...new Set(
      (value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
    ),
  ];
  const positiveSeconds = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    name: 'Phoenix Admin Host',
    description: 'Phoenix 业务插件登记、校验与安全生命周期管理',
    middlewares: [],
    globalMiddlewares: [],
    order: 5,
    identity: {
      frontendOrigin:
        process.env.PAH_ADMIN_WEB_ORIGIN || 'http://127.0.0.1:9000',
      stateTtlSeconds: positiveSeconds(
        process.env.PAH_OAUTH_STATE_TTL_SECONDS,
        10 * 60
      ),
      ticketTtlSeconds: positiveSeconds(
        process.env.PAH_OAUTH_TICKET_TTL_SECONDS,
        2 * 60
      ),
      feishu: {
        enabled: process.env.PAH_FEISHU_LOGIN_ENABLED === 'true',
        appId: process.env.PAH_FEISHU_APP_ID || '',
        appSecret: process.env.PAH_FEISHU_APP_SECRET || '',
        redirectUri: process.env.PAH_FEISHU_REDIRECT_URI || '',
        allowedTenantKeys: list(process.env.PAH_FEISHU_ALLOWED_TENANT_KEYS),
        scopes: list(process.env.PAH_FEISHU_SCOPES),
        authorizationUrl:
          process.env.PAH_FEISHU_AUTHORIZATION_URL ||
          'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
        tokenUrl:
          process.env.PAH_FEISHU_TOKEN_URL ||
          'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
        userInfoUrl:
          process.env.PAH_FEISHU_USER_INFO_URL ||
          'https://open.feishu.cn/open-apis/authen/v1/user_info',
      },
    },
  } as ModuleConfig;
};
