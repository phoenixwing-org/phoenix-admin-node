import {
  Provide,
  Body,
  Inject,
  Post,
  Get,
  Query,
  Config,
  Param,
} from '@midwayjs/core';
import {
  CoolController,
  BaseController,
  CoolEps,
  CoolUrlTag,
  CoolTag,
  TagTypes,
  RESCODE,
} from '@cool-midway/core';
import { LoginDTO } from '../../dto/login';
import { BaseSysLoginService } from '../../service/sys/login';
import { BaseSysParamService } from '../../service/sys/param';
import { Context } from '@midwayjs/koa';
import { Validate } from '@midwayjs/validate';
import { PahIdentityService } from '../../../phoenix/service/identity';
import {
  pahIdentityCallbackUrl,
  PahIdentityConfig,
  PahIdentityFlowError,
} from '../../../phoenix/interface/identity';
import { PahPublicLoginBrandingService } from '../../../phoenix/service/public-login-branding';

/**
 * 不需要登录的后台接口
 */
@Provide()
@CoolController({ description: '开放接口' })
@CoolUrlTag()
export class BaseOpenController extends BaseController {
  @Inject()
  baseSysLoginService: BaseSysLoginService;

  @Inject()
  baseSysParamService: BaseSysParamService;

  @Inject()
  ctx: Context;

  @Inject()
  eps: CoolEps;

  @Inject()
  pahIdentityService: PahIdentityService;

  @Inject()
  pahPublicLoginBrandingService: PahPublicLoginBrandingService;

  @Config('module.phoenix.identity')
  identityConfig: PahIdentityConfig;

  /**
   * 实体信息与路径
   * @returns
   */
  @CoolTag(TagTypes.IGNORE_TOKEN)
  @Get('/eps', { summary: '实体信息与路径' })
  public async getEps() {
    return this.ok(this.eps.admin);
  }

  /**
   * 根据配置参数key获得网页内容(富文本)
   */
  @CoolTag(TagTypes.IGNORE_TOKEN)
  @Get('/html', { summary: '获得网页内容的参数值' })
  async htmlByKey(@Query('key') key: string) {
    this.ctx.body = await this.baseSysParamService.htmlByKey(key);
  }

  /**
   * 登录
   * @param login
   */
  @CoolTag(TagTypes.IGNORE_TOKEN)
  @Post('/login', { summary: '登录' })
  @Validate()
  async login(@Body() login: LoginDTO) {
    return this.ok(await this.baseSysLoginService.login(login));
  }

  /** 后台登录页只读能力；不返回 App Secret 或内部配置。 */
  @CoolTag(TagTypes.IGNORE_TOKEN)
  @Get('/login-policy', { summary: '后台登录方式与就绪状态' })
  async loginPolicy() {
    return this.ok({
      ...this.pahIdentityService.loginPolicy(),
      captchaRequired: this.baseSysLoginService.captchaRequired(),
    });
  }

  /**
   * HTML 解析阶段同步执行的公开登录品牌快照。
   * 只返回 Host 固定 wrapper 与严格白名单 JSON，不执行插件脚本。
   */
  @CoolTag(TagTypes.IGNORE_TOKEN)
  @Get('/public-login-branding', { summary: '公开登录品牌启动快照' })
  async publicLoginBrandingBootstrap() {
    this.ctx.status = 200;
    this.ctx.type = 'application/javascript; charset=utf-8';
    this.ctx.set('Cache-Control', 'no-store, max-age=0');
    this.ctx.set('Pragma', 'no-cache');
    this.ctx.set('X-Content-Type-Options', 'nosniff');
    this.ctx.body = this.pahPublicLoginBrandingService.bootstrapScript();
  }

  /** 内容哈希 URL；资源仅来自已校验、已安装的插件包。 */
  @CoolTag(TagTypes.IGNORE_TOKEN)
  @Get('/public-login-branding/assets/:digest/:filename', {
    summary: '公开登录品牌哈希资源',
  })
  async publicLoginBrandingAsset(
    @Param('digest') digest: string,
    @Param('filename') filename: string
  ) {
    const asset = this.pahPublicLoginBrandingService.readPublicAsset(
      digest,
      filename
    );
    this.ctx.status = 200;
    this.ctx.type = asset.mime;
    this.ctx.set('Cache-Control', 'public, max-age=31536000, immutable');
    this.ctx.set('X-Content-Type-Options', 'nosniff');
    this.ctx.body = asset.content;
  }

  @CoolTag(TagTypes.IGNORE_TOKEN)
  @Get('/oauth/feishu/start', { summary: '开始飞书后台登录' })
  async startFeishuLogin(@Query('returnTo') returnTo?: string) {
    try {
      return this.ok(
        await this.pahIdentityService.startFeishuLogin(returnTo, this.ctx.ip)
      );
    } catch (error) {
      return this.identityFlowFailure(error);
    }
  }

  @CoolTag(TagTypes.IGNORE_TOKEN)
  @Get('/oauth/feishu/callback', { summary: '飞书后台登录回调' })
  async feishuCallback(
    @Query('state') state?: string,
    @Query('code') code?: string,
    @Query('error') error?: string
  ) {
    try {
      const result = await this.pahIdentityService.completeFeishuCallback(
        { state, code, error },
        this.ctx.ip
      );
      const params: Record<string, string> = {
        provider: result.provider,
        status: result.status,
        returnTo: result.returnTo,
      };
      if (result.status === 'authenticated') params.ticket = result.ticket;
      if (result.status === 'pending') {
        params.requestId = String(result.requestId);
      }
      this.ctx.redirect(
        pahIdentityCallbackUrl(this.identityConfig.frontendOrigin, params)
      );
    } catch (caught) {
      const flowError =
        caught instanceof PahIdentityFlowError
          ? caught
          : new PahIdentityFlowError(
              'provider_response_error',
              '飞书登录未完成，请重新尝试'
            );
      try {
        this.ctx.redirect(
          pahIdentityCallbackUrl(this.identityConfig.frontendOrigin, {
            provider: 'feishu',
            error: flowError.code,
            returnTo: flowError.returnTo,
          })
        );
      } catch {
        this.ctx.status = 503;
        this.ctx.body = identityFlowFailureBody(
          new PahIdentityFlowError(
            'provider_misconfigured',
            '后台登录回调地址未正确配置'
          )
        );
      }
    }
  }

  @CoolTag(TagTypes.IGNORE_TOKEN)
  @Post('/oauth/exchange-ticket', { summary: '兑换飞书一次性登录票据' })
  async exchangeFeishuTicket(@Body('ticket') ticket: string) {
    try {
      return this.ok(
        await this.pahIdentityService.exchangeTicket(ticket, this.ctx.ip)
      );
    } catch (error) {
      return this.identityFlowFailure(error);
    }
  }

  private identityFlowFailure(error: unknown) {
    if (!(error instanceof PahIdentityFlowError)) throw error;
    this.ctx.status = identityFlowStatus(error);
    return identityFlowFailureBody(error);
  }

  /**
   * 获得验证码
   */
  @CoolTag(TagTypes.IGNORE_TOKEN)
  @Get('/captcha', { summary: '验证码' })
  async captcha(
    @Query('width') width: number,
    @Query('height') height: number,
    @Query('color') color: string
  ) {
    return this.ok(
      await this.baseSysLoginService.captcha(width, height, color)
    );
  }

  /**
   * 刷新token
   */
  @CoolTag(TagTypes.IGNORE_TOKEN)
  @Get('/refreshToken', { summary: '刷新token' })
  async refreshToken(@Query('refreshToken') refreshToken: string) {
    try {
      const token = await this.baseSysLoginService.refreshToken(refreshToken);
      return this.ok(token);
    } catch (e) {
      this.ctx.status = 401;
      this.ctx.body = {
        code: RESCODE.COMMFAIL,
        message: '登录失效~',
      };
    }
  }
}

function identityFlowStatus(error: PahIdentityFlowError) {
  if (error.code === 'rate_limited') return 429;
  if (
    [
      'provider_disabled',
      'provider_misconfigured',
      'provider_unavailable',
    ].includes(error.code)
  ) {
    return 503;
  }
  if (
    ['tenant_not_allowed', 'identity_pending', 'identity_revoked'].includes(
      error.code
    )
  ) {
    return 403;
  }
  if (error.code === 'expired_ticket') return 401;
  return 400;
}

function identityFlowFailureBody(error: PahIdentityFlowError) {
  return {
    code: RESCODE.COMMFAIL,
    message: error.message,
    data: { error: error.code },
  };
}
