import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../base/entity/base';

/** 停用插件时保存的角色授权，重启用后按稳定贡献键恢复。 */
@Entity('pah_plugin_role_grant')
@Index(['moduleId', 'roleId', 'contributionKey'], { unique: true })
export class PahPluginRoleGrantEntity extends BaseEntity {
  @Index()
  @Column({ comment: '稳定插件模块 ID' })
  moduleId: string;

  @Index()
  @Column({ comment: '系统角色 ID' })
  roleId: number;

  @Column({ comment: '清单内稳定贡献键' })
  contributionKey: string;
}
