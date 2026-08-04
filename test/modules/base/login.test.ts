import { BaseSysLoginService } from '../../../src/modules/base/service/sys/login';

function serviceFixture() {
  const service = new BaseSysLoginService();
  Object.assign(service, {
    baseSysUserEntity: {
      findOneBy: jest.fn(async () => ({
        id: 7,
        username: 'operator',
        status: 1,
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
  jest
    .spyOn(service, 'generateToken')
    .mockResolvedValueOnce('admin-token')
    .mockResolvedValueOnce('refresh-token');
  return service;
}

describe('Admin 多登录方式共用会话签发', () => {
  it('外部身份只能通过 base_sys_user 与角色校验后签发 Admin JWT', async () => {
    const service = serviceFixture();
    await expect(service.loginByUserId(7)).resolves.toMatchObject({
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

  it('禁用用户与无角色用户都拒绝，且不会签发 token', async () => {
    const disabled = serviceFixture();
    (disabled.baseSysUserEntity.findOneBy as jest.Mock).mockResolvedValue({
      id: 7,
      username: 'operator',
      status: 0,
    });
    await expect(disabled.loginByUserId(7)).rejects.toThrow('已被禁用');
    expect(disabled.generateToken).not.toHaveBeenCalled();

    const noRole = serviceFixture();
    (noRole.baseSysRoleService.getByUser as jest.Mock).mockResolvedValue([]);
    await expect(noRole.loginByUserId(7)).rejects.toThrow('未设置任何角色');
    expect(noRole.generateToken).not.toHaveBeenCalled();
  });
});
