import { Config, Init, Provide, Scope, ScopeEnum } from '@midwayjs/core';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import {
  PahExternalIdentityProfile,
  PahExternalIdentityProviderStatus,
  PahFeishuIdentityConfig,
  PahIdentityFlowError,
} from '../interface/identity';

@Provide()
@Scope(ScopeEnum.Singleton)
export class PahFeishuIdentityProvider {
  @Config('module.pah.identity.feishu')
  config: PahFeishuIdentityConfig;

  client: AxiosInstance;

  @Init()
  init() {
    this.client = axios.create({ timeout: 10_000 });
  }

  status(): PahExternalIdentityProviderStatus {
    if (!this.config?.enabled) {
      return {
        id: 'feishu',
        label: '飞书',
        buttonText: '使用飞书登录',
        enabled: false,
        ready: false,
        reason: '飞书登录未启用',
      };
    }
    const ready = Boolean(
      this.config.appId?.trim() &&
        this.config.appSecret?.trim() &&
        validFeishuRedirectUri(this.config.redirectUri) &&
        validAbsoluteHttpUrl(this.config.authorizationUrl) &&
        validAbsoluteHttpUrl(this.config.tokenUrl) &&
        validAbsoluteHttpUrl(this.config.userInfoUrl) &&
        this.config.allowedTenantKeys?.length
    );
    return {
      id: 'feishu',
      label: '飞书',
      buttonText: '使用飞书登录',
      enabled: true,
      ready,
      ...(ready ? {} : { reason: '飞书登录配置不完整' }),
    };
  }

  assertReady() {
    const status = this.status();
    if (!status.enabled) {
      throw new PahIdentityFlowError('provider_disabled', '飞书登录未启用');
    }
    if (!status.ready) {
      throw new PahIdentityFlowError(
        'provider_misconfigured',
        '飞书登录配置不完整'
      );
    }
  }

  createAuthorizationUrl(state: string) {
    this.assertReady();
    const url = new URL(this.config.authorizationUrl);
    url.searchParams.set('client_id', this.config.appId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('state', state);
    if (this.config.scopes.length) {
      url.searchParams.set('scope', this.config.scopes.join(' '));
    }
    return url.toString();
  }

  async exchangeCode(code: string) {
    this.assertReady();
    let response: AxiosResponse;
    try {
      response = await this.client.post(
        this.config.tokenUrl,
        {
          grant_type: 'authorization_code',
          client_id: this.config.appId,
          client_secret: this.config.appSecret,
          code,
          redirect_uri: this.config.redirectUri,
        },
        { validateStatus: () => true }
      );
    } catch {
      throw new PahIdentityFlowError(
        'provider_unavailable',
        '飞书认证服务暂时不可用'
      );
    }
    const body = objectValue(response.data) || {};
    const payload = objectValue(body.data) || body;
    const accessToken = stringValue(payload.access_token);
    if (
      response.status < 200 ||
      response.status >= 300 ||
      codeValue(body) !== 0 ||
      !accessToken
    ) {
      throw new PahIdentityFlowError(
        'provider_response_error',
        '飞书授权码校验失败，请重新发起登录'
      );
    }
    return accessToken;
  }

  async getIdentity(accessToken: string): Promise<PahExternalIdentityProfile> {
    let response: AxiosResponse;
    try {
      response = await this.client.get(this.config.userInfoUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        validateStatus: () => true,
      });
    } catch {
      throw new PahIdentityFlowError(
        'provider_unavailable',
        '飞书用户信息服务暂时不可用'
      );
    }
    const body = objectValue(response.data) || {};
    const data = objectValue(body.data) || body;
    if (
      response.status < 200 ||
      response.status >= 300 ||
      codeValue(body) !== 0
    ) {
      throw new PahIdentityFlowError(
        'provider_response_error',
        '无法读取飞书登录用户信息'
      );
    }
    const tenantKey = stringValue(data.tenant_key);
    const openId = stringValue(data.open_id);
    if (!tenantKey || !openId) {
      throw new PahIdentityFlowError(
        'identity_incomplete',
        '飞书返回的用户身份不完整'
      );
    }
    if (!this.config.allowedTenantKeys.includes(tenantKey)) {
      throw new PahIdentityFlowError(
        'tenant_not_allowed',
        '当前飞书组织未获准登录本系统'
      );
    }
    return {
      provider: 'feishu',
      providerSubject: `${tenantKey}:${openId}`,
      tenantKey,
      openId,
      unionId: stringValue(data.union_id),
      providerUserId: stringValue(data.user_id),
      displayName: stringValue(data.name),
      avatarUrl:
        stringValue(data.avatar_url) ||
        stringValue(data.avatar_big) ||
        stringValue(data.avatar_middle),
      email: stringValue(data.enterprise_email) || stringValue(data.email),
      metadata: { employeeNo: stringValue(data.employee_no) },
    };
  }
}

function validAbsoluteHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}

function validFeishuRedirectUri(value: string) {
  if (!validAbsoluteHttpUrl(value)) return false;
  const url = new URL(value);
  return (
    url.pathname === '/admin/base/open/oauth/feishu/callback' && !url.search
  );
}

function objectValue(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function codeValue(value: Record<string, any>) {
  return value.code === undefined ? 0 : Number(value.code);
}
