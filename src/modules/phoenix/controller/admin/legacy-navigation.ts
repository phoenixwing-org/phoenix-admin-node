import { Body, Get, Inject, Post, Provide } from '@midwayjs/core';
import { BaseController, CoolController } from '@cool-midway/core';
import { PahNavigationGroupEntity } from '../../entity/navigation-group';
import { PahNavigationService } from '../../service/navigation';

/**
 * 旧 Host 导航 API 的只读兼容入口。
 *
 * 新调用方必须使用 /admin/phoenix/navigation；保留该入口仅用于已发布的
 * Host 页面和管理员工具，避免物理目录迁移破坏既有深链。
 */
@Provide()
@CoolController({
  prefix: '/admin/pah/navigation',
  api: ['info', 'list', 'page'],
  entity: PahNavigationGroupEntity,
  service: PahNavigationService,
})
export class LegacyPahNavigationController extends BaseController {
  @Inject()
  pahNavigationService: PahNavigationService;

  @Get('/read')
  async read() {
    return this.ok(await this.pahNavigationService.read());
  }

  @Post('/save-group')
  async saveGroup(@Body() input: any) {
    return this.ok(await this.pahNavigationService.saveGroup(input));
  }

  @Post('/remove-group')
  async removeGroup(@Body('id') id: number) {
    return this.ok(await this.pahNavigationService.removeGroup(Number(id)));
  }

  @Post('/assign')
  async assign(
    @Body('targetKey') targetKey: string,
    @Body('groupId') groupId: number
  ) {
    return this.ok(
      await this.pahNavigationService.assign(targetKey, Number(groupId))
    );
  }
}
