import * as orm from '@midwayjs/typeorm';
import {
  Configuration,
  CommonJSFileDetector,
  IMidwayApplication,
  Inject,
  ILogger,
  MainApp,
  MidwayWebRouterService,
} from '@midwayjs/core';
import * as koa from '@midwayjs/koa';
// import * as crossDomain from '@midwayjs/cross-domain';
import * as validate from '@midwayjs/validate';
import * as info from '@midwayjs/info';
import * as staticFile from '@midwayjs/static-file';
import * as cron from '@midwayjs/cron';
import * as DefaultConfig from './config/config.default';
import * as LocalConfig from './config/config.local';
import * as Midway4Config from './config/config.midway4';
import * as ProdConfig from './config/config.prod';
import * as cool from '@cool-midway/core';
import * as upload from '@midwayjs/upload';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import { PahPublicLoginBrandingService } from './modules/pah/service/public-login-branding';
import {
  inspectPhoenixPluginModules,
  PhoenixPluginStartupHealthService,
} from './modules/pah/service/startup-health';
import { safeStartupDiagnostic } from './modules/pah/service/safe-diagnostic';
// import * as task from '@cool-midway/task';
// import * as rpc from '@cool-midway/rpc';

const startupPluginInspection = inspectPhoenixPluginModules(process.cwd());
const runtimeEntityGenerator = path.join(
  process.cwd(),
  'scripts',
  'pah-sync-runtime-entities.cjs'
);
if (existsSync(runtimeEntityGenerator)) {
  execFileSync(
    process.execPath,
    [
      runtimeEntityGenerator,
      '--root',
      process.cwd(),
      ...startupPluginInspection.ignoredModuleIds.flatMap(moduleId => [
        '--ignore-module',
        moduleId,
      ]),
    ],
    { stdio: 'inherit' }
  );
}

@Configuration({
  detector: new CommonJSFileDetector({
    conflictCheck: true,
    ignore: startupPluginInspection.ignoredDetectorPatterns,
  }),
  imports: [
    // https://koajs.com/
    koa,
    // 是否开启跨域(注：顺序不能乱放！！！) http://www.midwayjs.org/docs/extensions/cross_domain
    // crossDomain,
    // 静态文件托管 https://midwayjs.org/docs/extensions/static_file
    staticFile,
    // orm https://midwayjs.org/docs/extensions/orm
    orm,
    // 参数验证 https://midwayjs.org/docs/extensions/validate
    validate,
    // 本地任务 http://www.midwayjs.org/docs/extensions/cron
    cron,
    // 文件上传
    upload,
    // cool-admin 官方组件 https://cool-js.com
    cool,
    // rpc 微服务 远程调用
    // rpc,
    // 任务与队列
    // task,
    {
      component: info,
      enabledEnvironment: ['local', 'midway4', 'prod'],
    },
  ],
  importConfigs: [
    {
      default: DefaultConfig,
      local: LocalConfig,
      midway4: Midway4Config,
      prod: ProdConfig,
    },
  ],
})
export class MainConfiguration {
  @MainApp()
  app: IMidwayApplication;

  @Inject()
  webRouterService: MidwayWebRouterService;

  @Inject()
  logger: ILogger;

  async onReady() {
    try {
      const pahPublicLoginBrandingService = await this.app
        .getApplicationContext()
        .getAsync(PahPublicLoginBrandingService);
      await pahPublicLoginBrandingService.reconcileOnStartup();
    } catch (error) {
      this.logger.error(
        `[public-login-branding] startup reconcile failed; endpoint will use Host default: ${safeStartupDiagnostic(
          error
        )}`
      );
    }
    try {
      const pluginHealthService = await this.app
        .getApplicationContext()
        .getAsync(PhoenixPluginStartupHealthService);
      await pluginHealthService.inspectOnStartup();
    } catch (error) {
      this.logger.error(
        `[phoenix-plugin-health] startup inspection failed; Host remains available: ${safeStartupDiagnostic(
          error
        )}`
      );
    }
  }
}
