import { BaseEntity } from '../../base/entity/base';
import { Column, Entity, Index } from 'typeorm';

/**
 * 字典类别
 */
@Entity('dict_type')
export class DictTypeEntity extends BaseEntity {
  @Column({ comment: '名称' })
  name: string;

  @Index({ unique: true })
  @Column({ comment: '标识' })
  key: string;
}
