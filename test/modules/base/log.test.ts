import { sanitizeBaseLogParams } from '../../../src/modules/base/middleware/log';

describe('后台认证请求日志脱敏', () => {
  it('隐藏密码、验证码与 refresh token', () => {
    expect(
      sanitizeBaseLogParams('/admin/base/open/login', {
        username: 'operator',
        password: 'secret',
        captchaId: 'captcha',
        verifyCode: '1234',
      })
    ).toEqual({
      username: 'operator',
      password: '[REDACTED]',
      captchaId: '[REDACTED]',
      verifyCode: '[REDACTED]',
    });
    expect(
      sanitizeBaseLogParams('/admin/base/open/refreshToken', {
        refreshToken: 'refresh-token',
      })
    ).toEqual({ refreshToken: '[REDACTED]' });
  });

  it('不改变非认证端点参数和原始对象', () => {
    const params = { code: 'business-code', nested: { ticket: 'ordinary' } };
    expect(sanitizeBaseLogParams('/admin/demo/info/list', params)).toBe(params);
    expect(params).toEqual({
      code: 'business-code',
      nested: { ticket: 'ordinary' },
    });
  });
});
