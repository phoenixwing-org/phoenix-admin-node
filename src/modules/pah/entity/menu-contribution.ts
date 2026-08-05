import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../base/entity/base';

/** 插件声明与实际系统菜单之间的可逆映射。 */
@Entity('pah_plugin_menu_contribution')
@Index(['moduleId', 'contributionKey'], { unique: true })
export class PahPluginMenuContributionEntity extends BaseEntity {
  @Index()
  @Column({ comment: '稳定插件模块 ID' })
  moduleId: string;

  @Column({ comment: '清单内稳定贡献键' })
  contributionKey: string;

  @Index()
  @Column({ comment: '当前物化的系统菜单 ID' })
  menuId: number;
}
