import { BaseService, CoolCommException } from '@cool-midway/core';
import { Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Context } from '@midwayjs/koa';
import { Inject } from '@midwayjs/core';
import { Equal, Repository } from 'typeorm';
import { BaseSysMenuEntity } from '../../base/entity/sys/menu';
import { PahPluginMenuContributionEntity } from '../entity/menu-contribution';
import { PahPluginInstallationEntity } from '../entity/plugin';
import { PahNavigationGroupAssignmentEntity } from '../entity/navigation-group-assignment';
import { PahNavigationGroupEntity } from '../entity/navigation-group';

export const PAH_BUSINESS_NAVIGATION_GROUP_KEY = 'pah-group-business';

export const PAH_BUILTIN_NAVIGATION_GROUPS = [
  { groupKey: 'pah-group-management', label: '管理', orderNum: 10 },
  { groupKey: 'pah-group-development', label: '开发', orderNum: 20 },
  { groupKey: PAH_BUSINESS_NAVIGATION_GROUP_KEY, label: '业务', orderNum: 30 },
] as const;

const DEFAULT_MENU_GROUPS: Record<string, string> = {
  系统管理: 'pah-group-management',
  用户管理: 'pah-group-management',
  数据管理: 'pah-group-management',
  扩展管理: 'pah-group-management',
  框架教程: 'pah-group-development',
};

type NavigationGroupInput = {
  id?: number;
  label: string;
  orderNum?: number;
  isEnabled?: boolean;
};

@Provide()
export class PahNavigationService extends BaseService {
  @Inject()
  ctx: Context;

  @InjectEntityModel(PahNavigationGroupEntity)
  navigationGroupEntity: Repository<PahNavigationGroupEntity>;

  @InjectEntityModel(PahNavigationGroupAssignmentEntity)
  navigationAssignmentEntity: Repository<PahNavigationGroupAssignmentEntity>;

  @InjectEntityModel(BaseSysMenuEntity)
  baseSysMenuEntity: Repository<BaseSysMenuEntity>;

  @InjectEntityModel(PahPluginMenuContributionEntity)
  pluginMenuContributionEntity: Repository<PahPluginMenuContributionEntity>;

  @InjectEntityModel(PahPluginInstallationEntity)
  pluginInstallationEntity: Repository<PahPluginInstallationEntity>;

  async read() {
    await this.ensureDefaults();
    const groups = await this.navigationGroupEntity.find({
      order: { orderNum: 'ASC', id: 'ASC' },
    });
    const assignments = await this.navigationAssignmentEntity.find({
      order: { id: 'ASC' },
    });
    const modules = await this.availableModules();
    return { groups, assignments, modules };
  }

  async saveGroup(input: NavigationGroupInput) {
    this.requireHostAdmin();
    await this.ensureDefaults();
    const label = input.label?.trim();
    if (!label || label.length > 12) {
      throw new CoolCommException('分组名称必须为 1 至 12 个字符');
    }
    if (input.id) {
      const existing = await this.navigationGroupEntity.findOne({
        where: { id: Equal(input.id) },
      });
      if (!existing) throw new CoolCommException('大分组不存在');
      await this.navigationGroupEntity.update(existing.id, {
        label,
        orderNum: Number.isFinite(input.orderNum)
          ? Number(input.orderNum)
          : existing.orderNum,
        isEnabled: input.isEnabled ?? existing.isEnabled,
      });
      return this.navigationGroupEntity.findOne({
        where: { id: Equal(existing.id) },
      });
    }
    const created = await this.navigationGroupEntity.save({
      groupKey: `pah-group-custom-${Date.now().toString(36)}`,
      label,
      orderNum: Number.isFinite(input.orderNum) ? Number(input.orderNum) : 100,
      isBuiltin: false,
      isEnabled: input.isEnabled ?? true,
    });
    return created;
  }

  async removeGroup(id: number) {
    this.requireHostAdmin();
    const group = await this.navigationGroupEntity.findOne({
      where: { id: Equal(id) },
    });
    if (!group) throw new CoolCommException('大分组不存在');
    if (group.isBuiltin)
      throw new CoolCommException('内置大分组不能删除，可停用或调整名称');
    await this.navigationAssignmentEntity.delete({ groupId: Equal(id) });
    await this.navigationGroupEntity.delete(id);
    return true;
  }

  async assign(targetKey: string, groupId: number) {
    this.requireHostAdmin();
    await this.ensureDefaults();
    if (!this.isSafeTargetKey(targetKey)) {
      throw new CoolCommException('无效的导航模块目标');
    }
    const group = await this.navigationGroupEntity.findOne({
      where: { id: Equal(groupId) },
    });
    if (!group || !group.isEnabled)
      throw new CoolCommException('目标大分组不可用');
    const existing = await this.navigationAssignmentEntity.findOne({
      where: { targetKey: Equal(targetKey) },
    });
    if (existing) {
      await this.navigationAssignmentEntity.update(existing.id, { groupId });
    } else {
      await this.navigationAssignmentEntity.save({ targetKey, groupId });
    }
    return this.read();
  }

  async ensurePluginPreferredGroup(
    moduleId: string,
    navigationModuleId: string,
    groupKey: string
  ) {
    await this.ensureDefaults();
    const targetKey = `plugin:${moduleId}:${navigationModuleId}`;
    const existing = await this.navigationAssignmentEntity.findOne({
      where: { targetKey: Equal(targetKey) },
    });
    if (existing) return;
    const preferredGroup = await this.navigationGroupEntity.findOne({
      where: { groupKey: Equal(groupKey) },
    });
    const fallbackGroup = preferredGroup
      ? null
      : await this.navigationGroupEntity.findOne({
          where: { groupKey: Equal(PAH_BUSINESS_NAVIGATION_GROUP_KEY) },
        });
    const targetGroup = preferredGroup || fallbackGroup;
    if (!targetGroup) return;
    await this.navigationAssignmentEntity.save({
      targetKey,
      groupId: targetGroup.id,
    });
  }

  private async ensureDefaults() {
    for (const definition of PAH_BUILTIN_NAVIGATION_GROUPS) {
      const existing = await this.navigationGroupEntity.findOne({
        where: { groupKey: Equal(definition.groupKey) },
      });
      if (!existing) {
        await this.navigationGroupEntity.save({
          ...definition,
          isBuiltin: true,
          isEnabled: true,
        });
      }
    }
    const roots = await this.baseSysMenuEntity.find({
      where: { parentId: null, type: Equal(0), isShow: true },
      order: { orderNum: 'ASC', id: 'ASC' },
    });
    for (const root of roots) {
      const groupKey = DEFAULT_MENU_GROUPS[root.name];
      if (!groupKey) continue;
      const targetKey = `menu:${root.id}`;
      const assigned = await this.navigationAssignmentEntity.findOne({
        where: { targetKey: Equal(targetKey) },
      });
      if (assigned) continue;
      const group = await this.navigationGroupEntity.findOne({
        where: { groupKey: Equal(groupKey) },
      });
      if (group)
        await this.navigationAssignmentEntity.save({
          targetKey,
          groupId: group.id,
        });
    }
    // 已安装插件可能早于大分组功能存在。首次读取时补上建议归属，
    // 但一旦管理员已配置稳定目标键，绝不覆盖该选择。
    const plugins = await this.pluginInstallationEntity.find({
      where: { state: Equal('enabled') },
    });
    for (const plugin of plugins) {
      const navigation = plugin.manifest?.navigation;
      if (!navigation?.modules?.length) continue;
      const preferredGroup = await this.navigationGroupEntity.findOne({
        where: { groupKey: Equal(navigation.preferredGroupId) },
      });
      const fallbackGroup = await this.navigationGroupEntity.findOne({
        where: { groupKey: Equal(PAH_BUSINESS_NAVIGATION_GROUP_KEY) },
      });
      for (const module of navigation.modules) {
        const targetKey = `plugin:${plugin.moduleId}:${module.id}`;
        const existing = await this.navigationAssignmentEntity.findOne({
          where: { targetKey: Equal(targetKey) },
        });
        if (!existing && (preferredGroup || fallbackGroup)) {
          await this.navigationAssignmentEntity.save({
            targetKey,
            groupId: (preferredGroup || fallbackGroup)!.id,
          });
        }
      }
    }
  }

  private async availableModules() {
    const roots = await this.baseSysMenuEntity.find({
      where: { parentId: null, type: Equal(0), isShow: true },
      order: { orderNum: 'ASC', id: 'ASC' },
    });
    const contributions = await this.pluginMenuContributionEntity.find();
    const pluginRootMenuIds = new Set(
      contributions
        .filter(item => item.contributionKey.startsWith('navigation.module:'))
        .map(item => item.menuId)
    );
    const rootModules = roots
      .filter(menu => !pluginRootMenuIds.has(menu.id))
      .map(menu => ({
        targetKey: `menu:${menu.id}`,
        menuId: menu.id,
        label: menu.name,
        source: 'host',
      }));
    const menuById = new Map(roots.map(item => [item.id, item]));
    const pluginModules = contributions
      .filter(item => item.contributionKey.startsWith('navigation.module:'))
      .flatMap(item => {
        const menu = menuById.get(item.menuId);
        if (!menu) return [];
        const navigationModuleId = item.contributionKey.slice(
          'navigation.module:'.length
        );
        return [
          {
            targetKey: `plugin:${item.moduleId}:${navigationModuleId}`,
            menuId: item.menuId,
            label: menu.name,
            source: item.moduleId,
          },
        ];
      });
    return [...rootModules, ...pluginModules];
  }

  private isSafeTargetKey(value: string) {
    return (
      /^menu:\d+$/.test(value) ||
      /^plugin:[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(value)
    );
  }

  private requireHostAdmin() {
    if (this.ctx.admin?.username !== 'admin') {
      throw new CoolCommException('只有 Host 管理员可以维护大分组');
    }
  }
}
