import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../base/entity/base';

@Entity('pah_oauth_login_ticket')
export class PahOauthLoginTicketEntity extends BaseEntity {
  @Index({ unique: true })
  @Column({ length: 64, comment: '一次性登录票据 SHA-256' })
  ticketHash: string;

  @Column({ comment: '后台系统用户 ID' })
  userId: number;

  @Column({ comment: '外部身份 ID' })
  identityId: number;

  @Column({ length: 32 })
  provider: string;

  @Column({ type: 'text' })
  returnTo: string;

  @Index()
  @Column({ length: 40, comment: '过期时间（UTC ISO）' })
  expiresAt: string;

  @Column({ length: 40, nullable: true, comment: '单次消费时间（UTC ISO）' })
  usedAt: string;
}
