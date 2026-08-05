import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../base/entity/base';

/** 插件声明迁移的实际执行台账；每个导入批次独立可回滚。 */
@Entity('pah_plugin_migration_record')
@Index(['moduleId', 'migrationId', 'importBatchId'], { unique: true })
export class PahPluginMigrationRecordEntity extends BaseEntity {
  @Index()
  @Column({ comment: '插件模块 ID' })
  moduleId: string;

  @Column({ comment: 'manifest 迁移 ID' })
  migrationId: string;

  @Column({ comment: '迁移声明版本' })
  version: number;

  @Column({ comment: '迁移声明校验和' })
  checksum: string;

  @Column({ comment: '迁移状态：applied 或 rolled-back' })
  state: 'applied' | 'rolled-back';

  @Column({ comment: '业务导入批次 ID' })
  importBatchId: string;

  @Column({ comment: '迁移结果摘要', type: 'text', nullable: true })
  detail: string;

  @Column({ comment: '首次完成时间' })
  appliedAt: string;

  @Column({ comment: '回滚完成时间', nullable: true })
  rolledBackAt: string;
}
