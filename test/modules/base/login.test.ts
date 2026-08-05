import * as md5 from 'md5';
import { BaseSysLoginService } from '../../../src/modules/base/service/sys/login';

const loginInput = {
  username: 'operator',
  password: 'one-time-password',
  captchaId: 'captcha-id',
  verifyCode: 1234,
};

function serviceFixture() {
  const service = new BaseSysLoginService();
  Object.assign(service, {
    baseSysUserEntity: {
      findOneBy: jest.fn(async () => ({
        id: 7,
        username: 'operator',
        status: 1,
        password: md5(loginInput.password),
        passwordV: 3,
      })),
    },
    baseSysRoleService: { getByUser: jest.fn(async () => [2]) },
    baseSysMenuService: { getPerms: jest.fn(async () => ['base:read']) },
    baseSysDepartmentService: { getByRoleIds: jest.fn(async () => [5]) },
    midwayCache: { set: jest.fn(async () => undefined) },
    coolConfig: {
      jwt: {
        secret: 'test-secret',
        token: { expire: 7200, refreshExpire: 86400 },
      },
    },
  });
  jest.spyOn(service, 'captchaCheck').mockResolvedValue(true);
  jest
    .spyOn(service, 'generateToken')
    .mockResolvedValueOnce('admin-token')
    .mockResolvedValueOnce('refresh-token');
  return service;
}

describe('Admin 密码登录会话签发', () => {
  it('校验用户和角色后签发并分别缓存访问令牌与刷新令牌', async () => {
    const service = serviceFixture();
    await expect(service.login(loginInput)).resolves.toMatchObject({
      token: 'admin-token',
      refreshToken: 'refresh-token',
    });
    expect(service.baseSysMenuService.getPerms).toHaveBeenCalledWith([2]);
    expect(service.midwayCache.set).toHaveBeenCalledWith(
      'admin:token:7',
      'admin-token'
    );
    expect(service.midwayCache.set).toHaveBeenCalledWith(
      'admin:token:refresh:7',
      'refresh-token'
    );
  });

  it('禁用用户与无角色用户都拒绝，且不会签发令牌', async () => {
    const disabled = serviceFixture();
    (disabled.baseSysUserEntity.findOneBy as jest.Mock).mockResolvedValue({
      id: 7,
      username: 'operator',
      status: 0,
      password: md5(loginInput.password),
    });
    await expect(disabled.login(loginInput)).rejects.toThrow(
      '账户或密码不正确'
    );
    expect(disabled.generateToken).not.toHaveBeenCalled();

    const noRole = serviceFixture();
    (noRole.baseSysRoleService.getByUser as jest.Mock).mockResolvedValue([]);
    await expect(noRole.login(loginInput)).rejects.toThrow('未设置任何角色');
    expect(noRole.generateToken).not.toHaveBeenCalled();
  });
});
