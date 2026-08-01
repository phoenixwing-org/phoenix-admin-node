import { BaseService, CoolCommException } from '@cool-midway/core';
import { Inject, Provide } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Equal, In, Repository } from 'typeorm';
import { BaseSysMenuEntity } from '../../base/entity/sys/menu';
import { BaseSysRoleMenuEntity } from '../../base/entity/sys/role_menu';
import { BaseSysUserRoleEntity } from '../../base/entity/sys/user_role';
import { BaseSysPermsService } from '../../base/service/sys/perms';
import { PahPluginMenuContributionEntity } from '../entity/menu-contribution';
import { PahPluginInstallationEntity } from '../entity/plugin';
import { PahPluginRoleGrantEntity } from '../entity/role-grant';
import { PahPluginMigrationRecordEntity } from '../entity/migration-record';
import { PahNavigationService } from './navigation';
import {
  canTransitionPahPlugin,
  PahPluginLifecycleState,
  PahPluginManifest,
  validatePahPluginManifest,
} from '../interface/plugin';

function stateTime() {
  return new Date().toISOString();
}

@Provide()
export class PahPluginService extends BaseService {
  @Inject()
  ctx: Context;

  @InjectEntityModel(PahPluginInstallationEntity)
  pluginInstallationEntity: Repository<PahPluginInstallationEntity>;

  @InjectEntityModel(PahPluginMenuContributionEntity)
  pluginMenuContributionEntity: Repository<PahPluginMenuContributionEntity>;

  @InjectEntityModel(PahPluginRoleGrantEntity)
  pluginRoleGrantEntity: Repository<PahPluginRoleGrantEntity>;

  @InjectEntityModel(PahPluginMigrationRecordEntity)
  pluginMigrationRecordEntity: Repository<PahPluginMigrationRecordEntity>;

  @InjectEntityModel(BaseSysMenuEntity)
  baseSysMenuEntity: Repository<BaseSysMenuEntity>;

  @InjectEntityModel(BaseSysRoleMenuEntity)
  baseSysRoleMenuEntity: Repository<BaseSysRoleMenuEntity>;

  @InjectEntityModel(BaseSysUserRoleEntity)
  baseSysUserRoleEntity: Repository<BaseSysUserRoleEntity>;

  @Inject()
  baseSysPermsService: BaseSysPermsService;

  @Inject()
  pahNavigationService: PahNavigationService;

  async register(manifest: PahPluginManifest) {
    this.requireHostAdmin();
    const validation = validatePahPluginManifest(manifest);
    if (!validation.valid) {
      throw new CoolCommException(validation.errors.join('；'));
    }

    const existing = await this.pluginInstallationEntity.findOne({
      where: { moduleId: Equal(manifest.moduleId) },
    });

    if (existing) {
      if (
        existing.version !== manifest.version &&
        !['disabled', 'uninstalled', 'failed'].includes(existing.state)
      ) {
        throw new CoolCommException(
          '版本变更必须先停用插件，升级流程将在下一阶段接管'
        );
      }

      const restartLifecycle = ['uninstalled', 'failed', 'rejected'].includes(
        existing.state
      );
      await this.pluginInstallationEntity.update(existing.id, {
        name: manifest.name,
        version: manifest.version,
        publisher: manifest.publisher,
        activationMode: manifest.activationMode,
        manifest,
        state: restartLifecycle ? 'verified' : existing.state,
        dataRetained: true,
        lastError: null,
        stateChangedAt: restartLifecycle
          ? stateTime()
          : existing.stateChangedAt,
      });
    } else {
      await this.pluginInstallationEntity.insert({
        moduleId: manifest.moduleId,
        name: manifest.name,
        version: manifest.version,
        publisher: manifest.publisher,
        activationMode: manifest.activationMode,
        manifest,
        state: 'verified',
        dataRetained: true,
        stateChangedAt: stateTime(),
      });
    }

    return this.getByModuleId(manifest.moduleId);
  }

  async install(moduleId: string) {
    this.requireHostAdmin();
    let info = await this.getRequired(moduleId);
    this.requireTransition(info, 'staged');
    for (const state of ['staged', 'migrated', 'installed'] as const) {
      info = await this.transition(info, state);
    }
    return info;
  }

  async enable(moduleId: string) {
    this.requireHostAdmin();
    const info = await this.getRequired(moduleId);
    this.requireTransition(info, 'enabled');
    await this.applyNavigationContributions(info);
    try {
      return await this.transition(info, 'enabled');
    } catch (error) {
      await this.removeNavigationContributions(moduleId, false);
      throw error;
    }
  }

  async disable(moduleId: string) {
    this.requireHostAdmin();
    const info = await this.getRequired(moduleId);
    this.requireTransition(info, 'disabled');
    await this.removeNavigationContributions(moduleId, true);
    try {
      return await this.transition(info, 'disabled');
    } catch (error) {
      await this.applyNavigationContributions(info);
      throw error;
    }
  }

  async uninstall(moduleId: string, backupId: string) {
    this.requireHostAdmin();
    const info = await this.getRequired(moduleId);
    if (info.state === 'enabled') {
      throw new CoolCommException('卸载前必须先停用插件');
    }
    if (info.manifest.uninstall.requiresBackup && !backupId?.trim()) {
      throw new CoolCommException('卸载前必须提供可恢复的备份标识');
    }

    const next = await this.transition(info, 'uninstalled', {
      dataRetained: true,
      lastBackupId: backupId.trim(),
    });
    return {
      ...next,
      retainedTables: next.manifest.dataOwnership.tables,
      purgedTables: [],
    };
  }

  async enabled() {
    return this.pluginInstallationEntity.find({
      where: { state: Equal('enabled') },
      order: { moduleId: 'ASC' },
    });
  }

  async getByModuleId(moduleId: string) {
    return this.pluginInstallationEntity.findOne({
      where: { moduleId: Equal(moduleId) },
    });
  }

  async migrationRecords(moduleId: string) {
    this.requireHostAdmin();
    await this.getRequired(moduleId);
    return this.pluginMigrationRecordEntity.find({
      where: { moduleId: Equal(moduleId) },
      order: { version: 'ASC', createTime: 'DESC' },
    });
  }

  /** 由编译期业务模块在实际数据迁移成功后写入 Host 台账。 */
  async recordMigrationApplied(
    moduleId: string,
    migrationId: string,
    importBatchId: string,
    detail: unknown
  ) {
    const info = await this.getRequired(moduleId);
    const declaration = info.manifest.migrations.find(
      item => item.id === migrationId
    );
    if (!declaration)
      throw new CoolCommException(`未声明的插件迁移：${migrationId}`);
    if (!importBatchId?.trim())
      throw new CoolCommException('迁移台账必须关联导入批次');
    const existing = await this.pluginMigrationRecordEntity.findOne({
      where: {
        moduleId: Equal(moduleId),
        migrationId: Equal(migrationId),
        importBatchId: Equal(importBatchId),
      },
    });
    const now = stateTime();
    if (existing) {
      await this.pluginMigrationRecordEntity.update(existing.id, {
        state: 'applied',
        detail: JSON.stringify(detail),
        appliedAt: now,
        rolledBackAt: null,
      });
    } else {
      await this.pluginMigrationRecordEntity.save({
        moduleId,
        migrationId,
        version: declaration.version,
        checksum: declaration.checksum,
        importBatchId,
        state: 'applied',
        detail: JSON.stringify(detail),
        appliedAt: now,
        rolledBackAt: null,
      });
    }
    return this.migrationRecords(moduleId);
  }

  async recordMigrationRollback(moduleId: string, importBatchId: string) {
    await this.getRequired(moduleId);
    if (!importBatchId?.trim())
      throw new CoolCommException('回滚必须关联导入批次');
    await this.pluginMigrationRecordEntity.update(
      {
        moduleId: Equal(moduleId),
        importBatchId: Equal(importBatchId),
        state: Equal('applied'),
      },
      { state: 'rolled-back', rolledBackAt: stateTime() }
    );
    return this.migrationRecords(moduleId);
  }

  private async getRequired(moduleId: string) {
    const info = await this.getByModuleId(moduleId);
    if (!info) throw new CoolCommException(`插件 ${moduleId} 尚未登记`);
    return info;
  }

  /**
   * 将 manifest 的导航、页面和能力节点物化为 Cool 菜单树。
   * 映射表只保存 Host 创建的菜单，因此禁用时绝不会误删原有业务菜单。
   */
  private async applyNavigationContributions(
    info: PahPluginInstallationEntity
  ) {
    await this.removeNavigationContributions(info.moduleId, false);

    const { manifest } = info;
    const routes = new Map(manifest.routes.map(route => [route.id, route]));
    const pageParents = new Map<string, number>();
    const moduleMenuIds = new Map<string, number>();
    let moduleOrder = 0;
    for (const module of manifest.navigation.modules) {
      moduleOrder += 1;
      const moduleMenu = await this.createMenuContribution(
        info.moduleId,
        `navigation.module:${module.id}`,
        {
          // Pah 大分组是前端虚拟层；这里的根节点才是 Cool/Pah 的业务模块。
          parentId: null,
          name: module.label,
          router: null,
          perms: null,
          type: 0,
          icon: module.icon || 'pnw:folder',
          orderNum: moduleOrder,
          viewPath: null,
          keepAlive: true,
          isShow: true,
        }
      );
      moduleMenuIds.set(module.id, moduleMenu.id);
      // 管理员一旦把模块移动到其他大分组，稳定目标键上的配置会优先保留；
      // 首次启用才采用 manifest 的建议分组。
      await this.pahNavigationService.ensurePluginPreferredGroup(
        info.moduleId,
        module.id,
        manifest.navigation.preferredGroupId
      );

      let routeOrder = 0;
      for (const routeId of module.routeIds) {
        const route = routes.get(routeId);
        if (!route) continue;
        routeOrder += 1;
        const page = await this.createMenuContribution(
          info.moduleId,
          `route:${route.id}`,
          {
            parentId: moduleMenu.id,
            name: route.title,
            router: route.path,
            perms: route.capability,
            type: 1,
            icon: route.icon || 'pnw:document',
            orderNum: routeOrder,
            viewPath: route.viewPath,
            keepAlive: true,
            isShow: route.isShow !== false,
          }
        );
        pageParents.set(route.id, page.id);
      }
    }

    let capabilityOrder = 0;
    for (const capability of manifest.capabilities) {
      capabilityOrder += 1;
      const route = manifest.routes.find(
        item => item.capability === capability.id
      );
      const parentId = route
        ? pageParents.get(route.id)
        : moduleMenuIds.get(manifest.navigation.modules[0]?.id);
      await this.createMenuContribution(
        info.moduleId,
        `capability:${capability.id}`,
        {
          parentId,
          name: capability.description,
          router: null,
          perms: capability.id,
          type: 2,
          icon: null,
          orderNum: capabilityOrder,
          viewPath: null,
          keepAlive: false,
          isShow: false,
        }
      );
    }

    await this.restoreRoleGrants(info.moduleId);
  }

  private async createMenuContribution(
    moduleId: string,
    contributionKey: string,
    data: Partial<BaseSysMenuEntity>
  ) {
    const menu = await this.baseSysMenuEntity.save(data);
    await this.pluginMenuContributionEntity.save({
      moduleId,
      contributionKey,
      menuId: menu.id,
    });
    return menu;
  }

  private async removeNavigationContributions(
    moduleId: string,
    snapshotRoleGrants: boolean
  ) {
    const contributions = await this.pluginMenuContributionEntity.find({
      where: { moduleId: Equal(moduleId) },
    });
    if (contributions.length === 0) return;

    const menuIds = contributions.map(item => item.menuId);
    // 先记录受影响角色；删除菜单后必须主动刷新用户权限缓存，
    // 否则停用插件的瞬间仍可能沿用旧的 capability 缓存。
    const grants = await this.baseSysRoleMenuEntity.find({
      where: { menuId: In(menuIds) },
    });
    const affectedRoleIds = [...new Set(grants.map(item => item.roleId))];
    if (snapshotRoleGrants) {
      await this.snapshotRoleGrants(moduleId, contributions);
    }
    await this.baseSysRoleMenuEntity.delete({ menuId: In(menuIds) });
    await this.baseSysMenuEntity.delete(menuIds);
    await this.pluginMenuContributionEntity.delete({
      moduleId: Equal(moduleId),
    });
    await this.refreshRolePermissions(affectedRoleIds);
  }

  private async snapshotRoleGrants(
    moduleId: string,
    contributions: PahPluginMenuContributionEntity[]
  ) {
    const menuIds = contributions.map(item => item.menuId);
    const contributionKeyByMenuId = new Map(
      contributions.map(item => [item.menuId, item.contributionKey])
    );
    const grants = await this.baseSysRoleMenuEntity.find({
      where: { menuId: In(menuIds) },
    });
    await this.pluginRoleGrantEntity.delete({ moduleId: Equal(moduleId) });
    const seen = new Set<string>();
    const snapshots = grants.flatMap(grant => {
      const contributionKey = contributionKeyByMenuId.get(grant.menuId);
      const key = `${grant.roleId}:${contributionKey}`;
      if (!contributionKey || seen.has(key)) return [];
      seen.add(key);
      return [{ moduleId, roleId: grant.roleId, contributionKey }];
    });
    if (snapshots.length > 0) {
      await this.pluginRoleGrantEntity.save(snapshots);
    }
  }

  private async restoreRoleGrants(moduleId: string) {
    const grants = await this.pluginRoleGrantEntity.find({
      where: { moduleId: Equal(moduleId) },
    });
    if (grants.length === 0) return;
    const contributions = await this.pluginMenuContributionEntity.find({
      where: { moduleId: Equal(moduleId) },
    });
    const menuIdByContributionKey = new Map(
      contributions.map(item => [item.contributionKey, item.menuId])
    );
    const restoredRoleIds = new Set<number>();
    for (const grant of grants) {
      const menuId = menuIdByContributionKey.get(grant.contributionKey);
      if (!menuId) continue;
      await this.baseSysRoleMenuEntity.save({ roleId: grant.roleId, menuId });
      restoredRoleIds.add(grant.roleId);
    }
    await this.refreshRolePermissions([...restoredRoleIds]);
  }

  private async refreshRolePermissions(roleIds: number[]) {
    if (roleIds.length === 0) return;
    const userRoles = await this.baseSysUserRoleEntity.find({
      where: { roleId: In(roleIds) },
    });
    for (const userId of new Set(userRoles.map(item => item.userId))) {
      await this.baseSysPermsService.refreshPerms(userId);
    }
  }

  private async transition(
    info: PahPluginInstallationEntity,
    target: PahPluginLifecycleState,
    patch: Partial<PahPluginInstallationEntity> = {}
  ) {
    this.requireTransition(info, target);

    const result = await this.pluginInstallationEntity.update(
      { id: info.id, state: info.state },
      {
        ...patch,
        state: target,
        stateChangedAt: stateTime(),
        lastError: null,
      }
    );
    if (result.affected !== 1) {
      throw new CoolCommException('插件状态已变化，请刷新后重试');
    }
    return this.getRequired(info.moduleId);
  }

  /** 在任何菜单、角色或数据副作用发生前验证状态机。 */
  private requireTransition(
    info: PahPluginInstallationEntity,
    target: PahPluginLifecycleState
  ) {
    if (!canTransitionPahPlugin(info.state, target)) {
      throw new CoolCommException(
        `插件状态不能从 ${info.state} 转换到 ${target}`
      );
    }
  }

  /** 插件登记、生命周期和迁移台账属于宿主治理面，仅根管理员可操作。 */
  private requireHostAdmin() {
    if (this.ctx.admin?.username !== 'admin') {
      throw new CoolCommException('只有 Host 管理员可以维护业务插件');
    }
  }
}
