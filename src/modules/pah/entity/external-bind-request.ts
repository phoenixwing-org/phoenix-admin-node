import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, transformerJson } from '../../base/entity/base';

@Entity('pah_external_bind_request')
@Index(['provider', 'providerSubject'], { unique: true })
export class PahExternalBindRequestEntity extends BaseEntity {
  @Column({ length: 32, comment: '外部身份提供方' })
  provider: string;

  @Column({ length: 256, comment: '提供方内稳定身份主体' })
  providerSubject: string;

  @Index()
  @Column({ length: 128, nullable: true })
  tenantKey: string;

  @Column({ length: 128, nullable: true })
  openId: string;

  @Column({ length: 128, nullable: true })
  unionId: string;

  @Column({ length: 128, nullable: true })
  providerUserId: string;

  @Column({ length: 256, nullable: true })
  displayName: string;

  @Column({ type: 'text', nullable: true })
  avatarUrl: string;

  @Column({ length: 320, nullable: true })
  email: string;

  @Column({ type: 'jsonb', transformer: transformerJson, default: {} })
  metadata: Record<string, unknown>;

  @Index()
  @Column({ length: 16, default: 'pending' })
  status: 'pending' | 'bound' | 'rejected';

  @Column({ nullable: true, comment: '绑定后的后台用户 ID' })
  boundUserId: number;

  @Column({ nullable: true, comment: '处理人后台用户 ID' })
  handledByUserId: number;

  @Column({ length: 40, nullable: true })
  handledAt: string;

  @Column({ type: 'text', nullable: true })
  note: string;

  @Column({ length: 40, comment: '最近一次登录回调时间（UTC ISO）' })
  lastSeenAt: string;
}
