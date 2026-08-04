import { DictTypeEntity } from './../entity/type';
import { DictInfoEntity } from './../entity/info';
import { Config, Provide } from '@midwayjs/core';
import { BaseService, CoolCommException } from '@cool-midway/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository, In } from 'typeorm';
import * as _ from 'lodash';
import { normalizeDictionaryTags } from '../util/governance';

function ownsProperty(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * 字典信息
 */
@Provide()
export class DictInfoService extends BaseService {
  @InjectEntityModel(DictInfoEntity)
  dictInfoEntity: Repository<DictInfoEntity>;

  @InjectEntityModel(DictTypeEntity)
  dictTypeEntity: Repository<DictTypeEntity>;

  @Config('typeorm.dataSource.default.type')
  ormType: string;

  /**
   * 获得字典数据
   * @param types
   */
  async data(types: string[]) {
    const result = {};
    let typeData = await this.dictTypeEntity.find();
    if (!_.isEmpty(types)) {
      typeData = await this.dictTypeEntity.findBy({ key: In(types) });
    }
    if (_.isEmpty(typeData)) {
      return {};
    }
    const data = await this.dictInfoEntity
      .createQueryBuilder('a')
      .select([
        'a.id',
        'a.name',
        'a.typeId',
        'a.parentId',
        'a.orderNum',
        'a.value',
        'a.enabled',
        'a.tags',
        'a.core',
        'a.ownerModuleId',
      ])
      .where('a.typeId in(:...typeIds)', {
        typeIds: typeData.map(e => {
          return e.id;
        }),
      })
      .andWhere('a.enabled = :enabled', { enabled: true })
      .orderBy('a.orderNum', 'ASC')
      .addOrderBy('a.createTime', 'ASC')
      .getMany();
    for (const item of typeData) {
      result[item.key] = _.filter(data, { typeId: item.id }).map(e => {
        const value = e.value ? Number(e.value) : e.value;
        return {
          ...e,
          // @ts-ignore
          value: isNaN(value) ? e.value : value,
        };
      });
    }
    return result;
  }

  /**
   * 获得字典key
   * @returns
   */
  async types() {
    return await this.dictTypeEntity.find();
  }

  /**
   * 获得单个或多个字典值
   * @param value 字典值或字典值数组
   * @param key 字典类型
   * @returns
   */
  async getValues(value: string | string[], key: string) {
    // 获取字典类型
    const type = await this.dictTypeEntity.findOneBy({ key });
    if (!type) {
      return null; // 或者适当的错误处理
    }

    // 根据typeId获取所有相关的字典信息
    const dictValues = await this.dictInfoEntity.find({
      where: { typeId: type.id, enabled: true },
    });

    // 如果value是字符串，直接查找
    if (typeof value === 'string') {
      return this.findValueInDictValues(value, dictValues);
    }

    // 如果value是数组，遍历数组，对每个元素进行查找
    return value.map(val => this.findValueInDictValues(val, dictValues));
  }

  /**
   * 在字典值数组中查找指定的值
   * @param value 要查找的值
   * @param dictValues 字典值数组
   * @returns
   */
  findValueInDictValues(value: string, dictValues: any[]) {
    let result = dictValues.find(dictValue => dictValue.value === value);
    if (!result) {
      result = dictValues.find(dictValue => dictValue.id === parseInt(value));
    }
    return result ? result.name : null; // 或者适当的错误处理
  }

  /**
   * 普通 Cool CRUD 只能维护自定义字段；插件所有权与 core 标识仅由 Pah
   * reconcile 在受控事务中写入。
   */
  async modifyBefore(data: any, type: 'delete' | 'update' | 'add') {
    if (type === 'delete') {
      const ids = this.normalizeIds(data);
      const protectedItems = await this.findProtectedDeleteItems(ids);
      if (protectedItems.length) {
        throw new CoolCommException(
          `核心或插件受管字典项不可删除：${protectedItems
            .map(item => item.name || item.value || item.id)
            .join('、')}`
        );
      }
      return;
    }

    const rows = Array.isArray(data) ? data : [data];
    if (type === 'add') {
      for (const row of rows) {
        if (row.core === true || row.ownerModuleId) {
          throw new CoolCommException(
            '普通字典接口不能创建插件受管或核心字典项'
          );
        }
        row.enabled = row.enabled === undefined ? true : Boolean(row.enabled);
        row.tags = normalizeDictionaryTags(row.tags);
        row.core = false;
        row.ownerModuleId = null;
      }
      return;
    }

    const ids = rows.map(row => Number(row.id)).filter(Number.isInteger);
    const existingRows = ids.length
      ? await this.dictInfoEntity.findBy({ id: In(ids) })
      : [];
    const existingById = new Map(existingRows.map(row => [row.id, row]));
    for (const row of rows) {
      const existing = existingById.get(Number(row.id));
      if (!existing) {
        throw new CoolCommException('字典项不存在或已被删除');
      }
      if (ownsProperty(row, 'tags')) {
        row.tags = normalizeDictionaryTags(row.tags);
      }
      if (ownsProperty(row, 'enabled')) {
        row.enabled = Boolean(row.enabled);
      }
      this.assertProtectedUpdate(existing, row);
    }
  }

  /**
   * 修改之后
   * @param data
   * @param type
   */
  async modifyAfter(data: any, type: 'delete' | 'update' | 'add') {
    if (type === 'delete') {
      for (const id of data) {
        await this.delChildDict(id);
      }
    }
  }

  /**
   * 删除子字典
   * @param id
   */
  private async delChildDict(id) {
    const delDict = await this.dictInfoEntity.findBy({ parentId: id });
    if (_.isEmpty(delDict)) {
      return;
    }
    const delDictIds = delDict.map(e => {
      return e.id;
    });
    await this.dictInfoEntity.delete(delDictIds);
    for (const dictId of delDictIds) {
      await this.delChildDict(dictId);
    }
  }

  private normalizeIds(data: unknown): number[] {
    const source = Array.isArray(data) ? data : [data];
    return source
      .flatMap(item =>
        typeof item === 'object' && item !== null && 'id' in item
          ? [(item as { id: unknown }).id]
          : [item]
      )
      .map(Number)
      .filter(Number.isInteger);
  }

  private async findProtectedDeleteItems(ids: number[]) {
    const all = new Map<number, DictInfoEntity>();
    let pending = [...new Set(ids)];
    while (pending.length) {
      const rows = await this.dictInfoEntity.findBy([
        { id: In(pending) },
        { parentId: In(pending) },
      ]);
      const next: number[] = [];
      for (const row of rows) {
        if (!all.has(row.id)) next.push(row.id);
        all.set(row.id, row);
      }
      pending = next;
    }
    return [...all.values()].filter(item => item.core || item.ownerModuleId);
  }

  private assertProtectedUpdate(existing: DictInfoEntity, update: any) {
    if (!existing.core && !existing.ownerModuleId) {
      if (update.core === true || update.ownerModuleId) {
        throw new CoolCommException(
          '普通字典接口不能接管插件所有权或设置核心项'
        );
      }
      return;
    }

    const immutableFields = existing.core
      ? [
          'typeId',
          'value',
          'orderNum',
          'parentId',
          'enabled',
          'tags',
          'core',
          'ownerModuleId',
        ]
      : ['typeId', 'value', 'core', 'ownerModuleId'];
    for (const field of immutableFields) {
      if (!ownsProperty(update, field)) continue;
      const current = existing[field];
      const next = update[field];
      const unchanged = Array.isArray(current)
        ? JSON.stringify(normalizeDictionaryTags(current)) ===
          JSON.stringify(normalizeDictionaryTags(next))
        : current === next;
      if (!unchanged) {
        throw new CoolCommException(
          existing.core
            ? '核心字典项仅允许修改显示名称和备注'
            : '插件受管字典项不能修改稳定值、核心标识或所有者'
        );
      }
    }
  }
}
