import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../base/entity/base';

@Entity('pah_oauth_login_attempt')
export class PahOauthLoginAttemptEntity extends BaseEntity {
  @Column({ length: 32 })
  provider: string;

  @Index({ unique: true })
  @Column({ length: 64, comment: 'OAuth state SHA-256' })
  stateHash: string;

  @Column({ type: 'text', comment: '登录完成后的站内返回路径' })
  returnTo: string;

  @Index()
  @Column({ length: 40, comment: '过期时间（UTC ISO）' })
  expiresAt: string;

  @Column({ length: 40, nullable: true, comment: '单次消费时间（UTC ISO）' })
  usedAt: string;

  @Column({ length: 64, nullable: true, comment: '固定失败码' })
  failureCode: string;
}
