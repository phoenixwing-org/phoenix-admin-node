import { BaseService } from '@cool-midway/core';
import { Inject, Provide } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { existsSync, readFileSync, realpathSync } from 'fs';
import * as path from 'path';
import { Equal, In, Repository } from 'typeorm';
import { BaseSysMenuEntity } from '../../base/entity/sys/menu';
import { BaseSysRoleMenuEntity } from '../../base/entity/sys/role_menu';
import { PahPluginMenuContributionEntity } from '../entity/menu-contribution';
import { PahPluginInstallationEntity } from '../entity/plugin';
import { PahNavigationGroupAssignmentEntity } from '../entity/navigation-group-assignment';
import { PahPluginMigrationRecordEntity } from '../entity/migration-record';
import { PahPluginManifest } from '../interface/plugin';
import { resolvePahHostRoots } from './runtime-host';
import {
  inspectPhoenixPluginModules,
  PhoenixPluginStartupHealthResult,
} from './startup-health';

export type PahDevelopmentReadinessState =
  | 'mounted-unregistered'
  | 'mounted-version-mismatch'
  | 'registered-not-installed'
  | 'installed-not-enabled'
  | 'enabled-restart-required'
  | 'enabled-contributions-missing'
  | 'enabled-permission-filtered'
  | 'ready'
  | 'quarantined';

function expectedContributionKeys(manifest: PahPluginManifest) {
  const routeIds = new Set(
    manifest.navigation.modules.flatMap(module => module.routeIds)
  );
  return [
    ...manifest.navigation.modules.map(
      module => `navigation.module:${module.id}`
    ),
    ...manifest.routes
      .filter(route => routeIds.has(route.id))
      .map(route => `route:${route.id}`),
    ...manifest.capabilities.map(capability => `capability:${capability.id}`),
  ];
}

function readBootHealth(nodeRoot: string) {
  const file = path.join(nodeRoot, '.runtime', 'pah-plugin-health.json');
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as {
      checkedAt?: string;
      plugins?: PhoenixPluginStartupHealthResult['plugins'];
    };
    return {
      checkedAt: value.checkedAt ?? null,
      plugins: Array.isArray(value.plugins) ? value.plugins : [],
    };
  } catch {
    return { checkedAt: null, plugins: [] };
  }
}

@Provide()
export class PahDevelopmentPluginStatusService extends BaseService {
  @Inject()
  ctx: Context;

  @InjectEntityModel(PahPluginInstallationEntity)
  pluginInstallationEntity: Repository<PahPluginInstallationEntity>;

  @InjectEntityModel(PahPluginMigrationRecordEntity)
  pluginMigrationRecordEntity: Repository<PahPluginMigrationRecordEntity>;

  @InjectEntityModel(PahPluginMenuContributionEntity)
  pluginMenuContributionEntity: Repository<PahPluginMenuContributionEntity>;

  @InjectEntityModel(PahNavigationGroupAssignmentEntity)
  navigationAssignmentEntity: Repository<PahNavigationGroupAssignmentEntity>;

  @InjectEntityModel(BaseSysMenuEntity)
  baseSysMenuEntity: Repository<BaseSysMenuEntity>;

  @InjectEntityModel(BaseSysRoleMenuEntity)
  baseSysRoleMenuEntity: Repository<BaseSysRoleMenuEntity>;

  async inspect() {
    const { nodeRoot, vueRoot } = resolvePahHostRoots();
    const discovery = inspectPhoenixPluginModules(nodeRoot);
    const boot = readBootHealth(nodeRoot);
    const installations = await this.pluginInstallationEntity.find();
    const installationByModule = new Map(
      installations.map(item => [item.moduleId, item])
    );

    const mounted = discovery.plugins.filter(
      item => item.origin === 'development'
    );
    const plugins = [];
    for (const item of mounted) {
      const installation = installationByModule.get(item.moduleId) ?? null;
      const manifest = item.manifest ?? installation?.manifest ?? null;
      const vueMount = path.join(vueRoot, 'src', 'modules', item.moduleId);
      let pairMounted = false;
      try {
        pairMounted =
          existsSync(vueMount) &&
          Boolean(item.webSource) &&
          realpathSync(vueMount) === realpathSync(item.webSource!);
      } catch {
        pairMounted = false;
      }

      const migrationRecords = installation
        ? await this.pluginMigrationRecordEntity.find({
            where: { moduleId: Equal(item.moduleId) },
          })
        : [];
      const appliedMigrationIds = new Set(
        migrationRecords
          .filter(record => record.state === 'applied')
          .map(record => record.migrationId)
      );
      const pendingMigrations =
        manifest?.migrations.filter(
          migration => !appliedMigrationIds.has(migration.id)
        ).length ?? 0;

      const expectedKeys = manifest ? expectedContributionKeys(manifest) : [];
      const contributions = installation
        ? await this.pluginMenuContributionEntity.find({
            where: { moduleId: Equal(item.moduleId) },
          })
        : [];
      const menuIds = contributions.map(contribution => contribution.menuId);
      const menus = menuIds.length
        ? await this.baseSysMenuEntity.findBy({ id: In(menuIds) })
        : [];
      const existingMenuIds = new Set(menus.map(menu => menu.id));
      const materialized = contributions.filter(contribution =>
        existingMenuIds.has(contribution.menuId)
      );
      const materializedKeys = new Set(
        materialized.map(contribution => contribution.contributionKey)
      );
      const missingKeys = expectedKeys.filter(
        key => !materializedKeys.has(key)
      );

      const visibleRouteKeys = new Set(
        (manifest?.routes ?? [])
          .filter(route => route.isShow !== false)
          .map(route => `route:${route.id}`)
      );
      const materializedVisibleRoutes = materialized.filter(contribution =>
        visibleRouteKeys.has(contribution.contributionKey)
      );
      const roleIds = Array.isArray(this.ctx.admin?.roleIds)
        ? this.ctx.admin.roleIds.map(Number).filter(Number.isSafeInteger)
        : [];
      const grantedMenuIds =
        this.ctx.admin?.username === 'admin'
          ? new Set(materializedVisibleRoutes.map(item => item.menuId))
          : new Set(
              roleIds.length && materializedVisibleRoutes.length
                ? (
                    await this.baseSysRoleMenuEntity.findBy({
                      roleId: In(roleIds),
                      menuId: In(
                        materializedVisibleRoutes.map(value => value.menuId)
                      ),
                    })
                  ).map(grant => grant.menuId)
                : []
            );
      const accessibleVisibleRoutes = materializedVisibleRoutes.filter(item =>
        grantedMenuIds.has(item.menuId)
      );
      const assignmentKeys = (manifest?.navigation.modules ?? []).map(
        module => `plugin:${item.moduleId}:${module.id}`
      );
      const assignments = assignmentKeys.length
        ? await this.navigationAssignmentEntity.findBy({
            targetKey: In(assignmentKeys),
          })
        : [];
      const bootItem = boot.plugins.find(
        plugin => plugin.moduleId === item.moduleId
      );
      const bootReady =
        bootItem?.state === 'ready' &&
        bootItem.version === installation?.version;

      let state: PahDevelopmentReadinessState;
      let reason: string;
      let nextAction:
        | 'choose-package'
        | 'install'
        | 'enable'
        | 'restart'
        | 'repair'
        | 'grant'
        | 'none';
      if (item.state === 'quarantined' || !pairMounted || !manifest) {
        state = 'quarantined';
        reason = pairMounted
          ? item.detail
          : 'Node/Vue 开发挂载不属于同一产品 payload';
        nextAction = 'none';
      } else if (!installation) {
        state = 'mounted-unregistered';
        reason = '开发源码已挂载，但 Pah 还没有登记该插件';
        nextAction = 'choose-package';
      } else if (installation.version !== manifest.version) {
        state = 'mounted-version-mismatch';
        reason = `挂载版本 ${manifest.version} 与 Pah 记录 ${installation.version} 不一致`;
        nextAction = 'choose-package';
      } else if (
        !['installed', 'enabled', 'disabled'].includes(installation.state)
      ) {
        state = 'registered-not-installed';
        reason = `Pah 已登记，当前生命周期为 ${installation.state}`;
        nextAction = 'install';
      } else if (installation.state !== 'enabled') {
        state = 'installed-not-enabled';
        reason = `插件已安装但未启用，当前状态为 ${installation.state}`;
        nextAction = 'enable';
      } else if (
        missingKeys.length > 0 ||
        assignments.length !== assignmentKeys.length
      ) {
        state = 'enabled-contributions-missing';
        reason = '已启用，但少于 manifest 预期的菜单或 Ribbon 投影';
        nextAction = 'repair';
      } else if (!bootReady) {
        state = 'enabled-restart-required';
        reason = '已启用并物化贡献，等待 Dev Hub 受控重启 Node/Vue';
        nextAction = 'restart';
      } else if (
        visibleRouteKeys.size > 0 &&
        accessibleVisibleRoutes.length < materializedVisibleRoutes.length
      ) {
        state = 'enabled-permission-filtered';
        reason = `当前用户只能看到 ${accessibleVisibleRoutes.length}/${visibleRouteKeys.size} 个可见路由`;
        nextAction = 'grant';
      } else {
        state = 'ready';
        reason = '开发挂载、Pah 生命周期、菜单贡献与当前运行时一致';
        nextAction = 'none';
      }

      plugins.push({
        moduleId: item.moduleId,
        name: manifest?.name ?? installation?.name ?? item.moduleId,
        version: manifest?.version ?? installation?.version ?? null,
        source: 'development-mount' as const,
        mount: {
          ready: item.state !== 'quarantined' && pairMounted,
          pairMounted,
          sourceCommit: item.sourceCommit ?? null,
          detail: item.detail,
        },
        lifecycle: {
          registered: Boolean(installation),
          state: installation?.state ?? null,
          version: installation?.version ?? null,
          lastError: installation?.lastError ?? null,
        },
        migrations: {
          declared: manifest?.migrations.length ?? 0,
          applied: appliedMigrationIds.size,
          pending: pendingMigrations,
          backupRequired: pendingMigrations > 0,
        },
        contributions: {
          expected: expectedKeys.length,
          actual: materialized.length,
          visibleRoutes: visibleRouteKeys.size,
          materializedVisibleRoutes: materializedVisibleRoutes.length,
          assignments: assignments.length,
          expectedAssignments: assignmentKeys.length,
          missingKeys,
        },
        permissions: {
          accessibleVisibleRoutes: accessibleVisibleRoutes.length,
          filteredVisibleRoutes:
            materializedVisibleRoutes.length - accessibleVisibleRoutes.length,
        },
        runtime: {
          activationMode: manifest?.activationMode ?? null,
          bootCheckedAt: boot.checkedAt,
          bootReady,
          restartOwner: 'phoenix-dev-hub' as const,
          restartServices: ['admin-api', 'admin-web'],
        },
        readiness: { state, ready: state === 'ready', reason, nextAction },
      });
    }

    return {
      checkedAt: new Date().toISOString(),
      authority: 'pah-node' as const,
      mountAuthority: 'phoenix-dev-hub' as const,
      plugins,
    };
  }
}
