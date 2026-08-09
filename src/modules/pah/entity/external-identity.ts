import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, transformerJson } from '../../base/entity/base';

@Entity('pah_external_identity')
@Index(['provider', 'providerSubject'], { unique: true })
export class PahExternalIdentityEntity extends BaseEntity {
  @Index()
  @Column({ length: 32, comment: '外部身份提供方' })
  provider: string;

  @Column({ length: 256, comment: '提供方内稳定身份主体' })
  providerSubject: string;

  @Index()
  @Column({ comment: '绑定的后台系统用户 ID' })
  userId: number;

  @Index()
  @Column({ length: 128, nullable: true, comment: '提供方租户标识' })
  tenantKey: string;

  @Column({ length: 128, nullable: true, comment: '提供方 open_id' })
  openId: string;

  @Column({ length: 128, nullable: true, comment: '提供方 union_id' })
  unionId: string;

  @Column({ length: 128, nullable: true, comment: '提供方 user_id' })
  providerUserId: string;

  @Column({ length: 256, nullable: true, comment: '提供方显示名称' })
  displayName: string;

  @Column({ type: 'text', nullable: true, comment: '提供方头像地址' })
  avatarUrl: string;

  @Column({ length: 320, nullable: true, comment: '提供方邮箱' })
  email: string;

  @Column({ type: 'jsonb', transformer: transformerJson, default: {} })
  metadata: Record<string, unknown>;

  @Index()
  @Column({ length: 16, default: 'active', comment: 'active/revoked' })
  status: 'active' | 'revoked';

  @Column({ nullable: true, comment: '执行绑定的后台用户 ID' })
  linkedByUserId: number;

  @Column({ length: 40, comment: '绑定时间（UTC ISO）' })
  linkedAt: string;

  @Column({ length: 40, nullable: true, comment: '最近登录时间（UTC ISO）' })
  lastLoginAt: string;

  @Column({ length: 40, nullable: true, comment: '最近同步时间（UTC ISO）' })
  lastSyncedAt: string;

  @Column({ length: 40, nullable: true, comment: '撤销时间（UTC ISO）' })
  revokedAt: string;

  @Column({ nullable: true, comment: '执行撤销的后台用户 ID' })
  revokedByUserId: number;
}
