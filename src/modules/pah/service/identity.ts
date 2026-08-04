import { CoolCommException } from '@cool-midway/core';
import { Config, Inject, Provide, Scope, ScopeEnum } from '@midwayjs/core';
import { InjectDataSource, InjectEntityModel } from '@midwayjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { BaseSysLoginService } from '../../base/service/sys/login';
import { PahExternalBindRequestEntity } from '../entity/external-bind-request';
import { PahExternalIdentityEntity } from '../entity/external-identity';
import { PahOauthLoginAttemptEntity } from '../entity/oauth-login-attempt';
import { PahOauthLoginTicketEntity } from '../entity/oauth-login-ticket';
import {
  normalizePahIdentityReturnTo,
  pahIdentityCallbackUrl,
  PahExternalIdentityProfile,
  PahIdentityConfig,
  PahIdentityFlowError,
} from '../interface/identity';
import { PahFeishuIdentityProvider } from '../provider/feishu';

interface PahFeishuCallbackInput {
  state?: string;
  code?: string;
  error?: string;
}

export type PahIdentityCallbackResult =
  | {
      provider: 'feishu';
      status: 'authenticated';
      ticket: string;
      returnTo: string;
    }
  | {
      provider: 'feishu';
      status: 'pending';
      requestId: number;
      returnTo: string;
    };

@Provide()
@Scope(ScopeEnum.Singleton)
export class PahIdentityRateLimiter {
  private readonly windows = new Map<
    string,
    { expiresAt: number; count: number }
  >();

  assert(kind: string, clientKey: string, max: number, windowMs: number) {
    const now = Date.now();
    this.sweepExpired(now);
    const key = `${kind}:${clientKey || 'unknown'}`;
    const current = this.windows.get(key);
    if (!current || current.expiresAt <= now) {
      this.windows.set(key, { expiresAt: now + windowMs, count: 1 });
      return;
    }
    current.count += 1;
    if (current.count > max) {
      throw new PahIdentityFlowError(
        'rate_limited',
        '飞书登录请求过于频繁，请稍后重试'
      );
    }
  }

  private sweepExpired(now: number) {
    if (this.windows.size < 1000) return;
    for (const [key, window] of this.windows) {
      if (window.expiresAt <= now) this.windows.delete(key);
    }
    if (this.windows.size >= 10_000) {
      const oldest = this.windows.keys().next();
      if (!oldest.done) this.windows.delete(oldest.value);
    }
  }
}

@Provide()
export class PahIdentityService {
  @Config('module.pah.identity')
  config: PahIdentityConfig;

  @InjectEntityModel(PahExternalIdentityEntity)
  externalIdentityEntity: Repository<PahExternalIdentityEntity>;

  @InjectEntityModel(PahExternalBindRequestEntity)
  bindRequestEntity: Repository<PahExternalBindRequestEntity>;

  @InjectEntityModel(PahOauthLoginAttemptEntity)
  oauthAttemptEntity: Repository<PahOauthLoginAttemptEntity>;

  @InjectEntityModel(PahOauthLoginTicketEntity)
  oauthTicketEntity: Repository<PahOauthLoginTicketEntity>;

  @InjectDataSource()
  dataSource: DataSource;

  @Inject()
  feishuProvider: PahFeishuIdentityProvider;

  @Inject()
  baseSysLoginService: BaseSysLoginService;

  @Inject()
  rateLimiter: PahIdentityRateLimiter;

  loginPolicy() {
    const feishu = { ...this.feishuProvider.status() };
    if (feishu.ready) {
      try {
        pahIdentityCallbackUrl(this.config.frontendOrigin, {
          provider: 'feishu',
        });
      } catch (error) {
        feishu.ready = false;
        feishu.reason = (error as Error).message;
      }
    }
    return {
      formatVersion: 1,
      scope: 'admin-console',
      enabledMethods: ['password', ...(feishu.ready ? ['feishu'] : [])],
      defaultMethod: 'password',
      methods: [
        {
          id: 'password',
          label: '账号密码',
          enabled: true,
          ready: true,
        },
        feishu,
      ],
    };
  }

  async startFeishuLogin(returnTo?: string, clientKey = 'unknown') {
    this.rateLimiter.assert('start', clientKey, 30, 5 * 60 * 1000);
    this.feishuProvider.assertReady();
    pahIdentityCallbackUrl(this.config.frontendOrigin, {
      provider: 'feishu',
    });
    const normalizedReturnTo = normalizePahIdentityReturnTo(returnTo);
    const state = randomSecret();
    const expiresAt = isoAfter(this.config.stateTtlSeconds);
    await this.oauthAttemptEntity.save(
      this.oauthAttemptEntity.create({
        provider: 'feishu',
        stateHash: sha256(state),
        returnTo: normalizedReturnTo,
        expiresAt,
        usedAt: null,
        failureCode: null,
      })
    );
    return {
      provider: 'feishu' as const,
      authorizationUrl: this.feishuProvider.createAuthorizationUrl(state),
      expiresAt,
    };
  }

  async completeFeishuCallback(
    input: PahFeishuCallbackInput,
    clientKey = 'unknown'
  ): Promise<PahIdentityCallbackResult> {
    this.rateLimiter.assert('callback', clientKey, 60, 5 * 60 * 1000);
    if (!input.state?.trim()) {
      throw new PahIdentityFlowError('invalid_state', '缺少飞书 OAuth state');
    }
    const attempt = await this.consumeAttempt(input.state);
    if (input.error) {
      await this.markAttemptFailure(attempt.id, 'oauth_denied');
      throw new PahIdentityFlowError(
        'oauth_denied',
        '飞书授权未完成',
        attempt.returnTo
      );
    }
    if (!input.code?.trim()) {
      await this.markAttemptFailure(attempt.id, 'provider_response_error');
      throw new PahIdentityFlowError(
        'provider_response_error',
        '飞书回调缺少授权码',
        attempt.returnTo
      );
    }

    try {
      const accessToken = await this.feishuProvider.exchangeCode(input.code);
      const profile = await this.feishuProvider.getIdentity(accessToken);
      const identity = await this.externalIdentityEntity.findOneBy({
        provider: profile.provider,
        providerSubject: profile.providerSubject,
      });
      if (identity?.status === 'active') {
        await this.baseSysLoginService.assertUserCanLogin(identity.userId);
        assignIdentityProfile(identity, profile);
        identity.lastSyncedAt = nowIso();
        await this.externalIdentityEntity.save(identity);
        const ticket = await this.createLoginTicket(identity, attempt.returnTo);
        return {
          provider: 'feishu',
          status: 'authenticated',
          ticket,
          returnTo: attempt.returnTo,
        };
      }
      const request = await this.upsertBindRequest(profile);
      return {
        provider: 'feishu',
        status: 'pending',
        requestId: request.id,
        returnTo: attempt.returnTo,
      };
    } catch (error) {
      const flowError = asFlowError(error, attempt.returnTo);
      await this.markAttemptFailure(attempt.id, flowError.code);
      throw flowError;
    }
  }

  async exchangeTicket(ticket: string, clientKey = 'unknown') {
    this.rateLimiter.assert('ticket', clientKey, 30, 5 * 60 * 1000);
    if (!ticket?.trim()) {
      throw new PahIdentityFlowError('invalid_ticket', '缺少一次性登录票据');
    }
    const record = await this.consumeTicket(ticket);
    const session = await this.baseSysLoginService.loginByUserId(record.userId);
    await this.externalIdentityEntity.update(record.identityId, {
      lastLoginAt: nowIso(),
    });
    return { ...session, returnTo: record.returnTo };
  }

  async listBindRequests(status?: string) {
    if (status && !['pending', 'bound', 'rejected'].includes(status)) {
      throw new CoolCommException('待审查状态不合法');
    }
    return this.bindRequestEntity.find({
      ...(status ? { where: { status: status as any } } : {}),
      order: { id: 'DESC' },
    });
  }

  async bindRequest(requestId: number, userId: number, actorId: number) {
    if (!Number.isInteger(requestId) || !Number.isInteger(userId)) {
      throw new CoolCommException('待审查记录或目标用户不合法');
    }
    await this.baseSysLoginService.assertUserCanLogin(userId);
    return this.dataSource.transaction(async manager => {
      const requestRepo = manager.getRepository(PahExternalBindRequestEntity);
      const identityRepo = manager.getRepository(PahExternalIdentityEntity);
      const request = await requestRepo
        .createQueryBuilder('request')
        .setLock('pessimistic_write')
        .where('request.id = :requestId', { requestId })
        .getOne();
      if (!request || request.status !== 'pending') {
        throw new CoolCommException('待审查记录不存在或已处理');
      }
      let identity = await identityRepo
        .createQueryBuilder('identity')
        .setLock('pessimistic_write')
        .where('identity.provider = :provider', { provider: request.provider })
        .andWhere('identity.providerSubject = :providerSubject', {
          providerSubject: request.providerSubject,
        })
        .getOne();
      if (identity?.status === 'active' && identity.userId !== userId) {
        throw new CoolCommException('该外部身份已绑定其他后台用户');
      }
      const timestamp = nowIso();
      identity = identity || identityRepo.create();
      Object.assign(identity, profileFromRequest(request), {
        userId,
        status: 'active',
        linkedByUserId: actorId,
        linkedAt: timestamp,
        lastSyncedAt: timestamp,
        revokedAt: null,
        revokedByUserId: null,
      });
      identity = await identityRepo.save(identity);
      request.status = 'bound';
      request.boundUserId = userId;
      request.handledByUserId = actorId;
      request.handledAt = timestamp;
      await requestRepo.save(request);
      return { request, identity };
    });
  }

  async rejectRequest(requestId: number, actorId: number, note?: string) {
    if (!Number.isInteger(requestId)) {
      throw new CoolCommException('待审查记录不合法');
    }
    return this.dataSource.transaction(async manager => {
      const repo = manager.getRepository(PahExternalBindRequestEntity);
      const request = await repo
        .createQueryBuilder('request')
        .setLock('pessimistic_write')
        .where('request.id = :requestId', { requestId })
        .getOne();
      if (!request || request.status !== 'pending') {
        throw new CoolCommException('待审查记录不存在或已处理');
      }
      request.status = 'rejected';
      request.handledByUserId = actorId;
      request.handledAt = nowIso();
      request.note = note?.trim().slice(0, 2000) || null;
      return repo.save(request);
    });
  }

  async listExternalIdentities(userId?: number) {
    return this.externalIdentityEntity.find({
      ...(Number.isInteger(userId) ? { where: { userId } } : {}),
      order: { id: 'DESC' },
    });
  }

  async unlinkIdentity(identityId: number, actorId: number) {
    if (!Number.isInteger(identityId)) {
      throw new CoolCommException('外部身份不合法');
    }
    return this.dataSource.transaction(async manager => {
      const repo = manager.getRepository(PahExternalIdentityEntity);
      const identity = await repo
        .createQueryBuilder('identity')
        .setLock('pessimistic_write')
        .where('identity.id = :identityId', { identityId })
        .getOne();
      if (!identity || identity.status !== 'active') {
        throw new CoolCommException('外部身份不存在或已解除绑定');
      }
      identity.status = 'revoked';
      identity.revokedAt = nowIso();
      identity.revokedByUserId = actorId;
      return repo.save(identity);
    });
  }

  private async consumeAttempt(state: string) {
    return this.dataSource.transaction(async manager => {
      const repo = manager.getRepository(PahOauthLoginAttemptEntity);
      const attempt = await repo
        .createQueryBuilder('attempt')
        .setLock('pessimistic_write')
        .where('attempt.provider = :provider', { provider: 'feishu' })
        .andWhere('attempt.stateHash = :stateHash', {
          stateHash: sha256(state),
        })
        .getOne();
      if (!attempt || attempt.usedAt) {
        throw new PahIdentityFlowError(
          'invalid_state',
          '飞书 OAuth state 无效或已使用'
        );
      }
      if (Date.parse(attempt.expiresAt) <= Date.now()) {
        throw new PahIdentityFlowError(
          'expired_state',
          '飞书 OAuth state 已过期',
          attempt.returnTo
        );
      }
      attempt.usedAt = nowIso();
      return repo.save(attempt);
    });
  }

  private async consumeTicket(ticket: string) {
    return this.dataSource.transaction(async manager => {
      const repo = manager.getRepository(PahOauthLoginTicketEntity);
      const record = await repo
        .createQueryBuilder('ticket')
        .setLock('pessimistic_write')
        .where('ticket.ticketHash = :ticketHash', {
          ticketHash: sha256(ticket),
        })
        .getOne();
      if (!record || record.usedAt) {
        throw new PahIdentityFlowError(
          'invalid_ticket',
          '一次性登录票据无效或已使用'
        );
      }
      if (Date.parse(record.expiresAt) <= Date.now()) {
        throw new PahIdentityFlowError(
          'expired_ticket',
          '一次性登录票据已过期',
          record.returnTo
        );
      }
      record.usedAt = nowIso();
      return repo.save(record);
    });
  }

  private async createLoginTicket(
    identity: PahExternalIdentityEntity,
    returnTo: string
  ) {
    const ticket = randomSecret();
    await this.oauthTicketEntity.save(
      this.oauthTicketEntity.create({
        ticketHash: sha256(ticket),
        userId: identity.userId,
        identityId: identity.id,
        provider: identity.provider,
        returnTo,
        expiresAt: isoAfter(this.config.ticketTtlSeconds),
        usedAt: null,
      })
    );
    return ticket;
  }

  private async upsertBindRequest(profile: PahExternalIdentityProfile) {
    let request = await this.bindRequestEntity.findOneBy({
      provider: profile.provider,
      providerSubject: profile.providerSubject,
    });
    request = request || this.bindRequestEntity.create();
    Object.assign(request, profile, {
      status: 'pending',
      boundUserId: null,
      handledByUserId: null,
      handledAt: null,
      note: null,
      lastSeenAt: nowIso(),
    });
    return this.bindRequestEntity.save(request);
  }

  private async markAttemptFailure(id: number, failureCode: string) {
    await this.oauthAttemptEntity.update(id, { failureCode });
  }
}

function assignIdentityProfile(
  identity: PahExternalIdentityEntity,
  profile: PahExternalIdentityProfile
) {
  identity.tenantKey = profile.tenantKey;
  identity.openId = profile.openId;
  identity.unionId = profile.unionId;
  identity.providerUserId = profile.providerUserId;
  identity.displayName = profile.displayName;
  identity.avatarUrl = profile.avatarUrl;
  identity.email = profile.email;
  identity.metadata = profile.metadata;
}

function profileFromRequest(request: PahExternalBindRequestEntity) {
  return {
    provider: request.provider,
    providerSubject: request.providerSubject,
    tenantKey: request.tenantKey,
    openId: request.openId,
    unionId: request.unionId,
    providerUserId: request.providerUserId,
    displayName: request.displayName,
    avatarUrl: request.avatarUrl,
    email: request.email,
    metadata: request.metadata,
  };
}

function asFlowError(error: unknown, returnTo: string) {
  if (error instanceof PahIdentityFlowError) {
    return new PahIdentityFlowError(error.code, error.message, returnTo);
  }
  if (error instanceof CoolCommException) {
    return new PahIdentityFlowError(
      'identity_revoked',
      error.message,
      returnTo
    );
  }
  return new PahIdentityFlowError(
    'provider_response_error',
    '飞书登录未完成，请重新尝试',
    returnTo
  );
}

function randomSecret() {
  return randomBytes(32).toString('base64url');
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function isoAfter(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
