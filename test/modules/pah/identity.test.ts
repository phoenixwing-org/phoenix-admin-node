import { createHash } from 'crypto';
import {
  normalizePahIdentityReturnTo,
  pahIdentityCallbackUrl,
  PahFeishuIdentityConfig,
  PahIdentityConfig,
  PahIdentityFlowError,
} from '../../../src/modules/pah/interface/identity';
import { PahFeishuIdentityProvider } from '../../../src/modules/pah/provider/feishu';
import {
  PahIdentityRateLimiter,
  PahIdentityService,
} from '../../../src/modules/pah/service/identity';
import { BaseOpenController } from '../../../src/modules/base/controller/admin/open';

const feishuConfig: PahFeishuIdentityConfig = {
  enabled: true,
  appId: 'cli_test',
  appSecret: 'never-return-this-secret',
  redirectUri: 'http://127.0.0.1:8101/admin/base/open/oauth/feishu/callback',
  allowedTenantKeys: ['tenant-a'],
  scopes: ['contact:user.base:readonly'],
  authorizationUrl: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
  tokenUrl: 'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
  userInfoUrl: 'https://open.feishu.cn/open-apis/authen/v1/user_info',
};

const identityConfig: PahIdentityConfig = {
  frontendOrigin: 'http://127.0.0.1:9000',
  stateTtlSeconds: 600,
  ticketTtlSeconds: 120,
  feishu: feishuConfig,
};

function providerFixture() {
  const provider = new PahFeishuIdentityProvider();
  provider.config = { ...feishuConfig };
  provider.client = {
    post: jest.fn(async () => ({
      status: 200,
      data: { code: 0, access_token: 'temporary-access-token' },
    })),
    get: jest.fn(async () => ({
      status: 200,
      data: {
        code: 0,
        data: {
          tenant_key: 'tenant-a',
          open_id: 'open-a',
          user_id: 'user-a',
          union_id: 'union-a',
          name: '飞书测试用户',
          enterprise_email: 'tester@example.com',
        },
      },
    })),
  } as any;
  return provider;
}

describe('Pah 飞书 Provider', () => {
  it('未启用或配置不完整时 fail-closed', () => {
    const provider = providerFixture();
    provider.config.enabled = false;
    expect(provider.status()).toMatchObject({ enabled: false, ready: false });
    expect(() => provider.createAuthorizationUrl('state')).toThrow(
      '飞书登录未启用'
    );

    provider.config.enabled = true;
    provider.config.allowedTenantKeys = [];
    expect(provider.status()).toMatchObject({ enabled: true, ready: false });
    expect(() => provider.createAuthorizationUrl('state')).toThrow(
      '飞书登录配置不完整'
    );

    provider.config.allowedTenantKeys = ['tenant-a'];
    provider.config.redirectUri =
      'http://admin.example.com/admin/base/open/oauth/feishu/callback';
    expect(provider.status()).toMatchObject({ enabled: true, ready: false });
  });

  it('生成精确回调和 state，并映射 tenant_key:open_id', async () => {
    const provider = providerFixture();
    const authorizationUrl = new URL(
      provider.createAuthorizationUrl('one-time-state')
    );
    expect(authorizationUrl.searchParams.get('client_id')).toBe('cli_test');
    expect(authorizationUrl.searchParams.get('state')).toBe('one-time-state');
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(
      feishuConfig.redirectUri
    );

    const accessToken = await provider.exchangeCode('oauth-code');
    expect(accessToken).toBe('temporary-access-token');
    await expect(provider.getIdentity(accessToken)).resolves.toMatchObject({
      provider: 'feishu',
      providerSubject: 'tenant-a:open-a',
      tenantKey: 'tenant-a',
      openId: 'open-a',
    });
  });

  it('拒绝不在白名单的租户且不接受不完整身份', async () => {
    const provider = providerFixture();
    (provider.client.get as jest.Mock).mockResolvedValueOnce({
      status: 200,
      data: {
        code: 0,
        data: { tenant_key: 'tenant-other', open_id: 'open-other' },
      },
    });
    await expect(provider.getIdentity('temporary')).rejects.toMatchObject({
      code: 'tenant_not_allowed',
    });

    (provider.client.get as jest.Mock).mockResolvedValueOnce({
      status: 200,
      data: { code: 0, data: { tenant_key: 'tenant-a' } },
    });
    await expect(provider.getIdentity('temporary')).rejects.toMatchObject({
      code: 'identity_incomplete',
    });
  });
});

describe('Pah 外部身份登录编排', () => {
  it('对飞书登录入口执行单进程固定窗口限流', () => {
    const limiter = new PahIdentityRateLimiter();
    limiter.assert('start', '127.0.0.1', 2, 60_000);
    limiter.assert('start', '127.0.0.1', 2, 60_000);
    expect(() => limiter.assert('start', '127.0.0.1', 2, 60_000)).toThrow(
      '请求过于频繁'
    );
    try {
      limiter.assert('start', '127.0.0.1', 2, 60_000);
    } catch (error) {
      expect(error).toMatchObject({ code: 'rate_limited' });
    }
    expect(() => limiter.assert('start', '127.0.0.2', 2, 60_000)).not.toThrow();
  });

  it('只允许站内 returnTo，并固定前端 callback origin', () => {
    expect(normalizePahIdentityReturnTo('/system/users?q=1')).toBe(
      '/system/users?q=1'
    );
    expect(() => normalizePahIdentityReturnTo('https://evil.example')).toThrow(
      '登录返回地址不合法'
    );
    expect(() => normalizePahIdentityReturnTo('//evil.example')).toThrow(
      '登录返回地址不合法'
    );
    expect(
      pahIdentityCallbackUrl('http://127.0.0.1:9000', {
        provider: 'feishu',
        ticket: 'one-time',
      })
    ).toBe(
      'http://127.0.0.1:9000/oauth/callback?provider=feishu&ticket=one-time'
    );
    expect(() =>
      pahIdentityCallbackUrl('http://admin.example.com', {
        provider: 'feishu',
      })
    ).toThrow('后台登录回调地址未正确配置');
  });

  it('登录策略不暴露飞书密钥，start 只持久化 state 哈希', async () => {
    const service = new PahIdentityService();
    const provider = providerFixture();
    const save = jest.fn(async value => ({ ...value, id: 1 }));
    const create = jest.fn(value => ({ ...value }));
    Object.assign(service, {
      config: identityConfig,
      feishuProvider: provider,
      rateLimiter: { assert: jest.fn() },
      oauthAttemptEntity: { create, save },
    });

    expect(JSON.stringify(service.loginPolicy())).not.toContain(
      feishuConfig.appSecret
    );
    const result = await service.startFeishuLogin('/dashboard');
    const state = new URL(result.authorizationUrl).searchParams.get('state');
    const stored = create.mock.calls[0][0];
    expect(state).toBeTruthy();
    expect(stored.stateHash).toBe(
      createHash('sha256').update(state!).digest('hex')
    );
    expect(JSON.stringify(stored)).not.toContain(state);
    expect(stored.returnTo).toBe('/dashboard');
  });

  it('已绑定身份只生成一次性票据，未绑定身份进入待审查', async () => {
    const service = new PahIdentityService();
    const provider = providerFixture();
    const profile = await provider.getIdentity('temporary');
    const identity = {
      id: 7,
      userId: 9,
      provider: 'feishu',
      providerSubject: profile.providerSubject,
      status: 'active',
    } as any;
    Object.assign(service, {
      config: identityConfig,
      rateLimiter: { assert: jest.fn() },
      feishuProvider: {
        exchangeCode: jest.fn(async () => 'temporary-access-token'),
        getIdentity: jest.fn(async () => profile),
      },
      externalIdentityEntity: {
        findOneBy: jest.fn(async () => identity),
        save: jest.fn(async value => value),
      },
      baseSysLoginService: {
        assertUserCanLogin: jest.fn(async () => undefined),
      },
      oauthAttemptEntity: { update: jest.fn(async () => undefined) },
    });
    jest.spyOn(service as any, 'consumeAttempt').mockResolvedValue({
      id: 3,
      returnTo: '/dashboard',
    });
    jest
      .spyOn(service as any, 'createLoginTicket')
      .mockResolvedValue('single-use-ticket');

    await expect(
      service.completeFeishuCallback({ state: 'state', code: 'code' })
    ).resolves.toEqual({
      provider: 'feishu',
      status: 'authenticated',
      ticket: 'single-use-ticket',
      returnTo: '/dashboard',
    });

    (service.externalIdentityEntity.findOneBy as jest.Mock).mockResolvedValue(
      null
    );
    jest
      .spyOn(service as any, 'upsertBindRequest')
      .mockResolvedValue({ id: 11 });
    await expect(
      service.completeFeishuCallback({ state: 'next-state', code: 'code' })
    ).resolves.toEqual({
      provider: 'feishu',
      status: 'pending',
      requestId: 11,
      returnTo: '/dashboard',
    });
  });

  it('ticket 兑换复用 Admin JWT 签发并更新最近登录时间', async () => {
    const service = new PahIdentityService();
    Object.assign(service, {
      rateLimiter: { assert: jest.fn() },
      baseSysLoginService: {
        loginByUserId: jest.fn(async () => ({
          token: 'admin-token',
          refreshToken: 'refresh-token',
        })),
      },
      externalIdentityEntity: {
        update: jest.fn(async () => undefined),
      },
    });
    jest.spyOn(service as any, 'consumeTicket').mockResolvedValue({
      userId: 9,
      identityId: 7,
      returnTo: '/dashboard',
    });

    await expect(service.exchangeTicket('single-use-ticket')).resolves.toEqual({
      token: 'admin-token',
      refreshToken: 'refresh-token',
      returnTo: '/dashboard',
    });
    expect(service.baseSysLoginService.loginByUserId).toHaveBeenCalledWith(9);
    expect(service.externalIdentityEntity.update).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ lastLoginAt: expect.any(String) })
    );
  });

  it('公开接口返回固定 flow error，回调配置错误时不二次抛错', async () => {
    const controller = new BaseOpenController();
    const ctx = {
      ip: '127.0.0.1',
      redirect: jest.fn(),
      status: 200,
      body: undefined,
    } as any;
    Object.assign(controller, {
      ctx,
      identityConfig: { ...identityConfig, frontendOrigin: 'not-a-url' },
      pahIdentityService: {
        startFeishuLogin: jest.fn(async () => {
          throw new PahIdentityFlowError(
            'provider_misconfigured',
            '飞书登录配置不完整'
          );
        }),
        completeFeishuCallback: jest.fn(async () => {
          throw new PahIdentityFlowError(
            'provider_unavailable',
            '飞书认证服务暂时不可用'
          );
        }),
      },
    });

    await expect(controller.startFeishuLogin('/')).resolves.toMatchObject({
      message: '飞书登录配置不完整',
      data: { error: 'provider_misconfigured' },
    });
    expect(ctx.status).toBe(503);

    await expect(
      controller.feishuCallback('state', 'code')
    ).resolves.toBeUndefined();
    expect(ctx.status).toBe(503);
    expect(ctx.body).toMatchObject({
      data: { error: 'provider_misconfigured' },
    });
  });
});
