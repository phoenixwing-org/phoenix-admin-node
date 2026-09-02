import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '../../base/entity/base';
import { PahFileStatus } from '../interface/files';

@Entity('pah_file_descriptor')
@Unique('UQ_pah_file_descriptor_file_id', ['fileId'])
@Unique('UQ_pah_file_descriptor_file_owner', ['fileId', 'ownerModuleId'])
@Index('IDX_pah_file_descriptor_owner_status', ['ownerModuleId', 'status'])
@Index('IDX_pah_file_descriptor_sha256', ['sha256'])
export class PahFileDescriptorEntity extends BaseEntity {
  @Column({ type: 'uuid', comment: 'Host 生成的稳定文件 ID' })
  fileId: string;

  @Column({ type: 'integer', default: 1, comment: '单调递增描述符版本' })
  version: number;

  @Column({ type: 'char', length: 64, comment: 'Host 流式计算 SHA-256' })
  sha256: string;

  @Column({ length: 128, comment: 'Host 服务端识别 MIME' })
  mime: string;

  @Column({ length: 255, comment: '清理后的原始文件名' })
  originalName: string;

  @Column({ type: 'bigint', comment: '文件字节数' })
  size: string;

  @Column({ length: 64, comment: 'Host 存储 Provider ID' })
  providerId: string;

  @Column({ length: 255, comment: '不泄露路径的 Provider 对象身份' })
  storageIdentity: string;

  @Column({ type: 'text', comment: 'Provider 私有存储 key，不得返回给客户端' })
  storageKey: string;

  @Column({ length: 32, default: 'active', comment: 'active/deleted' })
  status: PahFileStatus;

  @Column({ length: 128, comment: '文件所属插件 moduleId' })
  ownerModuleId: string;

  @Column({ type: 'integer', comment: '创建 Host 用户 ID' })
  createdBy: number;

  @Column({ type: 'integer', nullable: true, comment: '最近更新 Host 用户 ID' })
  updatedBy: number | null;

  @Column({ type: 'integer', nullable: true, comment: '删除 Host 用户 ID' })
  deletedBy: number | null;

  @Column({ length: 64, nullable: true, comment: '软删除 ISO 时间' })
  deletedAt: string | null;
}
