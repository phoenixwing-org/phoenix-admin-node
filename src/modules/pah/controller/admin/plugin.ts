import { Body, Get, Inject, Post, Provide, Query } from '@midwayjs/core';
import { BaseController, CoolController } from '@cool-midway/core';
import { PahPluginInstallationEntity } from '../../entity/plugin';
import { PahPluginManifest } from '../../interface/plugin';
import { PahPluginService } from '../../service/plugin';

/** Phoenix 业务插件管理。 */
@Provide()
@CoolController({
  api: ['info', 'list', 'page'],
  entity: PahPluginInstallationEntity,
  service: PahPluginService,
  pageQueryOp: {
    fieldEq: ['moduleId', 'state'],
    addOrderBy: { id: 'DESC' },
  },
})
export class PahPluginController extends BaseController {
  @Inject()
  pahPluginService: PahPluginService;

  @Post('/register', { summary: '登记并验证插件 manifest' })
  async register(@Body('manifest') manifest: PahPluginManifest) {
    return this.ok(await this.pahPluginService.register(manifest));
  }

  @Post('/install', { summary: '暂存、迁移并安装插件' })
  async install(@Body('moduleId') moduleId: string) {
    return this.ok(await this.pahPluginService.install(moduleId));
  }

  @Post('/enable', { summary: '启用插件贡献' })
  async enable(@Body('moduleId') moduleId: string) {
    return this.ok(await this.pahPluginService.enable(moduleId));
  }

  @Post('/disable', { summary: '停用插件贡献' })
  async disable(@Body('moduleId') moduleId: string) {
    return this.ok(await this.pahPluginService.disable(moduleId));
  }

  @Post('/uninstall', { summary: '卸载插件并默认保留业务数据' })
  async uninstall(
    @Body('moduleId') moduleId: string,
    @Body('backupId') backupId: string
  ) {
    return this.ok(await this.pahPluginService.uninstall(moduleId, backupId));
  }

  @Get('/enabled', { summary: '查询已启用插件贡献' })
  async enabled() {
    return this.ok(await this.pahPluginService.enabled());
  }

  @Get('/migration-records', { summary: '查询插件历史迁移台账' })
  async migrationRecords(@Query('moduleId') moduleId: string) {
    return this.ok(await this.pahPluginService.migrationRecords(moduleId));
  }
}
