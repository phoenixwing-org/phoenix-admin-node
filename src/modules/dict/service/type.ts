import { DictInfoEntity } from './../entity/info';
import { DictTypeEntity } from './../entity/type';
import { Provide } from '@midwayjs/core';
import { BaseService, CoolCommException } from '@cool-midway/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository, In } from 'typeorm';

/**
 * 描述
 */
@Provide()
export class DictTypeService extends BaseService {
  @InjectEntityModel(DictTypeEntity)
  dictTypeEntity: Repository<DictTypeEntity>;

  @InjectEntityModel(DictInfoEntity)
  dictInfoEntity: Repository<DictInfoEntity>;

  async modifyBefore(data: any, type: 'delete' | 'update' | 'add') {
    if (type === 'delete') return;
    const rows = Array.isArray(data) ? data : [data];
    if (type === 'add') {
      for (const row of rows) {
        if (row.ownerModuleId) {
          throw new CoolCommException('普通字典接口不能创建插件受管字典类型');
        }
        row.ownerModuleId = null;
      }
      return;
    }
    const ids = rows.map(row => Number(row.id)).filter(Number.isInteger);
    const existingRows = ids.length
      ? await this.dictTypeEntity.findBy({ id: In(ids) })
      : [];
    const existingById = new Map(existingRows.map(row => [row.id, row]));
    for (const row of rows) {
      const existing = existingById.get(Number(row.id));
      if (!existing) throw new CoolCommException('字典类型不存在或已被删除');
      if (
        existing.ownerModuleId &&
        ((Object.prototype.hasOwnProperty.call(row, 'key') &&
          row.key !== existing.key) ||
          (Object.prototype.hasOwnProperty.call(row, 'ownerModuleId') &&
            row.ownerModuleId !== existing.ownerModuleId))
      ) {
        throw new CoolCommException('插件受管字典类型不能修改稳定标识或所有者');
      }
      if (!existing.ownerModuleId && row.ownerModuleId) {
        throw new CoolCommException('普通字典接口不能接管插件所有权');
      }
    }
  }

  /**
   * 删除
   * @param ids
   */
  async delete(ids) {
    const normalizedIds = (Array.isArray(ids) ? ids : [ids])
      .map(Number)
      .filter(Number.isInteger);
    const [types, coreItems] = await Promise.all([
      this.dictTypeEntity.findBy({ id: In(normalizedIds) }),
      this.dictInfoEntity.findBy({
        typeId: In(normalizedIds),
        core: true,
      }),
    ]);
    if (types.some(type => type.ownerModuleId) || coreItems.length) {
      throw new CoolCommException('插件受管或包含核心项的字典类型不可删除');
    }
    await super.delete(normalizedIds);
    await this.dictInfoEntity.delete({
      typeId: In(normalizedIds),
    });
  }
}
