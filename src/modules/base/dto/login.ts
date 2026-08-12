import { Rule, RuleType } from '@midwayjs/validate';
/**
 * 登录参数校验
 */
export class LoginDTO {
  // 用户名
  @Rule(RuleType.string().required())
  username: string;

  // 密码
  @Rule(RuleType.string().required())
  password: string;

  // 验证码ID
  @Rule(RuleType.string().allow('').optional())
  captchaId?: string;

  // 验证码
  @Rule(
    RuleType.alternatives().try(RuleType.string(), RuleType.number()).optional()
  )
  verifyCode?: string | number;
}
