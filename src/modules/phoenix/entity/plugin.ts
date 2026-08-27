import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, transformerJson } from '../../base/entity/base';
import {
  PahPluginLifecycleState,
  PahPluginManifest,
} from '../interface/plugin';

/** Phoenix 业务插件安装记录。 */
@Entity('pah_plugin_installation')
export class PahPluginInstallationEntity extends BaseEntity {
  @Index({ unique: true })
  @Column({ comment: '稳定模块 ID', unique: true })
  moduleId: string;

  @Column({ comment: '插件名称' })
  name: string;

  @Column({ comment: '插件版本' })
  version: string;

  @Column({ comment: '发布者' })
  publisher: string;

  @Index()
  @Column({ comment: '生命周期状态' })
  state: PahPluginLifecycleState;

  @Column({ comment: '激活方式', default: 'restart' })
  activationMode: 'restart';

  @Column({
    comment: '完整 manifest',
    type: 'json',
    transformer: transformerJson,
  })
  manifest: PahPluginManifest;

  @Column({ comment: '卸载后是否保留数据', default: true })
  dataRetained: boolean;

  @Column({ comment: '最近备份标识', nullable: true })
  lastBackupId: string;

  @Column({ comment: '状态变更时间', nullable: true })
  stateChangedAt: string;

  @Column({ comment: '最近错误', type: 'text', nullable: true })
  lastError: string;
}
