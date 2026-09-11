import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity, transformerJson } from '../../base/entity/base';

export type PahFileAuditResult = 'success' | 'denied' | 'failed';

@Entity('pah_file_audit_record')
@Unique('UQ_pah_file_audit_record_audit_id', ['auditId'])
@Index('IDX_pah_file_audit_record_owner_created', [
  'ownerModuleId',
  'createTime',
])
@Index('IDX_pah_file_audit_record_correlation', ['correlationId'])
export class PahFileAuditRecordEntity extends BaseEntity {
  @Column({ type: 'uuid', comment: '稳定审计 ID' })
  auditId: string;

  @Column({ length: 128, comment: '目标插件 moduleId' })
  ownerModuleId: string;

  @Column({ length: 64, comment: '固定 Files 动作' })
  action: string;

  @Column({ length: 16, comment: 'success/denied/failed' })
  result: PahFileAuditResult;

  @Column({ type: 'uuid', nullable: true, comment: '关联文件 ID' })
  fileId: string | null;

  @Column({ type: 'uuid', nullable: true, comment: '关联绑定 ID' })
  bindingId: string | null;

  @Column({ type: 'integer', comment: 'Host actor ID' })
  actorId: number;

  @Column({ length: 128, comment: '请求关联 ID' })
  correlationId: string;

  @Column({
    type: 'jsonb',
    default: {},
    transformer: transformerJson,
    comment: '不含内容、凭据与存储路径的有限审计详情',
  })
  detail: Record<string, string | number | boolean | null>;
}
