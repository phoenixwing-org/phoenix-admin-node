describe('本地数据库安全开关', () => {
  const originalSynchronize = process.env.PAH_DB_SYNCHRONIZE;
  const originalInitialize = process.env.PAH_DB_INITIALIZE;

  afterAll(() => {
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

  it('显式关闭自动建表与初始化，但不改变数据源选择', () => {
    process.env.PAH_DB_SYNCHRONIZE = 'false';
    process.env.PAH_DB_INITIALIZE = 'false';
    const config = require('../../src/config/config.local').default;
    expect(config.typeorm.dataSource.default.synchronize).toBe(false);
    expect(config.cool.initDB).toBe(false);
    expect(config.cool.initMenu).toBe(false);
    expect(config.typeorm.dataSource.default.database).toBe(
      process.env.PAH_DB_DATABASE || 'phoenix_admin'
    );
  });
});
