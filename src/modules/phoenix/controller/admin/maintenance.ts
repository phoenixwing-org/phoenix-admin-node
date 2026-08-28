import { Body, Get, Inject, Post, Provide } from '@midwayjs/core';
import { BaseController, CoolController } from '@cool-midway/core';
import { PhoenixMaintenanceService } from '../../service/maintenance';

/** Host-owned 等幂检测与维护入口；不接收任意 SQL 或脚本。 */
@Provide()
@CoolController('/admin/phoenix/maintenance')
export class PhoenixMaintenanceController extends BaseController {
  @Inject()
  phoenixMaintenanceService: PhoenixMaintenanceService;

  @Get('/read', { summary: '读取全部系统维护项的当前状态' })
  async read() {
    return this.ok(await this.phoenixMaintenanceService.read());
  }

  @Post('/plan', { summary: '重新检测指定维护项并生成当前计划' })
  async plan(@Body('operationId') operationId: string) {
    return this.ok(await this.phoenixMaintenanceService.plan(operationId));
  }

  @Post('/apply', { summary: '按当前计划指纹等幂执行维护项' })
  async apply(
    @Body('operationId') operationId: string,
    @Body('expectedFingerprint') expectedFingerprint: string
  ) {
    return this.ok(
      await this.phoenixMaintenanceService.apply(
        operationId,
        expectedFingerprint
      )
    );
  }
}
