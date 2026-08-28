import { createHash } from 'crypto';
import { Inject, Provide } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { InjectDataSource, InjectEntityModel } from '@midwayjs/typeorm';
import { BaseService, CoolCommException } from '@cool-midway/core';
import { DataSource, Equal, Repository } from 'typeorm';
import { BaseSysMenuEntity } from '../../base/entity/sys/menu';

export const PHOENIX_DICTIONARY_MENU_ROUTE_OPERATION_ID =
  'phoenix-dictionary-menu-route-v1';
export const PHOENIX_EXTENSION_CENTER_MENU_NAME_OPERATION_ID =
  'phoenix-extension-center-menu-name-v1';

const LEGACY_DICTIONARY_ROUTE = '/pah/dictionary-maintenance';
const PHOENIX_DICTIONARY_ROUTE = '/phoenix/dictionary-maintenance';
const LEGACY_DICTIONARY_VIEW = 'modules/pah/views/dictionary-maintenance.vue';
const PHOENIX_DICTIONARY_VIEW =
  'modules/phoenix/views/dictionary-maintenance.vue';
const EXTENSION_CENTER_ROUTE = '/helper/plugins';
const EXTENSION_CENTER_NAME = '扩展中心';

type PhoenixMaintenanceState = 'healthy' | 'action-required';

type PhoenixMaintenanceChange = {
  recordId: number;
  name: string;
  label?: { current: string | null; target: string | null };
  router: { current: string | null; target: string | null };
  viewPath: { current: string | null; target: string | null };
};

export type PhoenixMaintenancePlan = {
  operationId: string;
  title: string;
  description: string;
  source: 'host';
  state: PhoenixMaintenanceState;
  affectedRecords: number;
  fingerprint: string;
  changes: PhoenixMaintenanceChange[];
};

const DICTIONARY_OPERATION = Object.freeze({
  operationId: PHOENIX_DICTIONARY_MENU_ROUTE_OPERATION_ID,
  title: '升级字典维护入口',
  description: '将旧 Pah 字典菜单路由与 View 路径等幂迁移到 Phoenix 规范入口。',
  source: 'host' as const,
});

const EXTENSION_CENTER_OPERATION = Object.freeze({
  operationId: PHOENIX_EXTENSION_CENTER_MENU_NAME_OPERATION_ID,
  title: '统一扩展中心名称',
  description:
    '将原“插件列表”入口等幂升级为覆盖插件与 Host 管理能力的“扩展中心”。',
  source: 'host' as const,
});

@Provide()
export class PhoenixMaintenanceService extends BaseService {
  @Inject()
  ctx: Context;

  @InjectEntityModel(BaseSysMenuEntity)
  baseSysMenuEntity: Repository<BaseSysMenuEntity>;

  @InjectDataSource()
  dataSource: DataSource;

  async read() {
    this.requireHostAdmin();
    return [
      await this.buildDictionaryMenuRoutePlan(this.baseSysMenuEntity),
      await this.buildExtensionCenterMenuNamePlan(this.baseSysMenuEntity),
    ];
  }

  async plan(operationId: string) {
    this.requireHostAdmin();
    this.requireKnownOperation(operationId);
    return this.buildPlan(operationId, this.baseSysMenuEntity);
  }

  async apply(operationId: string, expectedFingerprint: string) {
    this.requireHostAdmin();
    this.requireKnownOperation(operationId);
    if (!/^sha256:[a-f0-9]{64}$/.test(expectedFingerprint || '')) {
      throw new CoolCommException('维护计划指纹无效，请重新检测');
    }

    return this.dataSource.transaction('SERIALIZABLE', async manager => {
      const repository = manager.getRepository(BaseSysMenuEntity);
      const current = await this.buildPlan(operationId, repository);
      if (current.fingerprint !== expectedFingerprint) {
        throw new CoolCommException('维护计划已变化，请重新检测');
      }
      if (current.state === 'healthy') {
        return { applied: false, updatedRecords: 0, plan: current };
      }

      for (const change of current.changes) {
        const patch: Partial<BaseSysMenuEntity> = {};
        if (operationId === PHOENIX_DICTIONARY_MENU_ROUTE_OPERATION_ID) {
          if (change.router.current === LEGACY_DICTIONARY_ROUTE) {
            patch.router = PHOENIX_DICTIONARY_ROUTE;
          }
          if (change.viewPath.current === LEGACY_DICTIONARY_VIEW) {
            patch.viewPath = PHOENIX_DICTIONARY_VIEW;
          }
        } else if (
          operationId === PHOENIX_EXTENSION_CENTER_MENU_NAME_OPERATION_ID &&
          change.label
        ) {
          patch.name = change.label.target ?? EXTENSION_CENTER_NAME;
        }
        await repository.update(change.recordId, patch);
      }

      const plan = await this.buildPlan(operationId, repository);
      if (plan.state !== 'healthy') {
        throw new CoolCommException('字典菜单入口升级后复检失败，事务已回滚');
      }
      return {
        applied: true,
        updatedRecords: current.affectedRecords,
        plan,
      };
    });
  }

  private async buildDictionaryMenuRoutePlan(
    repository: Repository<BaseSysMenuEntity>
  ): Promise<PhoenixMaintenancePlan> {
    const rows = await repository.find({
      where: [
        { router: Equal(LEGACY_DICTIONARY_ROUTE) },
        { viewPath: Equal(LEGACY_DICTIONARY_VIEW) },
      ],
      order: { id: 'ASC' },
    });
    const changes = rows.map(row => ({
      recordId: row.id,
      name: row.name,
      router: {
        current: row.router ?? null,
        target:
          row.router === LEGACY_DICTIONARY_ROUTE
            ? PHOENIX_DICTIONARY_ROUTE
            : row.router ?? null,
      },
      viewPath: {
        current: row.viewPath ?? null,
        target:
          row.viewPath === LEGACY_DICTIONARY_VIEW
            ? PHOENIX_DICTIONARY_VIEW
            : row.viewPath ?? null,
      },
    }));
    const fingerprint = `sha256:${createHash('sha256')
      .update(
        JSON.stringify({
          operationId: DICTIONARY_OPERATION.operationId,
          changes,
        })
      )
      .digest('hex')}`;

    return {
      ...DICTIONARY_OPERATION,
      state: changes.length ? 'action-required' : 'healthy',
      affectedRecords: changes.length,
      fingerprint,
      changes,
    };
  }

  private async buildExtensionCenterMenuNamePlan(
    repository: Repository<BaseSysMenuEntity>
  ): Promise<PhoenixMaintenancePlan> {
    const rows = (
      await repository.find({
        where: { router: Equal(EXTENSION_CENTER_ROUTE) },
        order: { id: 'ASC' },
      })
    ).filter(row => row.name !== EXTENSION_CENTER_NAME);
    const changes = rows.map(row => ({
      recordId: row.id,
      name: row.name,
      label: { current: row.name ?? null, target: EXTENSION_CENTER_NAME },
      router: { current: row.router ?? null, target: row.router ?? null },
      viewPath: { current: row.viewPath ?? null, target: row.viewPath ?? null },
    }));
    const fingerprint = `sha256:${createHash('sha256')
      .update(
        JSON.stringify({
          operationId: EXTENSION_CENTER_OPERATION.operationId,
          changes,
        })
      )
      .digest('hex')}`;

    return {
      ...EXTENSION_CENTER_OPERATION,
      state: changes.length ? 'action-required' : 'healthy',
      affectedRecords: changes.length,
      fingerprint,
      changes,
    };
  }

  private buildPlan(
    operationId: string,
    repository: Repository<BaseSysMenuEntity>
  ): Promise<PhoenixMaintenancePlan> {
    if (operationId === PHOENIX_DICTIONARY_MENU_ROUTE_OPERATION_ID) {
      return this.buildDictionaryMenuRoutePlan(repository);
    }
    return this.buildExtensionCenterMenuNamePlan(repository);
  }

  private requireKnownOperation(operationId: string) {
    if (
      operationId !== PHOENIX_DICTIONARY_MENU_ROUTE_OPERATION_ID &&
      operationId !== PHOENIX_EXTENSION_CENTER_MENU_NAME_OPERATION_ID
    ) {
      throw new CoolCommException('未知的系统维护项');
    }
  }

  private requireHostAdmin() {
    if (this.ctx.admin?.username !== 'admin') {
      throw new CoolCommException('只有 Host 管理员可以执行系统维护');
    }
  }
}
