import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../base/entity/base';

/**
 * 大分组与导航模块的稳定绑定。
 *
 * targetKey 对普通菜单使用 menu:<id>；对插件模块使用
 * plugin:<插件ID>:<清单模块ID>，因此插件禁用、卸载再安装后配置仍可恢复。
 */
@Entity('pah_navigation_group_assignment')
@Index(['targetKey'], { unique: true })
export class PahNavigationGroupAssignmentEntity extends BaseEntity {
  @Column({ comment: '目标稳定键' })
  targetKey: string;

  @Index()
  @Column({ comment: '归属大分组 ID' })
  groupId: number;
}
