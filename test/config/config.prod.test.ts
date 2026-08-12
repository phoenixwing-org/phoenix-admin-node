import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveProductionDatabaseSwitches } from '../../src/config/database-switches';

describe('正式数据库安装开关', () => {
  it('常规生产启动默认不执行建表或初始化', () => {
    const switches = resolveProductionDatabaseSwitches({});

    expect(switches.synchronize).toBe(false);
    expect(switches.initialize).toBe(false);
    const productionConfigSource = readFileSync(
      join(process.cwd(), 'src/config/config.prod.ts'),
      'utf8'
    );
    expect(productionConfigSource).toContain(
      'resolveProductionDatabaseSwitches()'
    );
  });

  it('全新安装可显式复用 Cool 的建表与数据菜单初始化', () => {
    const switches = resolveProductionDatabaseSwitches({
      PAH_DB_SYNCHRONIZE: 'true',
      PAH_DB_INITIALIZE: 'true',
    });

    expect(switches.synchronize).toBe(true);
    expect(switches.initialize).toBe(true);
  });

  it('只接受精确 true，避免误把任意环境变量当作安装授权', () => {
    const switches = resolveProductionDatabaseSwitches({
      PAH_DB_SYNCHRONIZE: '1',
      PAH_DB_INITIALIZE: 'yes',
    });

    expect(switches.synchronize).toBe(false);
    expect(switches.initialize).toBe(false);
  });
});
