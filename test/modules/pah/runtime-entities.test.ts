import { execFileSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

const repositoryRoot = path.resolve(__dirname, '../../..');
const coolCli = require.resolve('@cool-midway/core/dist/bin/index.js');

function writeEntity(root: string, moduleId: string, name: string) {
  const directory = path.join(root, 'src', 'modules', moduleId, 'entity');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, `${name}.ts`),
    `export class ${name.replace(/[^A-Za-z0-9]/g, '')} {}\n`
  );
}

function generate(root: string) {
  execFileSync(process.execPath, [coolCli, 'entity'], {
    cwd: root,
    stdio: 'pipe',
  });
  return readFileSync(path.join(root, 'src', 'entities.ts'), 'utf8');
}

describe('运行时实体清单边界', () => {
  it('把 Cool 固定输出视为 ignored 运行时文件，而不是 Host tracked 真源', () => {
    expect(
      execFileSync('git', ['check-ignore', '--no-index', 'src/entities.ts'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
      }).trim()
    ).toBe('src/entities.ts');
    expect(
      execFileSync('git', ['ls-files', 'src/entities.ts'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
      })
    ).toBe('');
  });

  it('覆盖无插件、单插件、多插件、空格目录及移除后的冷生成', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-runtime-entities-'));
    try {
      mkdirSync(path.join(root, 'src', 'modules'), { recursive: true });

      const empty = generate(root);
      expect(empty).not.toContain('import * as entity');

      writeEntity(root, 'host-fixture', 'HostEntity');
      const single = generate(root);
      expect(single).toContain(
        "from './modules/host-fixture/entity/HostEntity'"
      );

      writeEntity(root, 'plugin fixture with space', 'PluginEntity');
      writeEntity(root, 'second-plugin-fixture', 'SecondEntity');
      const multiple = generate(root);
      expect(multiple).toContain(
        "from './modules/plugin fixture with space/entity/PluginEntity'"
      );
      expect(multiple).toContain(
        "from './modules/second-plugin-fixture/entity/SecondEntity'"
      );
      expect(generate(root)).toBe(multiple);

      rmSync(path.join(root, 'src', 'modules', 'plugin fixture with space'), {
        recursive: true,
        force: true,
      });
      const afterRemoval = generate(root);
      expect(afterRemoval).not.toContain('plugin fixture with space');
      expect(afterRemoval).toContain('second-plugin-fixture');
      expect(existsSync(path.join(root, 'src', 'entities.ts'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
