import { Body, Get, Inject, Post, Provide } from '@midwayjs/core';
import { BaseController, CoolController } from '@cool-midway/core';
import { PahNavigationGroupEntity } from '../../entity/navigation-group';
import { PahNavigationService } from '../../service/navigation';

/** Phoenix 工作台大分组的读取与维护。 */
@Provide()
@CoolController({
  api: ['info', 'list', 'page'],
  entity: PahNavigationGroupEntity,
  service: PahNavigationService,
})
export class PahNavigationController extends BaseController {
  @Inject()
  pahNavigationService: PahNavigationService;

  @Get('/read', { summary: '读取工作台大分组及模块归属' })
  async read() {
    return this.ok(await this.pahNavigationService.read());
  }

  @Post('/save-group', { summary: '新建或更新工作台大分组' })
  async saveGroup(@Body() input: any) {
    return this.ok(await this.pahNavigationService.saveGroup(input));
  }

  @Post('/remove-group', { summary: '删除自定义工作台大分组' })
  async removeGroup(@Body('id') id: number) {
    return this.ok(await this.pahNavigationService.removeGroup(Number(id)));
  }

  @Post('/assign', { summary: '配置模块所属工作台大分组' })
  async assign(
    @Body('targetKey') targetKey: string,
    @Body('groupId') groupId: number
  ) {
    return this.ok(
      await this.pahNavigationService.assign(targetKey, Number(groupId))
    );
  }
}
