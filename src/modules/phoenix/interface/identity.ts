export type PahExternalIdentityProviderId = 'feishu';

export interface PahExternalIdentityProfile {
  provider: PahExternalIdentityProviderId;
  providerSubject: string;
  tenantKey: string;
  openId: string;
  unionId: string | null;
  providerUserId: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
  metadata: Record<string, unknown>;
}

export interface PahExternalIdentityProviderStatus {
  id: PahExternalIdentityProviderId;
  label: string;
  buttonText: string;
  enabled: boolean;
  ready: boolean;
  reason?: string;
}

export interface PahFeishuIdentityConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  redirectUri: string;
  allowedTenantKeys: string[];
  scopes: string[];
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
}

export interface PahIdentityConfig {
  frontendOrigin: string;
  stateTtlSeconds: number;
  ticketTtlSeconds: number;
  feishu: PahFeishuIdentityConfig;
}

export type PahIdentityFlowErrorCode =
  | 'provider_disabled'
  | 'provider_misconfigured'
  | 'provider_unavailable'
  | 'provider_response_error'
  | 'rate_limited'
  | 'identity_incomplete'
  | 'tenant_not_allowed'
  | 'invalid_return_to'
  | 'invalid_state'
  | 'expired_state'
  | 'oauth_denied'
  | 'invalid_ticket'
  | 'expired_ticket'
  | 'identity_pending'
  | 'identity_revoked';

export class PahIdentityFlowError extends Error {
  constructor(
    public readonly code: PahIdentityFlowErrorCode,
    message: string,
    public readonly returnTo = '/'
  ) {
    super(message);
    this.name = 'PahIdentityFlowError';
  }
}

export function normalizePahIdentityReturnTo(value?: string) {
  const returnTo = value?.trim() || '/';
  if (
    returnTo.length > 2048 ||
    !returnTo.startsWith('/') ||
    returnTo.startsWith('//') ||
    /[\u0000-\u001f\u007f\\]/.test(returnTo)
  ) {
    throw new PahIdentityFlowError('invalid_return_to', '登录返回地址不合法');
  }
  return returnTo;
}

export function pahIdentityCallbackUrl(
  frontendOrigin: string,
  params: Record<string, string>
) {
  let origin: URL;
  try {
    origin = new URL(frontendOrigin);
  } catch {
    throw new PahIdentityFlowError(
      'provider_misconfigured',
      '后台登录回调地址未正确配置'
    );
  }
  if (
    !validSecureOrLoopbackUrl(origin) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/'
  ) {
    throw new PahIdentityFlowError(
      'provider_misconfigured',
      '后台登录回调地址未正确配置'
    );
  }
  const callback = new URL('/oauth/callback', origin);
  Object.entries(params).forEach(([key, value]) =>
    callback.searchParams.set(key, value)
  );
  return callback.toString();
}

function validSecureOrLoopbackUrl(url: URL) {
  return (
    url.protocol === 'https:' ||
    (url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  );
}
