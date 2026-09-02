import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity, transformerJson } from '../../base/entity/base';
import { PahFileBindingStatus } from '../interface/files';

@Entity('pah_file_binding')
@Unique('UQ_pah_file_binding_binding_id', ['bindingId'])
@Unique('UQ_pah_file_binding_owner_idempotency', [
  'ownerModuleId',
  'idempotencyKey',
])
@Index('IDX_pah_file_binding_resource', [
  'ownerModuleId',
  'resourceType',
  'resourceKey',
  'status',
])
@Index('IDX_pah_file_binding_file', ['fileId', 'status'])
@Index(
  'UQ_pah_file_binding_active_primary',
  ['ownerModuleId', 'resourceType', 'resourceKey', 'relationType'],
  { unique: true, where: '"status" = \'active\' AND "isPrimary" = true' }
)
export class PahFileBindingEntity extends BaseEntity {
  @Column({ type: 'uuid', comment: 'Host 生成的稳定绑定 ID' })
  bindingId: string;

  @Column({ length: 128, comment: '绑定所属插件 moduleId' })
  ownerModuleId: string;

  @Column({ length: 128, comment: '插件定义的不透明资源类型' })
  resourceType: string;

  @Column({ length: 255, comment: '插件定义的不透明资源 key' })
  resourceKey: string;

  @Column({ type: 'uuid', comment: 'Host 文件 ID' })
  fileId: string;

  @Column({ type: 'integer', comment: '绑定时文件描述符版本' })
  fileVersion: number;

  @Column({ length: 64, comment: '插件定义的关系类型' })
  relationType: string;

  @Column({ length: 255, nullable: true, comment: '业务显示别名' })
  alias: string | null;

  @Column({ type: 'text', nullable: true, comment: '有限业务备注' })
  note: string | null;

  @Column({
    type: 'jsonb',
    default: {},
    transformer: transformerJson,
    comment: '有限可序列化属性',
  })
  attributes: Record<string, string | number | boolean | null>;

  @Column({ type: 'integer', default: 0, comment: '资源内排序' })
  sortOrder: number;

  @Column({ type: 'boolean', default: false, comment: '是否为主文件' })
  isPrimary: boolean;

  @Column({ length: 32, default: 'active', comment: 'active/unbound' })
  status: PahFileBindingStatus;

  @Column({ length: 128, comment: '插件生成的绑定幂等键' })
  idempotencyKey: string;

  @Column({ type: 'integer', comment: '创建 Host 用户 ID' })
  createdBy: number;

  @Column({ type: 'integer', nullable: true, comment: '最近更新 Host 用户 ID' })
  updatedBy: number | null;

  @Column({ type: 'integer', nullable: true, comment: '解绑 Host 用户 ID' })
  unboundBy: number | null;

  @Column({ length: 64, nullable: true, comment: '解绑 ISO 时间' })
  unboundAt: string | null;
}
