import { Body, Get, Inject, Post, Provide, Query } from '@midwayjs/core';
import { BaseController, CoolController } from '@cool-midway/core';
import { Context } from '@midwayjs/koa';
import { PahIdentityService } from '../../service/identity';

/** Host-owned 外部身份待审查与绑定管理。 */
@Provide()
@CoolController()
export class PahIdentityController extends BaseController {
  @Inject()
  pahIdentityService: PahIdentityService;

  @Inject()
  ctx: Context;

  @Get('/bind-request/list', { summary: '查询外部身份待审查记录' })
  async bindRequestList(@Query('status') status?: string) {
    return this.ok(await this.pahIdentityService.listBindRequests(status));
  }

  @Post('/bind-request/bind', { summary: '绑定外部身份到后台用户' })
  async bindRequest(
    @Body('requestId') requestId: number,
    @Body('userId') userId: number
  ) {
    return this.ok(
      await this.pahIdentityService.bindRequest(
        Number(requestId),
        Number(userId),
        Number(this.ctx.admin.userId)
      )
    );
  }

  @Post('/bind-request/reject', { summary: '拒绝外部身份绑定申请' })
  async rejectRequest(
    @Body('requestId') requestId: number,
    @Body('note') note?: string
  ) {
    return this.ok(
      await this.pahIdentityService.rejectRequest(
        Number(requestId),
        Number(this.ctx.admin.userId),
        note
      )
    );
  }

  @Get('/external-identity/list', { summary: '查询后台用户的外部身份' })
  async externalIdentityList(@Query('userId') userId?: number) {
    return this.ok(
      await this.pahIdentityService.listExternalIdentities(
        userId === undefined ? undefined : Number(userId)
      )
    );
  }

  @Post('/external-identity/unlink', { summary: '解除外部身份绑定' })
  async unlinkIdentity(@Body('identityId') identityId: number) {
    return this.ok(
      await this.pahIdentityService.unlinkIdentity(
        Number(identityId),
        Number(this.ctx.admin.userId)
      )
    );
  }
}
