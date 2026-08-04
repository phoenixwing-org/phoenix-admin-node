import { BaseEntity } from '../../base/entity/base';
import { Column, Entity, Index } from 'typeorm';

/**
 * 字典信息
 */
@Entity('dict_info')
@Index(['typeId', 'value'], { unique: true })
export class DictInfoEntity extends BaseEntity {
  @Column({ comment: '类型ID' })
  typeId: number;

  @Column({ comment: '名称' })
  name: string;

  @Column({ comment: '值', nullable: true })
  value: string;

  @Column({ comment: '排序', default: 0 })
  orderNum: number;

  @Column({ comment: '备注', nullable: true })
  remark: string;

  @Column({ comment: '父ID', default: null })
  parentId: number;

  @Column({ comment: '是否启用', default: true })
  enabled: boolean;

  @Column({
    comment: '分类标签',
    type: 'text',
    array: true,
    default: () => "'{}'::text[]",
  })
  tags: string[];

  @Column({ comment: '是否为受保护核心项', default: false })
  core: boolean;

  @Column({ comment: '所有者插件模块', length: 128, nullable: true })
  ownerModuleId: string | null;
}
