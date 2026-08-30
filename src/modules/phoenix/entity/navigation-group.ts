import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../base/entity/base';

/** Phoenix 工作台的大分组。内置分组允许调整显示名、顺序与启用状态，但不能删除。 */
@Entity('pah_navigation_group')
export class PahNavigationGroupEntity extends BaseEntity {
  @Index({ unique: true })
  @Column({ comment: '稳定分组键' })
  groupKey: string;

  @Column({ comment: '分组名称' })
  label: string;

  @Column({ comment: '显示顺序', default: 0 })
  orderNum: number;

  @Column({ comment: '是否宿主内置', default: false })
  isBuiltin: boolean;

  @Column({ comment: '是否参与工作台导航', default: true })
  isEnabled: boolean;
}
