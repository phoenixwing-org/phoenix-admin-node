import { execFileSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

const repositoryRoot = path.resolve(__dirname, '../../..');
const generator = path.join(
  repositoryRoot,
  'scripts/pah-sync-runtime-entities.cjs'
);

function initializeHost(root: string) {
  mkdirSync(path.join(root, 'src', 'modules'), { recursive: true });
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'phoenix-admin-node' })
  );
  writeEntity(root, 'host-fixture', 'HostEntity');
  writeFileSync(
    path.join(root, 'src', 'entities.ts'),
    `import { pluginEntities } from './entities.plugin';\n` +
      `import * as hostEntity from './modules/host-fixture/entity/HostEntity';\n` +
      `export const entities = [...Object.values(hostEntity), ...pluginEntities];\n`
  );
}

function writeEntity(root: string, moduleId: string, name: string) {
  const directory = path.join(root, 'src', 'modules', moduleId, 'entity');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, `${name}.ts`),
    `export class ${name.replace(/[^A-Za-z0-9]/g, '')} {}\n`
  );
}

function generate(root: string) {
  execFileSync(process.execPath, [generator, '--root', root], {
    cwd: repositoryRoot,
    stdio: 'pipe',
  });
  return readFileSync(path.join(root, 'src', 'entities.plugin.ts'), 'utf8');
}

describe('运行时实体清单边界', () => {
  it('固定 Host 入口不再 ignored，只有插件实体清单是运行时生成物', () => {
    const fixedEntry = path.join(repositoryRoot, 'src', 'entities.ts');
    const fixedContent = readFileSync(fixedEntry, 'utf8');
    expect(
      execFileSync(
        'git',
        ['check-ignore', '--no-index', 'src/entities.plugin.ts'],
        {
        cwd: repositoryRoot,
        encoding: 'utf8',
        }
      ).trim()
    ).toBe('src/entities.plugin.ts');
    expect(
      readFileSync(path.join(repositoryRoot, '.gitignore'), 'utf8')
    ).not.toMatch(/^src\/entities\.ts$/m);
    expect(
      execFileSync('git', ['ls-files', 'src/entities.ts'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
      }).trim()
    ).toBe('src/entities.ts');
    expect(fixedContent).toContain(
      "import { pluginEntities } from './entities.plugin'"
    );

    generate(repositoryRoot);
    expect(readFileSync(fixedEntry, 'utf8')).toBe(fixedContent);
  });

  it('覆盖纯 Host、挂载插件、空格目录及卸载后的确定性冷生成', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-runtime-entities-'));
    const plugin = mkdtempSync(path.join(tmpdir(), 'pah-plugin-entities-'));
    try {
      initializeHost(root);
      const empty = generate(root);
      expect(empty).not.toContain('import * as entity');
      expect(empty).not.toContain('host-fixture');

      writeEntity(plugin, 'ignored', 'PluginEntity');
      const pluginModule = path.join(plugin, 'src', 'modules', 'ignored');
      const mountedModule = path.join(
        root,
        'src',
        'modules',
        'plugin fixture with space'
      );
      symlinkSync(pluginModule, mountedModule, 'dir');
      writeEntity(root, 'second-plugin-fixture', 'SecondEntity');
      const multiple = generate(root);
      expect(multiple).toContain(
        "from './modules/plugin fixture with space/entity/PluginEntity'"
      );
      expect(multiple).toContain(
        "from './modules/second-plugin-fixture/entity/SecondEntity'"
      );
      expect(generate(root)).toBe(multiple);

      unlinkSync(mountedModule);
      const afterRemoval = generate(root);
      expect(afterRemoval).not.toContain('plugin fixture with space');
      expect(afterRemoval).toContain('second-plugin-fixture');
      expect(existsSync(path.join(root, 'src', 'entities.plugin.ts'))).toBe(
        true
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(plugin, { recursive: true, force: true });
    }
  });

  it('拒绝模块实体目录中的二次 symlink，避免生成边界逃逸', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-runtime-entities-'));
    const outside = mkdtempSync(path.join(tmpdir(), 'pah-entity-outside-'));
    try {
      initializeHost(root);
      writeFileSync(path.join(outside, 'Escaped.ts'), 'export class Escaped {}\n');
      const entityRoot = path.join(
        root,
        'src',
        'modules',
        'unsafe-plugin',
        'entity'
      );
      mkdirSync(entityRoot, { recursive: true });
      symlinkSync(outside, path.join(entityRoot, 'nested'), 'dir');

      expect(() => generate(root)).toThrow(/实体目录内部不得包含符号链接/);
      expect(existsSync(path.join(root, 'src', 'entities.plugin.ts'))).toBe(
        false
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
