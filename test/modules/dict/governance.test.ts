import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { DictInfoService } from '../../../src/modules/dict/service/info';
import { DictTypeService } from '../../../src/modules/dict/service/type';
import { normalizeDictionaryTags } from '../../../src/modules/dict/util/governance';

const dictTypeControllerSource = readFileSync(
  path.join(process.cwd(), 'src/modules/dict/controller/admin/type.ts'),
  'utf8'
);

describe('Cool 字典治理边界', () => {
  it('字典类型搜索同时覆盖显示名称和稳定 Key', () => {
    expect(dictTypeControllerSource).toContain(
      "keyWordLikeFields: ['name', 'key']"
    );
  });

  it('标签按简单标识规范化、去重和排序', () => {
    expect(normalizeDictionaryTags([' General ', 'core', 'general'])).toEqual([
      'core',
      'general',
    ]);
    expect(() => normalizeDictionaryTags(['中文标签'])).toThrow(
      '字典标签只能包含小写字母'
    );
  });

  it('普通 CRUD 不能创建插件受管或 core 项', async () => {
    const service = new DictInfoService();
    Object.assign(service, { dictInfoEntity: {} });

    await expect(
      service.modifyBefore({ name: '核心', value: 'core', core: true }, 'add')
    ).rejects.toThrow('普通字典接口不能创建插件受管或核心字典项');
  });

  it('core 项只允许修改显示名称和备注', async () => {
    const service = new DictInfoService();
    const findBy = jest.fn().mockResolvedValue([
      {
        id: 7,
        name: '打开',
        value: 'open',
        typeId: 1,
        orderNum: 0,
        parentId: null,
        enabled: true,
        tags: ['core'],
        core: true,
        ownerModuleId: 'example-plugin',
      },
    ]);
    Object.assign(service, { dictInfoEntity: { findBy } });

    await expect(
      service.modifyBefore({ id: 7, name: '开启', remark: '说明' }, 'update')
    ).resolves.toBeUndefined();
    await expect(
      service.modifyBefore({ id: 7, enabled: false }, 'update')
    ).rejects.toThrow('核心字典项仅允许修改显示名称和备注');
  });

  it('删除父项时也会保护其 core 或插件受管子项', async () => {
    const service = new DictInfoService();
    const child = {
      id: 8,
      parentId: 7,
      name: '核心子项',
      value: 'core-child',
      core: true,
    };
    Object.assign(service, {
      dictInfoEntity: { findBy: jest.fn().mockResolvedValue([child]) },
    });

    await expect(service.modifyBefore([7], 'delete')).rejects.toThrow(
      '核心或插件受管字典项不可删除'
    );
  });

  it('受管字典类型不能删除，普通类型保持原 CRUD', async () => {
    const service = new DictTypeService();
    const superDelete = jest
      .spyOn(Object.getPrototypeOf(DictTypeService.prototype), 'delete')
      .mockResolvedValue(undefined);
    Object.assign(service, {
      dictTypeEntity: {
        findBy: jest
          .fn()
          .mockResolvedValueOnce([
            { id: 3, key: 'example.status', ownerModuleId: 'example-plugin' },
          ])
          .mockResolvedValueOnce([
            { id: 4, key: 'custom', ownerModuleId: null },
          ]),
      },
      dictInfoEntity: {
        findBy: jest.fn().mockResolvedValue([]),
        delete: jest.fn(),
      },
    });

    await expect(service.delete([3])).rejects.toThrow(
      '插件受管或包含核心项的字典类型不可删除'
    );
    await expect(service.delete([4])).resolves.toBeUndefined();
    expect(superDelete).toHaveBeenCalledWith([4]);
    superDelete.mockRestore();
  });
});
