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

  @Get('/migration-plan', { summary: '只读校验迁移制品与待执行计划' })
  async migrationPlan(@Query('moduleId') moduleId: string) {
    return this.ok(await this.pahPluginService.migrationPlan(moduleId));
  }

  @Get('/dictionary-plan', {
    summary: '只读检查插件字典 catalog 与 Cool 当前数据差异',
  })
  async dictionaryPlan(@Query('moduleId') moduleId: string) {
    return this.ok(await this.pahPluginService.dictionaryPlan(moduleId));
  }

  @Get('/dictionary-records', {
    summary: '查询插件字典 reconcile 审计台账',
  })
  async dictionaryRecords(
    @Query('moduleId') moduleId: string,
    @Query('page') page: unknown,
    @Query('size') size: unknown
  ) {
    return this.ok(
      await this.pahPluginService.dictionaryRecords(moduleId, page, size)
    );
  }

  @Post('/dictionary-reconcile', {
    summary: '按已确认计划补全已启用插件的产品字典',
  })
  async dictionaryReconcile(
    @Body('moduleId') moduleId: string,
    @Body('dictionaryFingerprint') dictionaryFingerprint: string,
    @Body('dictionaryConfirmed') dictionaryConfirmed: boolean
  ) {
    return this.ok(
      await this.pahPluginService.dictionaryReconcile(
        moduleId,
        dictionaryFingerprint,
        dictionaryConfirmed
      )
    );
  }

  @Post('/enable', { summary: '启用插件贡献' })
  async enable(
    @Body('moduleId') moduleId: string,
    @Body('dictionaryFingerprint') dictionaryFingerprint?: string,
    @Body('dictionaryConfirmed') dictionaryConfirmed?: boolean
  ) {
    return this.ok(
      await this.pahPluginService.enable(
        moduleId,
        dictionaryFingerprint,
        dictionaryConfirmed
      )
    );
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
