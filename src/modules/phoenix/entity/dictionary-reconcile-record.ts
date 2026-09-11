import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, transformerJson } from '../../base/entity/base';

/** Host-owned ledger for plugin dictionary lifecycle reconciliation. */
@Entity('pah_dictionary_reconcile_record')
export class PahDictionaryReconcileRecordEntity extends BaseEntity {
  @Index()
  @Column({ comment: '稳定插件模块 ID' })
  moduleId: string;

  @Column({ comment: '插件版本' })
  pluginVersion: string;

  @Index()
  @Column({ comment: '产品字典 catalog SHA-256' })
  catalogHash: string;

  @Column({ comment: '执行 Host 用户 ID' })
  actorId: string;

  @Column({ comment: '执行状态' })
  status: 'running' | 'succeeded' | 'failed';

  @Column({
    type: 'jsonb',
    transformer: transformerJson,
    comment: 'dry-run 与结果快照',
  })
  detail: Record<string, unknown>;

  @Column({ type: 'text', nullable: true, comment: '失败原因' })
  error: string;
}
