import { CoolEvent, Event } from '@cool-midway/core';
import { CachingFactory, MidwayCache } from '@midwayjs/cache-manager';
import {
  MainApp,
  Config,
  ILogger,
  Inject,
  InjectClient,
  Logger,
} from '@midwayjs/core';
import { IMidwayKoaApplication } from '@midwayjs/koa';
import { PLUGIN_CACHE_KEY, PluginCenterService } from '../service/center';

/**
 * 插件事件
 */
@CoolEvent()
export class PluginAppEvent {
  @Logger()
  coreLogger: ILogger;

  @Config('module')
  config;

  @MainApp()
  app: IMidwayKoaApplication;

  @InjectClient(CachingFactory, 'default')
  midwayCache: MidwayCache;

  @Inject()
  pluginCenterService: PluginCenterService;

  @Event('onServerReady')
  async onServerReady() {
    await this.midwayCache.set(PLUGIN_CACHE_KEY, []);
    await this.pluginCenterService.init();
  }
}
