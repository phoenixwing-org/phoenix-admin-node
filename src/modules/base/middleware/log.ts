import { Middleware } from '@midwayjs/core';
import * as _ from 'lodash';
import { NextFunction, Context } from '@midwayjs/koa';
import { IMiddleware } from '@midwayjs/core';
import { BaseSysLogService } from '../service/sys/log';

/**
 * 日志中间件
 */
@Middleware()
export class BaseLogMiddleware implements IMiddleware<Context, NextFunction> {
  resolve() {
    return async (ctx: Context, next: NextFunction) => {
      const baseSysLogService = await ctx.requestContext.getAsync(
        BaseSysLogService
      );
      baseSysLogService.record(
        ctx,
        ctx.url,
        sanitizeBaseLogParams(
          ctx.path,
          ctx.req.method === 'GET' ? ctx.request.query : ctx.request.body
        ),
        ctx.admin ? ctx.admin.userId : null
      );
      await next();
    };
  }
}

const AUTH_SENSITIVE_FIELDS: Record<string, ReadonlySet<string>> = {
  '/admin/base/open/login': new Set(['password', 'captchaId', 'verifyCode']),
  '/admin/base/open/refreshToken': new Set(['refreshToken']),
};

/** 保留认证动作审计，但禁止密码、验证码与刷新令牌落日志。 */
export function sanitizeBaseLogParams(path: string, params: unknown) {
  const fields = AUTH_SENSITIVE_FIELDS[path];
  if (!fields || !params || typeof params !== 'object') return params;
  return redactObject(params, fields);
}

function redactObject(value: unknown, fields: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) {
    return value.map(item => redactObject(item, fields));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      fields.has(key) ? '[REDACTED]' : redactObject(item, fields),
    ])
  );
}
