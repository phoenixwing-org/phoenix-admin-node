import { cp, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const descriptorName = 'pah-plugin.artifacts.json';
const sourceModules = path.resolve('src/modules');
const targetModules = path.resolve('dist/modules');

async function isDirectory(target) {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

for (const entry of await readdir(sourceModules, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
  const moduleRoot = path.join(sourceModules, entry.name);
  const descriptorPath = path.join(moduleRoot, descriptorName);
  const migrationsPath = path.join(moduleRoot, 'migrations');
  const hasMigrations = await isDirectory(migrationsPath);
  let descriptor;
  try {
    descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'));
  } catch (error) {
    if (!hasMigrations && error?.code === 'ENOENT') continue;
    throw new Error(`Pah 插件 ${entry.name} 缺少或无法解析 ${descriptorName}`);
  }
  if (
    descriptor.formatVersion !== 1 ||
    descriptor.moduleId !== entry.name ||
    typeof descriptor.version !== 'string' ||
    !descriptor.version.trim()
  ) {
    throw new Error(`Pah 插件 ${entry.name} 的制品描述符不匹配`);
  }

  const targetRoot = path.join(targetModules, entry.name);
  await mkdir(targetRoot, { recursive: true });
  await cp(descriptorPath, path.join(targetRoot, descriptorName), {
    force: true,
  });
  if (hasMigrations) {
    await cp(migrationsPath, path.join(targetRoot, 'migrations'), {
      recursive: true,
      force: true,
    });
  }
}
