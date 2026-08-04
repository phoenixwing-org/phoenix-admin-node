import { Inject, Provide, Config, InjectClient } from '@midwayjs/core';
import { BaseService, CoolCommException } from '@cool-midway/core';
import { LoginDTO } from '../../dto/login';
import { v1 as uuid } from 'uuid';
import { BaseSysUserEntity } from '../../entity/sys/user';
import { Repository } from 'typeorm';
import { InjectEntityModel } from '@midwayjs/typeorm';
import * as md5 from 'md5';
import { BaseSysRoleService } from './role';
import * as _ from 'lodash';
import { BaseSysMenuService } from './menu';
import { BaseSysDepartmentService } from './department';
import * as jwt from 'jsonwebtoken';
import { Context } from '@midwayjs/koa';
import { CachingFactory, MidwayCache } from '@midwayjs/cache-manager';
import { Utils } from '../../../../comm/utils';
import * as svgCaptcha from 'svg-captcha';

/**
 * 登录
 */
@Provide()
export class BaseSysLoginService extends BaseService {
  @InjectClient(CachingFactory, 'default')
  midwayCache: MidwayCache;

  @InjectEntityModel(BaseSysUserEntity)
  baseSysUserEntity: Repository<BaseSysUserEntity>;

  @Inject()
  baseSysRoleService: BaseSysRoleService;

  @Inject()
  baseSysMenuService: BaseSysMenuService;

  @Inject()
  baseSysDepartmentService: BaseSysDepartmentService;

  @Inject()
  ctx: Context;

  @Inject()
  utils: Utils;

  @Config('module.base')
  coolConfig;

  /**
   * 登录
   * @param login
   */
  async login(login: LoginDTO) {
    const { username, captchaId, verifyCode, password } = login;
    // 校验验证码
    const checkV = await this.captchaCheck(captchaId, verifyCode);
    if (checkV) {
      const user = await this.baseSysUserEntity.findOneBy({ username });
      // 校验用户状态及密码
      if (!user || user.status === 0 || user.password !== md5(password)) {
        throw new CoolCommException('账户或密码不正确~');
      }
      return this.issueLoginSession(user);
    } else {
      throw new CoolCommException('验证码不正确');
    }
  }

  /**
   * 由已经完成 Host 身份校验的登录方式签发后台会话。
   * 外部 Provider 只能传入绑定后的 base_sys_user.id，不能自行签发 JWT。
   */
  async loginByUserId(userId: number) {
    const user = await this.baseSysUserEntity.findOneBy({ id: userId });
    if (!user || user.status !== 1) {
      throw new CoolCommException('绑定的后台账号不存在或已被禁用');
    }
    return this.issueLoginSession(user);
  }

  /** 绑定外部身份前校验后台用户是否具备真实登录条件。 */
  async assertUserCanLogin(userId: number) {
    const user = await this.baseSysUserEntity.findOneBy({ id: userId });
    if (!user || user.status !== 1) {
      throw new CoolCommException('目标后台账号不存在或已被禁用');
    }
    const roleIds = await this.baseSysRoleService.getByUser(user.id);
    if (_.isEmpty(roleIds)) {
      throw new CoolCommException('目标后台账号未设置任何角色，无法登录');
    }
    return { user, roleIds };
  }

  private async issueLoginSession(user: BaseSysUserEntity) {
    const loginContext = await this.assertUserCanLogin(user.id);
    user = loginContext.user;
    const { roleIds } = loginContext;
    const { expire, refreshExpire } = this.coolConfig.jwt.token;
    const result = {
      expire,
      token: await this.generateToken(user, roleIds, expire),
      refreshExpire,
      refreshToken: await this.generateToken(
        user,
        roleIds,
        refreshExpire,
        true
      ),
    };

    const perms = await this.baseSysMenuService.getPerms(roleIds);
    const departments = await this.baseSysDepartmentService.getByRoleIds(
      roleIds,
      user.username === 'admin'
    );
    await this.midwayCache.set(`admin:department:${user.id}`, departments);
    await this.midwayCache.set(`admin:perms:${user.id}`, perms);
    await this.midwayCache.set(`admin:token:${user.id}`, result.token);
    await this.midwayCache.set(
      `admin:token:refresh:${user.id}`,
      result.refreshToken
    );
    return result;
  }

  /**
   * 验证码
   * @param width 宽
   * @param height 高
   */
  async captcha(width = 150, height = 50, color = '#fff') {
    const svg = svgCaptcha.create({
      // ignoreChars: 'qwertyuiopasdfghjklzxcvbnmQWERTYUIOPASDFGHJKLZXCVBNM',
      width,
      height,
      noise: 3,
    });
    const result = {
      captchaId: uuid(),
      data: svg.data.replace(/"/g, "'"),
    };
    // 文字变白
    const rpList = [
      '#111',
      '#222',
      '#333',
      '#444',
      '#555',
      '#666',
      '#777',
      '#888',
      '#999',
    ];
    rpList.forEach(rp => {
      result.data = result.data['replaceAll'](rp, color);
    });

    // Convert SVG to base64
    const base64Data = Buffer.from(result.data).toString('base64');
    result.data = `data:image/svg+xml;base64,${base64Data}`;

    // 半小时过期
    await this.midwayCache.set(
      `verify:img:${result.captchaId}`,
      svg.text.toLowerCase(),
      1800 * 1000
    );
    return result;
  }

  /**
   * 退出登录
   */
  async logout() {
    if (!this.coolConfig.jwt.sso) return;
    const { userId } = this.ctx.admin;
    await this.midwayCache.del(`admin:department:${userId}`);
    await this.midwayCache.del(`admin:perms:${userId}`);
    await this.midwayCache.del(`admin:token:${userId}`);
    await this.midwayCache.del(`admin:token:refresh:${userId}`);
    await this.midwayCache.del(`admin:passwordVersion:${userId}`);
  }

  /**
   * 检验图片验证码
   * @param captchaId 验证码ID
   * @param value 验证码
   */
  async captchaCheck(captchaId, value) {
    const rv = await this.midwayCache.get(`verify:img:${captchaId}`);
    if (!rv || !value || value.toLowerCase() !== rv) {
      return false;
    } else {
      this.midwayCache.del(`verify:img:${captchaId}`);
      return true;
    }
  }

  /**
   * 生成token
   * @param user 用户对象
   * @param roleIds 角色集合
   * @param expire 过期
   * @param isRefresh 是否是刷新
   */
  async generateToken(user, roleIds, expire, isRefresh?) {
    await this.midwayCache.set(
      `admin:passwordVersion:${user.id}`,
      user.passwordV
    );
    const tokenInfo = {
      isRefresh: false,
      roleIds,
      username: user.username,
      userId: user.id,
      passwordVersion: user.passwordV,
      tenantId: user['tenantId'],
    };
    if (isRefresh) {
      tokenInfo.isRefresh = true;
    }
    return jwt.sign(tokenInfo, this.coolConfig.jwt.secret, {
      expiresIn: expire,
    });
  }

  /**
   * 刷新token
   * @param token
   */
  async refreshToken(token: string) {
    const decoded = jwt.verify(token, this.coolConfig.jwt.secret);
    if (decoded && decoded['isRefresh']) {
      delete decoded['exp'];
      delete decoded['iat'];

      const { expire, refreshExpire } = this.coolConfig.jwt.token;
      decoded['isRefresh'] = false;
      const result = {
        expire,
        token: jwt.sign(decoded, this.coolConfig.jwt.secret, {
          expiresIn: expire,
        }),
        refreshExpire,
        refreshToken: '',
      };
      decoded['isRefresh'] = true;
      result.refreshToken = jwt.sign(decoded, this.coolConfig.jwt.secret, {
        expiresIn: refreshExpire,
      });
      await this.midwayCache.set(
        `admin:passwordVersion:${decoded['userId']}`,
        decoded['passwordVersion']
      );
      await this.midwayCache.set(
        `admin:token:${decoded['userId']}`,
        result.token
      );
      return result;
    }
  }
}
