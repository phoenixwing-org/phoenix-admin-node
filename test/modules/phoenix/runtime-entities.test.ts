import { execFileSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  unlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { pahPluginRuntimeDigest } from '../../../src/modules/phoenix/service/runtime-activation';

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
  writeEntity(root, 'base', 'HostEntity');
  writeFileSync(
    path.join(root, 'src', 'entities.ts'),
    `import { pluginEntities } from './entities.plugin';\n` +
      `import * as hostEntity from './modules/base/entity/HostEntity';\n` +
      `export const entities = [...Object.values(hostEntity), ...pluginEntities];\n`
  );
  writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'es2018',
        module: 'commonjs',
        rootDir: 'src',
        outDir: 'dist',
      },
    })
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

function activateReleaseModule(
  root: string,
  moduleId: string,
  pluginType: string | null = null
) {
  const moduleRoot = path.join(root, 'src', 'modules', moduleId);
  writeFileSync(path.join(moduleRoot, 'config.ts'), 'export default () => ({});\n');
  const digest = pahPluginRuntimeDigest(moduleRoot);
  const directory = path.join(
    root,
    '.runtime',
    'phoenix-plugin-activation',
    'receipts'
  );
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, `${moduleId}.json`),
    JSON.stringify({
      formatVersion: 1,
      moduleId,
      version: '1.0.0',
      pluginType,
      packageSha256: 'a'.repeat(64),
      manifestSha256: createHash('sha256').update(moduleId).digest('hex'),
      payloads: { node: digest, vue: digest },
    })
  );
}

function mountDevelopmentProduct(
  hostRoot: string,
  moduleId: string,
  options: { branding?: boolean; dirty?: boolean } = {}
) {
  const productRoot = mkdtempSync(path.join(tmpdir(), 'pah-product-entities-'));
  const packageRoot = path.join(productRoot, 'packages', 'admin-plugin');
  const nodeSource = path.join(packageRoot, 'midway', moduleId);
  const webSource = path.join(packageRoot, 'vue', moduleId);
  mkdirSync(path.join(nodeSource, 'entity'), { recursive: true });
  writeFileSync(
    path.join(nodeSource, 'entity', 'PluginEntity.ts'),
    'export class PluginEntity {}\n'
  );
  writeFileSync(path.join(nodeSource, 'config.ts'), 'export default () => ({});\n');
  mkdirSync(webSource, { recursive: true });
  writeFileSync(path.join(webSource, 'config.ts'), 'export default () => ({});\n');
  writeFileSync(
    path.join(packageRoot, 'manifest.json'),
    JSON.stringify({
      formatVersion: 2,
      ...(options.branding ? { pluginType: 'phoenix.admin.branding' } : {}),
      moduleId,
      version: '1.0.0',
      activationMode: 'restart',
      entrypoints: {
        node: `midway/${moduleId}/config.ts`,
        web: `vue/${moduleId}/config.ts`,
      },
    })
  );
  execFileSync('git', ['init', '-q'], { cwd: productRoot });
  execFileSync('git', ['add', '.'], { cwd: productRoot });
  execFileSync(
    'git',
    ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture'],
    { cwd: productRoot }
  );
  if (options.dirty) {
    writeFileSync(path.join(nodeSource, 'config.ts'), 'export default () => ({ dirty: true });\n');
  }
  symlinkSync(nodeSource, path.join(hostRoot, 'src', 'modules', moduleId), 'dir');
  return productRoot;
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

  it('开发命令在 watcher 前同步一次，运行子进程不重复改写清单', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')
    );
    const configuration = readFileSync(
      path.join(repositoryRoot, 'src', 'configuration.ts'),
      'utf8'
    );
    for (const scriptName of ['dev', 'dev:midway4']) {
      expect(manifest.scripts[scriptName]).toContain(
        'node scripts/pah-sync-runtime-entities.cjs'
      );
      expect(manifest.scripts[scriptName]).toContain(
        'PAH_RUNTIME_ENTITIES_PREPARED=true'
      );
    }
    expect(configuration).toContain(
      "process.env.PAH_RUNTIME_ENTITIES_PREPARED !== 'true'"
    );
  });

  it('纯 Host 忽略未知 symlink 与无收据普通目录，并支持确定性冷生成', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-runtime-entities-'));
    const plugin = mkdtempSync(path.join(tmpdir(), 'pah-plugin-entities-'));
    try {
      initializeHost(root);
      const empty = generate(root);
      expect(empty).not.toContain('import * as entity');
      expect(empty).not.toContain('modules/base/entity/HostEntity');

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
      expect(multiple).not.toContain('plugin fixture with space');
      expect(multiple).not.toContain('second-plugin-fixture');
      expect(generate(root)).toBe(multiple);

      unlinkSync(mountedModule);
      const afterRemoval = generate(root);
      expect(afterRemoval).not.toContain('plugin fixture with space');
      expect(afterRemoval).not.toContain('second-plugin-fixture');
      expect(existsSync(path.join(root, 'src', 'entities.plugin.ts'))).toBe(
        true
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(plugin, { recursive: true, force: true });
    }
  });

  it('内容未变化时不重写运行时清单，避免 watch 自触发重启', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-runtime-entities-'));
    try {
      initializeHost(root);
      generate(root);
      const generatedFiles = [
        path.join(root, 'src', 'entities.plugin.ts'),
        path.join(root, '.runtime', 'tsconfig.phoenix.json'),
        path.join(root, '.runtime', 'pah-plugin-compile.json'),
      ];
      const inodes = generatedFiles.map(file => statSync(file).ino);

      generate(root);

      expect(generatedFiles.map(file => statSync(file).ino)).toEqual(inodes);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('正式 payload 仅在可信激活收据与当前字节一致时聚合实体', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-runtime-release-'));
    try {
      initializeHost(root);
      writeEntity(root, 'release-plugin', 'ReleaseEntity');
      activateReleaseModule(root, 'release-plugin');

      expect(generate(root)).toContain(
        'release-plugin/entity/ReleaseEntity'
      );

      writeFileSync(
        path.join(
          root,
          'src',
          'modules',
          'release-plugin',
          'entity',
          'ReleaseEntity.ts'
        ),
        'export class TamperedReleaseEntity {}\n'
      );
      expect(generate(root)).not.toContain('release-plugin');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('拒绝模块实体目录中的二次 symlink，避免生成边界逃逸', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-runtime-entities-'));
    const outside = mkdtempSync(path.join(tmpdir(), 'pah-entity-outside-'));
    let product: string | undefined;
    try {
      initializeHost(root);
      product = mountDevelopmentProduct(root, 'unsafe-plugin');
      writeFileSync(path.join(outside, 'Escaped.ts'), 'export class Escaped {}\n');
      const entityRoot = path.join(
        product,
        'packages',
        'admin-plugin',
        'midway',
        'unsafe-plugin',
        'entity'
      );
      symlinkSync(outside, path.join(entityRoot, 'nested'), 'dir');
      execFileSync('git', ['add', '.'], { cwd: product });
      execFileSync(
        'git',
        ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'nested link'],
        { cwd: product }
      );

      expect(() => generate(root)).not.toThrow();
      expect(existsSync(path.join(root, 'src', 'entities.plugin.ts'))).toBe(
        true
      );
      expect(
        readFileSync(path.join(root, 'src', 'entities.plugin.ts'), 'utf8')
      ).not.toContain('unsafe-plugin');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
      if (product) rmSync(product, { recursive: true, force: true });
    }
  });

  it('启动隔离模块不会进入动态实体清单', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-runtime-entities-'));
    const products: string[] = [];
    try {
      initializeHost(root);
      products.push(mountDevelopmentProduct(root, 'healthy-plugin'));
      products.push(mountDevelopmentProduct(root, 'quarantined-plugin'));

      execFileSync(
        process.execPath,
        [
          generator,
          '--root',
          root,
          '--ignore-module',
          'quarantined-plugin',
        ],
        { cwd: repositoryRoot, stdio: 'pipe' }
      );
      const content = readFileSync(
        path.join(root, 'src', 'entities.plugin.ts'),
        'utf8'
      );
      expect(content).toContain('healthy-plugin/entity/PluginEntity');
      expect(content).not.toContain('quarantined-plugin');
    } finally {
      rmSync(root, { recursive: true, force: true });
      for (const product of products) rmSync(product, { recursive: true, force: true });
    }
  });

  it('安全品牌模块也由 Host 显式排除实体聚合', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-runtime-entities-'));
    try {
      initializeHost(root);
      writeEntity(root, 'phoenix-branding', 'UnexpectedBrandEntity');
      activateReleaseModule(
        root,
        'phoenix-branding',
        'phoenix.admin.branding'
      );
      generate(root);
      expect(
        readFileSync(path.join(root, 'src', 'entities.plugin.ts'), 'utf8')
      ).not.toContain('phoenix-branding');
      expect(
        JSON.parse(
          readFileSync(
            path.join(root, '.runtime', 'pah-plugin-compile.json'),
            'utf8'
          )
        ).inspections
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            moduleId: 'phoenix-branding',
            state: 'ready',
            detail: expect.stringContaining('policy=no-entities'),
          }),
        ])
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('编译前只聚合 clean 业务开发挂载，dirty 与品牌挂载 fail-closed', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-runtime-entities-'));
    const products: string[] = [];
    try {
      initializeHost(root);
      products.push(mountDevelopmentProduct(root, 'clean-plugin'));
      products.push(mountDevelopmentProduct(root, 'dirty-plugin', { dirty: true }));
      products.push(mountDevelopmentProduct(root, 'brand-plugin', { branding: true }));
      const content = generate(root);
      expect(content).toContain('clean-plugin/entity/PluginEntity');
      expect(content).not.toContain('dirty-plugin');
      expect(content).not.toContain('brand-plugin');
      expect(
        JSON.parse(
          readFileSync(
            path.join(root, '.runtime', 'pah-plugin-compile.json'),
            'utf8'
          )
        ).inspections
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            moduleId: 'brand-plugin',
            state: 'ready',
            detail: expect.stringContaining('policy=no-entities'),
          }),
        ])
      );
      expect(
        JSON.parse(
          readFileSync(
            path.join(root, '.runtime', 'tsconfig.phoenix.json'),
            'utf8'
          )
        ).exclude
      ).toEqual(
        expect.arrayContaining([
          '../src/modules/dirty-plugin/**/*',
          '../src/modules/brand-plugin/**/*',
        ])
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      for (const product of products) rmSync(product, { recursive: true, force: true });
    }
  });

  it('用 eligible 映射选择实体，全部卸载后原子恢复空清单', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pah-runtime-entities-'));
    const products: string[] = [];
    try {
      initializeHost(root);
      products.push(mountDevelopmentProduct(root, 'issue-plugin'));
      products.push(
        mountDevelopmentProduct(root, 'function-plugin', { dirty: true })
      );

      const selected = generate(root);
      const firstReceipt = JSON.parse(
        readFileSync(
          path.join(root, '.runtime', 'pah-plugin-compile.json'),
          'utf8'
        )
      ) as {
        inspections: Array<{ moduleId: string; eligible: boolean }>;
      };
      const validMap = Object.fromEntries(
        firstReceipt.inspections.map(item => [item.moduleId, item.eligible])
      );

      expect(validMap).toEqual({
        'function-plugin': false,
        'issue-plugin': true,
      });
      expect(selected).toContain('issue-plugin/entity/PluginEntity');
      expect(selected).not.toContain('function-plugin');

      unlinkSync(path.join(root, 'src', 'modules', 'issue-plugin'));
      unlinkSync(path.join(root, 'src', 'modules', 'function-plugin'));
      const afterUnmount = generate(root);
      expect(afterUnmount).toBe(
        '// 自动生成的插件实体清单，请勿手动修改\n' +
          'export const pluginEntities = [];\n'
      );
      expect(
        JSON.parse(
          readFileSync(
            path.join(root, '.runtime', 'pah-plugin-compile.json'),
            'utf8'
          )
        ).inspections
      ).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      for (const product of products) {
        rmSync(product, { recursive: true, force: true });
      }
    }
  });
});
