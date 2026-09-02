// Phoenix Admin Host 固定实体入口；插件实体由 ignored 的 entities.plugin.ts 追加。
import { pluginEntities } from './entities.plugin';
import * as entity0 from './modules/user/entity/wx';
import * as entity1 from './modules/user/entity/info';
import * as entity2 from './modules/user/entity/address';
import * as entity3 from './modules/task/entity/log';
import * as entity4 from './modules/task/entity/info';
import * as entity5 from './modules/space/entity/type';
import * as entity6 from './modules/space/entity/info';
import * as entity7 from './modules/recycle/entity/data';
import * as entity8 from './modules/plugin/entity/info';
import * as entity9 from './modules/phoenix/entity/role-grant';
import * as entity10 from './modules/phoenix/entity/plugin';
import * as entity11 from './modules/phoenix/entity/oauth-login-ticket';
import * as entity12 from './modules/phoenix/entity/oauth-login-attempt';
import * as entity13 from './modules/phoenix/entity/navigation-group';
import * as entity14 from './modules/phoenix/entity/navigation-group-assignment';
import * as entity15 from './modules/phoenix/entity/migration-record';
import * as entity16 from './modules/phoenix/entity/menu-contribution';
import * as entity17 from './modules/phoenix/entity/external-identity';
import * as entity18 from './modules/phoenix/entity/external-bind-request';
import * as entity19 from './modules/phoenix/entity/dictionary-reconcile-record';
import * as entity20 from './modules/dict/entity/type';
import * as entity21 from './modules/dict/entity/info';
import * as entity22 from './modules/demo/entity/goods';
import * as entity23 from './modules/base/entity/base';
import * as entity24 from './modules/base/entity/sys/user_role';
import * as entity25 from './modules/base/entity/sys/user';
import * as entity26 from './modules/base/entity/sys/role_menu';
import * as entity27 from './modules/base/entity/sys/role_department';
import * as entity28 from './modules/base/entity/sys/role';
import * as entity29 from './modules/base/entity/sys/param';
import * as entity30 from './modules/base/entity/sys/menu';
import * as entity31 from './modules/base/entity/sys/log';
import * as entity32 from './modules/base/entity/sys/department';
import * as entity33 from './modules/base/entity/sys/conf';
import * as entity34 from './modules/phoenix/entity/file-descriptor';
import * as entity35 from './modules/phoenix/entity/file-binding';
import * as entity36 from './modules/phoenix/entity/file-audit-record';
export const entities = [
  ...Object.values(entity0),
  ...Object.values(entity1),
  ...Object.values(entity2),
  ...Object.values(entity3),
  ...Object.values(entity4),
  ...Object.values(entity5),
  ...Object.values(entity6),
  ...Object.values(entity7),
  ...Object.values(entity8),
  ...Object.values(entity9),
  ...Object.values(entity10),
  ...Object.values(entity11),
  ...Object.values(entity12),
  ...Object.values(entity13),
  ...Object.values(entity14),
  ...Object.values(entity15),
  ...Object.values(entity16),
  ...Object.values(entity17),
  ...Object.values(entity18),
  ...Object.values(entity19),
  ...Object.values(entity20),
  ...Object.values(entity21),
  ...Object.values(entity22),
  ...Object.values(entity23),
  ...Object.values(entity24),
  ...Object.values(entity25),
  ...Object.values(entity26),
  ...Object.values(entity27),
  ...Object.values(entity28),
  ...Object.values(entity29),
  ...Object.values(entity30),
  ...Object.values(entity31),
  ...Object.values(entity32),
  ...Object.values(entity33),
  ...Object.values(entity34),
  ...Object.values(entity35),
  ...Object.values(entity36),
  ...pluginEntities,
];
