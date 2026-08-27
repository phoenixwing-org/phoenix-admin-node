import { Body, Get, Inject, Post, Provide, Query } from '@midwayjs/core';
import { BaseController, CoolController } from '@cool-midway/core';
import { Context } from '@midwayjs/koa';
import { PahIdentityService } from '../../service/identity';

/** 旧外部身份 API 的兼容入口；新调用方使用 /admin/phoenix/identity。 */
@Provide()
@CoolController('/admin/pah/identity')
export class LegacyPahIdentityController extends BaseController {
  @Inject()
  pahIdentityService: PahIdentityService;

  @Inject()
  ctx: Context;

  @Get('/bind-request/list')
  async bindRequestList(@Query('status') status?: string) {
    return this.ok(await this.pahIdentityService.listBindRequests(status));
  }

  @Post('/bind-request/bind')
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

  @Post('/bind-request/reject')
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

  @Get('/external-identity/list')
  async externalIdentityList(@Query('userId') userId?: number) {
    return this.ok(
      await this.pahIdentityService.listExternalIdentities(
        userId === undefined ? undefined : Number(userId)
      )
    );
  }

  @Post('/external-identity/unlink')
  async unlinkIdentity(@Body('identityId') identityId: number) {
    return this.ok(
      await this.pahIdentityService.unlinkIdentity(
        Number(identityId),
        Number(this.ctx.admin.userId)
      )
    );
  }
}
