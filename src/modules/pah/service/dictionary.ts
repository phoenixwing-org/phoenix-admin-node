import { createHash } from 'crypto';
import { Inject, Provide } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { InjectDataSource, InjectEntityModel } from '@midwayjs/typeorm';
import { BaseService, CoolCommException } from '@cool-midway/core';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { DictInfoEntity } from '../../dict/entity/info';
import { DictTypeEntity } from '../../dict/entity/type';
import { PahDictionaryReconcileRecordEntity } from '../entity/dictionary-reconcile-record';
import { PahPluginInstallationEntity } from '../entity/plugin';
import {
  PahDictionaryContribution,
  PahPluginManifest,
} from '../interface/plugin';

interface DictionaryTypeSnapshot {
  id: number;
  key: string;
  name: string;
}

interface DictionaryItemSnapshot {
  id: number;
  typeId: number;
  value: string;
  name: string;
  orderNum: number;
}

export interface PahDictionarySnapshot {
  types: DictionaryTypeSnapshot[];
  items: DictionaryItemSnapshot[];
}

export interface PahDictionaryItemPlan {
  value: string;
  name: string;
  orderNum: number;
  itemClass: string;
  action: 'create' | 'preserve';
  existingId?: number;
}

export interface PahDictionaryTypePlan {
  contributionId: string;
  typeKey: string;
  typeName: string;
  policyVersion: number;
  action: 'create' | 'preserve';
  existingTypeId?: number;
  items: PahDictionaryItemPlan[];
  preservedCustomItems: number;
}

export interface PahDictionaryReconcilePlan {
  dryRun: true;
  moduleId: string;
  pluginVersion: string;
  catalogHash: string;
  fingerprint: string;
  types: PahDictionaryTypePlan[];
  conflicts: string[];
  totals: {
    createTypes: number;
    createItems: number;
    preserveItems: number;
    preserveCustomItems: number;
  };
}

export interface PahDictionaryReconcileRecordItem {
  id: number;
  moduleId: string;
  pluginVersion: string;
  catalogHash: string;
  actorId: string;
  status: PahDictionaryReconcileRecordEntity['status'];
  error: string | null;
  createTime: Date;
  updateTime: Date;
}

export interface PahDictionaryReconcileRecordPage {
  list: PahDictionaryReconcileRecordItem[];
  page: number;
  size: number;
  total: number;
}

function installedItems(contribution: PahDictionaryContribution) {
  const presets = new Set(contribution.installPresets ?? []);
  return contribution.items.filter(
    item =>
      !item.presets?.length || item.presets.some(preset => presets.has(preset))
  );
}

export function hashPahDictionaryCatalog(manifest: PahPluginManifest) {
  return createHash('sha256')
    .update(JSON.stringify(manifest.dictionaryContributions ?? []))
    .digest('hex');
}

export function planPahDictionaryReconcile(
  manifest: PahPluginManifest,
  snapshot: PahDictionarySnapshot
): PahDictionaryReconcilePlan {
  const conflicts: string[] = [];
  const plans: PahDictionaryTypePlan[] = [];
  for (const contribution of manifest.dictionaryContributions ?? []) {
    const matchingTypes = snapshot.types.filter(
      type => type.key === contribution.typeKey
    );
    if (matchingTypes.length > 1) {
      conflicts.push(
        `字典类型 ${contribution.typeKey} 存在 ${matchingTypes.length} 条重复记录`
      );
      continue;
    }
    const existingType = matchingTypes[0];
    const existingItems = existingType
      ? snapshot.items.filter(item => item.typeId === existingType.id)
      : [];
    const existingItemsByValue = new Map<string, DictionaryItemSnapshot[]>();
    for (const existingItem of existingItems) {
      if (existingItem.value == null) continue;
      const value = String(existingItem.value);
      existingItemsByValue.set(value, [
        ...(existingItemsByValue.get(value) ?? []),
        existingItem,
      ]);
    }
    for (const [value, matches] of existingItemsByValue) {
      if (matches.length > 1) {
        conflicts.push(
          `字典项 ${contribution.typeKey}:${value} 存在 ${matches.length} 条重复记录`
        );
      }
    }
    const itemPlans: PahDictionaryItemPlan[] = [];
    const desiredValues = new Set<string>();
    for (const item of installedItems(contribution)) {
      desiredValues.add(item.value);
      const matchingItems = existingItemsByValue.get(item.value) ?? [];
      if (matchingItems.length > 1) {
        continue;
      }
      const existing = matchingItems[0];
      itemPlans.push({
        value: item.value,
        name: existing?.name ?? item.name,
        orderNum: existing?.orderNum ?? item.orderNum,
        itemClass: item.itemClass,
        action: existing ? 'preserve' : 'create',
        ...(existing ? { existingId: existing.id } : {}),
      });
    }
    plans.push({
      contributionId: contribution.id,
      typeKey: contribution.typeKey,
      typeName: existingType?.name ?? contribution.typeName,
      policyVersion: contribution.policyVersion,
      action: existingType ? 'preserve' : 'create',
      ...(existingType ? { existingTypeId: existingType.id } : {}),
      items: itemPlans,
      preservedCustomItems: existingItems.filter(
        item => item.value == null || !desiredValues.has(String(item.value))
      ).length,
    });
  }
  const plan = {
    dryRun: true as const,
    moduleId: manifest.moduleId,
    pluginVersion: manifest.version,
    catalogHash: hashPahDictionaryCatalog(manifest),
    types: plans,
    conflicts,
    totals: {
      createTypes: plans.filter(plan => plan.action === 'create').length,
      createItems: plans
        .flatMap(plan => plan.items)
        .filter(item => item.action === 'create').length,
      preserveItems: plans
        .flatMap(plan => plan.items)
        .filter(item => item.action === 'preserve').length,
      preserveCustomItems: plans.reduce(
        (total, plan) => total + plan.preservedCustomItems,
        0
      ),
    },
  };
  return {
    ...plan,
    fingerprint: createHash('sha256')
      .update(JSON.stringify(plan))
      .digest('hex'),
  };
}

@Provide()
export class PahDictionaryService extends BaseService {
  @Inject()
  ctx: Context;

  @InjectDataSource()
  dataSource: DataSource;

  @InjectEntityModel(DictTypeEntity)
  dictTypeEntity: Repository<DictTypeEntity>;

  @InjectEntityModel(DictInfoEntity)
  dictInfoEntity: Repository<DictInfoEntity>;

  @InjectEntityModel(PahDictionaryReconcileRecordEntity)
  reconcileRecordEntity: Repository<PahDictionaryReconcileRecordEntity>;

  private requireHostAdmin() {
    if (this.ctx.admin?.username !== 'admin') {
      throw new CoolCommException('只有 Host 管理员可以维护插件字典');
    }
  }

  private pageValue(
    value: unknown,
    fallback: number,
    label: string,
    maximum: number
  ) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
      throw new CoolCommException(`${label}必须是 1-${maximum} 的整数`);
    }
    return parsed;
  }

  private repositories(manager?: EntityManager) {
    return {
      types: manager
        ? manager.getRepository(DictTypeEntity)
        : this.dictTypeEntity,
      items: manager
        ? manager.getRepository(DictInfoEntity)
        : this.dictInfoEntity,
    };
  }

  private async snapshot(
    manager?: EntityManager
  ): Promise<PahDictionarySnapshot> {
    const repositories = this.repositories(manager);
    const types = await repositories.types.find();
    const typeIds = types.map(type => type.id);
    const items = typeIds.length
      ? await repositories.items.find({ where: { typeId: In(typeIds) } })
      : [];
    return { types, items };
  }

  async dryRun(info: PahPluginInstallationEntity) {
    this.requireHostAdmin();
    return planPahDictionaryReconcile(info.manifest, await this.snapshot());
  }

  /**
   * Host audit list. The catalog plan/result JSON stays in the ledger and is
   * deliberately excluded from the query response.
   */
  async records(
    moduleId: string,
    pageValue: unknown,
    sizeValue: unknown
  ): Promise<PahDictionaryReconcileRecordPage> {
    this.requireHostAdmin();
    const page = this.pageValue(pageValue, 1, '页码', 10_000);
    const size = this.pageValue(sizeValue, 20, '每页数量', 100);
    const [rows, total] = await this.reconcileRecordEntity.findAndCount({
      select: {
        id: true,
        moduleId: true,
        pluginVersion: true,
        catalogHash: true,
        actorId: true,
        status: true,
        error: true,
        createTime: true,
        updateTime: true,
      },
      where: { moduleId },
      order: { createTime: 'DESC', id: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });
    return {
      list: rows.map(row => ({
        id: row.id,
        moduleId: row.moduleId,
        pluginVersion: row.pluginVersion,
        catalogHash: row.catalogHash,
        actorId: row.actorId,
        status: row.status,
        error: row.error ? row.error.slice(0, 500) : null,
        createTime: row.createTime,
        updateTime: row.updateTime,
      })),
      page,
      size,
      total,
    };
  }

  async reconcile(
    info: PahPluginInstallationEntity,
    expectedFingerprint: string
  ) {
    this.requireHostAdmin();
    const initialPlan = await this.dryRun(info);
    if (
      !expectedFingerprint ||
      initialPlan.fingerprint !== expectedFingerprint
    ) {
      throw new CoolCommException('字典 dry-run 已过期，请重新生成计划并确认');
    }
    if (initialPlan.conflicts.length) {
      throw new CoolCommException(initialPlan.conflicts.join('；'));
    }
    const actorId = String(this.ctx.admin?.userId ?? 'admin');
    const record = await this.reconcileRecordEntity.save({
      moduleId: info.moduleId,
      pluginVersion: info.version,
      catalogHash: initialPlan.catalogHash,
      actorId,
      status: 'running',
      detail: { plan: initialPlan },
      error: null,
    });
    try {
      const result = await this.dataSource.transaction(
        'SERIALIZABLE',
        async manager => {
          const plan = planPahDictionaryReconcile(
            info.manifest,
            await this.snapshot(manager)
          );
          if (plan.fingerprint !== expectedFingerprint) {
            throw new CoolCommException(
              '字典数据已变化，请重新生成 dry-run 并确认'
            );
          }
          if (plan.conflicts.length) {
            throw new CoolCommException(plan.conflicts.join('；'));
          }
          const repositories = this.repositories(manager);
          for (const typePlan of plan.types) {
            let typeId = typePlan.existingTypeId;
            if (!typeId) {
              const created = await repositories.types.save(
                repositories.types.create({
                  key: typePlan.typeKey,
                  name: typePlan.typeName,
                })
              );
              typeId = created.id;
            }
            const newItems = typePlan.items.filter(
              item => item.action === 'create'
            );
            if (newItems.length) {
              await repositories.items.save(
                newItems.map(item =>
                  repositories.items.create({
                    typeId,
                    value: item.value,
                    name: item.name,
                    orderNum: item.orderNum,
                    remark: null,
                    parentId: null,
                  })
                )
              );
            }
          }
          await manager
            .getRepository(PahDictionaryReconcileRecordEntity)
            .update(record.id, {
              status: 'succeeded',
              detail: { plan: initialPlan, result: plan },
            });
          return plan;
        }
      );
      return result;
    } catch (error) {
      await this.reconcileRecordEntity.update(record.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
