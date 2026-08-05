describe('正式数据库安装开关', () => {
  const originalSynchronize = process.env.PAH_DB_SYNCHRONIZE;
  const originalInitialize = process.env.PAH_DB_INITIALIZE;

  afterEach(() => {
    jest.resetModules();
    if (originalSynchronize === undefined) {
      delete process.env.PAH_DB_SYNCHRONIZE;
    } else {
      process.env.PAH_DB_SYNCHRONIZE = originalSynchronize;
    }
    if (originalInitialize === undefined) {
      delete process.env.PAH_DB_INITIALIZE;
    } else {
      process.env.PAH_DB_INITIALIZE = originalInitialize;
    }
  });

  it('常规生产启动默认不执行建表或初始化', () => {
    delete process.env.PAH_DB_SYNCHRONIZE;
    delete process.env.PAH_DB_INITIALIZE;

    const config = require('../../src/config/config.prod').default;

    expect(config.typeorm.dataSource.default.synchronize).toBe(false);
    expect(config.cool.initDB).toBe(false);
    expect(config.cool.initMenu).toBe(false);
  });

  it('全新安装可显式复用 Cool 的建表与数据菜单初始化', () => {
    process.env.PAH_DB_SYNCHRONIZE = 'true';
    process.env.PAH_DB_INITIALIZE = 'true';

    const config = require('../../src/config/config.prod').default;

    expect(config.typeorm.dataSource.default.synchronize).toBe(true);
    expect(config.cool.initDB).toBe(true);
    expect(config.cool.initMenu).toBe(true);
  });

  it('只接受精确 true，避免误把任意环境变量当作安装授权', () => {
    process.env.PAH_DB_SYNCHRONIZE = '1';
    process.env.PAH_DB_INITIALIZE = 'yes';

    const config = require('../../src/config/config.prod').default;

    expect(config.typeorm.dataSource.default.synchronize).toBe(false);
    expect(config.cool.initDB).toBe(false);
    expect(config.cool.initMenu).toBe(false);
  });
});
