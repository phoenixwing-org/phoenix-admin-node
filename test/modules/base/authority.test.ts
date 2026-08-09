import * as jwt from 'jsonwebtoken';
import {
  BaseAuthorityMiddleware,
  matchesCoolPermission,
} from '../../../src/modules/base/middleware/authority';

describe('Cool / Pah endpoint permission matching', () => {
  it('preserves the historical colon-separated action convention', () => {
    expect(
      matchesCoolPermission(
        'base:sys:user:list',
        'GET',
        '/admin/base/sys/user/list?page=1'
      )
    ).toBe(true);
    expect(
      matchesCoolPermission(
        'base:sys:user:update',
        'POST',
        '/admin/base/sys/user/list'
      )
    ).toBe(false);
  });

  it('matches an explicit endpoint only for its method and one-segment params', () => {
    const permission = 'GET /admin/example-plugin/item/:id';
    expect(
      matchesCoolPermission(
        permission,
        'GET',
        '/admin/example-plugin/item/issue-1'
      )
    ).toBe(true);
    expect(
      matchesCoolPermission(
        permission,
        'DELETE',
        '/admin/example-plugin/item/issue-1'
      )
    ).toBe(false);
    expect(
      matchesCoolPermission(
        permission,
        'GET',
        '/admin/example-plugin/item/issue-1/extra'
      )
    ).toBe(false);
  });

  it('does not interpret undeclared wildcards or cross-plugin paths', () => {
    expect(
      matchesCoolPermission(
        'GET /admin/example-plugin/items/*',
        'GET',
        '/admin/example-plugin/items/1'
      )
    ).toBe(false);
    expect(
      matchesCoolPermission(
        'GET /admin/example-plugin/items',
        'GET',
        '/admin/other-plugin/items'
      )
    ).toBe(false);
  });
});

describe('非 root Pah endpoint 权限旅程', () => {
  function middlewareFixture(perms: string[]) {
    const middleware = new BaseAuthorityMiddleware();
    Object.assign(middleware, {
      prefix: '',
      jwtConfig: { jwt: { secret: 'test', sso: false } },
      ignoreUrls: [],
      utils: { matchUrl: jest.fn(() => false) },
      midwayCache: {
        get: jest.fn(async key => {
          if (key === 'admin:token:7') return 'token-7';
          if (key === 'admin:passwordVersion:7') return 3;
          if (key === 'admin:perms:7') return perms;
          return undefined;
        }),
      },
    });
    const verify = jest.spyOn(jwt, 'verify').mockReturnValue({
      userId: 7,
      username: 'operator',
      passwordVersion: 3,
      isRefresh: false,
    } as any);
    return { middleware, verify };
  }

  function context(method: string, url: string) {
    return {
      method,
      url,
      status: 200,
      get: jest.fn(() => 'token-7'),
    } as any;
  }

  afterEach(() => jest.restoreAllMocks());

  it('显式授权的 REST endpoint 对普通用户放行', async () => {
    const { middleware } = middlewareFixture([
      'GET /admin/example-plugin/item/:id',
    ]);
    const next = jest.fn().mockResolvedValue(undefined);

    await middleware.resolve()(
      context('GET', '/admin/example-plugin/item/item-1'),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('同一路径未授权 method 与越界子路径都返回 403', async () => {
    const { middleware } = middlewareFixture([
      'GET /admin/example-plugin/item/:id',
    ]);
    const next = jest.fn().mockResolvedValue(undefined);

    await expect(
      middleware.resolve()(
        context('DELETE', '/admin/example-plugin/item/item-1'),
        next
      )
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      middleware.resolve()(
        context('GET', '/admin/example-plugin/item/item-1/history'),
        next
      )
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(next).not.toHaveBeenCalled();
  });

  it('没有 capability 的已登录普通用户返回 403', async () => {
    const { middleware } = middlewareFixture([]);
    const next = jest.fn().mockResolvedValue(undefined);

    await expect(
      middleware.resolve()(
        context('GET', '/admin/example-plugin/item/item-1'),
        next
      )
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(next).not.toHaveBeenCalled();
  });

  it('匿名请求返回 401', async () => {
    const { middleware, verify } = middlewareFixture([
      'GET /admin/example-plugin/item/:id',
    ]);
    verify.mockImplementation(() => {
      throw new Error('missing token');
    });
    const next = jest.fn().mockResolvedValue(undefined);

    await expect(
      middleware.resolve()(
        context('GET', '/admin/example-plugin/item/item-1'),
        next
      )
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(next).not.toHaveBeenCalled();
  });

  it('root admin 保持 Host 旁路并返回 200', async () => {
    const { middleware, verify } = middlewareFixture([]);
    verify.mockReturnValue({
      userId: 7,
      username: 'admin',
      passwordVersion: 3,
      isRefresh: false,
    } as any);
    const next = jest.fn().mockResolvedValue(undefined);

    await middleware.resolve()(
      context('DELETE', '/admin/example-plugin/item/item-1'),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('身份管理接口保持 root 200、普通用户 403、匿名 401', async () => {
    const endpoint = '/admin/pah/identity/bind-request/list';
    const next = jest.fn().mockResolvedValue(undefined);

    const root = middlewareFixture([]);
    root.verify.mockReturnValue({
      userId: 7,
      username: 'admin',
      passwordVersion: 3,
      isRefresh: false,
    } as any);
    await root.middleware.resolve()(context('GET', endpoint), next);
    expect(next).toHaveBeenCalledTimes(1);

    jest.restoreAllMocks();
    const operator = middlewareFixture([]);
    await expect(
      operator.middleware.resolve()(context('GET', endpoint), jest.fn())
    ).rejects.toMatchObject({ statusCode: 403 });

    jest.restoreAllMocks();
    const anonymous = middlewareFixture([]);
    anonymous.verify.mockImplementation(() => {
      throw new Error('missing token');
    });
    await expect(
      anonymous.middleware.resolve()(context('GET', endpoint), jest.fn())
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
