import {
  ALL,
  Body,
  Fields,
  Files,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Provide,
  Query,
} from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { BaseController, CoolController } from '@cool-midway/core';
import { PahFilesService } from '../../service/files';

@Provide()
@CoolController({ prefix: '/admin/phoenix/files' })
export class PahFilesController extends BaseController {
  @Inject()
  ctx: Context;

  @Inject()
  pahFilesService: PahFilesService;

  @Post('/:ownerModuleId', { summary: '上传 Host-owned 文件' })
  async upload(
    @Param('ownerModuleId') ownerModuleId: string,
    @Files() files,
    @Fields() _fields
  ) {
    return this.ok(
      await this.pahFilesService.upload(ownerModuleId, files?.[0])
    );
  }

  @Get('/:ownerModuleId', { summary: '列出插件所属 Host 文件' })
  async listFiles(
    @Param('ownerModuleId') ownerModuleId: string,
    @Query('status') status: unknown,
    @Query('page') page: unknown,
    @Query('size') size: unknown
  ) {
    return this.ok(
      await this.pahFilesService.listFiles(ownerModuleId, {
        status,
        page,
        size,
      })
    );
  }

  @Get('/:ownerModuleId/bindings', { summary: '列出通用文件绑定' })
  async bindings(
    @Param('ownerModuleId') ownerModuleId: string,
    @Query('resourceType') resourceType: unknown,
    @Query('resourceKey') resourceKey: unknown,
    @Query('status') status: unknown
  ) {
    return this.ok(
      await this.pahFilesService.listBindings(ownerModuleId, {
        resourceType,
        resourceKey,
        status,
      })
    );
  }

  @Post('/:ownerModuleId/bindings', { summary: '创建幂等通用文件绑定' })
  async bind(
    @Param('ownerModuleId') ownerModuleId: string,
    @Body(ALL) input: unknown
  ) {
    return this.ok(
      await this.pahFilesService.createBinding(ownerModuleId, input)
    );
  }

  @Patch('/:ownerModuleId/bindings/:bindingId', {
    summary: '更新通用文件绑定元数据',
  })
  async updateBinding(
    @Param('ownerModuleId') ownerModuleId: string,
    @Param('bindingId') bindingId: string,
    @Body(ALL) input: unknown
  ) {
    return this.ok(
      await this.pahFilesService.updateBinding(ownerModuleId, bindingId, input)
    );
  }

  @Post('/:ownerModuleId/bindings/:bindingId/unbind', {
    summary: '解绑业务资源与 Host 文件',
  })
  async unbind(
    @Param('ownerModuleId') ownerModuleId: string,
    @Param('bindingId') bindingId: string
  ) {
    return this.ok(await this.pahFilesService.unbind(ownerModuleId, bindingId));
  }

  @Post('/:ownerModuleId/bindings/:bindingId/restore', {
    summary: '恢复业务资源与 Host 文件绑定',
  })
  async restoreBinding(
    @Param('ownerModuleId') ownerModuleId: string,
    @Param('bindingId') bindingId: string
  ) {
    return this.ok(
      await this.pahFilesService.restoreBinding(ownerModuleId, bindingId)
    );
  }

  @Get('/:ownerModuleId/:fileId/content', {
    summary: '认证预览或下载 Host 文件内容',
  })
  async content(
    @Param('ownerModuleId') ownerModuleId: string,
    @Param('fileId') fileId: string,
    @Query('disposition') disposition: unknown
  ) {
    const result = await this.pahFilesService.content(
      ownerModuleId,
      fileId,
      disposition
    );
    const encodedName = encodeURIComponent(result.descriptor.originalName);
    this.ctx.set('Content-Type', result.descriptor.mime);
    this.ctx.set('Content-Length', String(result.descriptor.size));
    this.ctx.set(
      'Content-Disposition',
      `${result.disposition}; filename="download"; filename*=UTF-8''${encodedName}`
    );
    this.ctx.set('Cache-Control', 'private, no-store, max-age=0');
    this.ctx.set('Pragma', 'no-cache');
    this.ctx.set('X-Content-Type-Options', 'nosniff');
    this.ctx.set('X-Pah-Correlation-Id', result.correlationId);
    this.ctx.body = result.stream;
  }

  @Get('/:ownerModuleId/:fileId', { summary: '读取 Host 文件描述符' })
  async fileInfo(
    @Param('ownerModuleId') ownerModuleId: string,
    @Param('fileId') fileId: string
  ) {
    return this.ok(await this.pahFilesService.fileInfo(ownerModuleId, fileId));
  }

  @Patch('/:ownerModuleId/:fileId', { summary: '更新 Host 文件显示元数据' })
  async updateFile(
    @Param('ownerModuleId') ownerModuleId: string,
    @Param('fileId') fileId: string,
    @Body(ALL) input: unknown
  ) {
    return this.ok(
      await this.pahFilesService.updateFile(ownerModuleId, fileId, input)
    );
  }

  @Post('/:ownerModuleId/:fileId/delete', { summary: '软删除 Host 文件' })
  async deleteFile(
    @Param('ownerModuleId') ownerModuleId: string,
    @Param('fileId') fileId: string
  ) {
    return this.ok(
      await this.pahFilesService.deleteFile(ownerModuleId, fileId)
    );
  }

  @Post('/:ownerModuleId/:fileId/restore', { summary: '恢复 Host 文件' })
  async restore(
    @Param('ownerModuleId') ownerModuleId: string,
    @Param('fileId') fileId: string
  ) {
    return this.ok(
      await this.pahFilesService.restoreFile(ownerModuleId, fileId)
    );
  }
}
