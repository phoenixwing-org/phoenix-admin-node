import { CoolCommException } from '@cool-midway/core';
import { existsSync, readFileSync, realpathSync } from 'fs';
import * as path from 'path';

export function resolvePahHostRoots() {
  const nodeRoot = realpathSync(
    path.resolve(process.env.PHOENIX_ADMIN_NODE_ROOT || process.cwd())
  );
  const nodePackage = JSON.parse(
    readFileSync(path.join(nodeRoot, 'package.json'), 'utf8')
  );
  if (nodePackage.name !== 'phoenix-admin-node') {
    throw new CoolCommException('当前目录不是 Phoenix Admin Node Host');
  }
  const vueCandidates = process.env.PHOENIX_ADMIN_VUE_ROOT
    ? [path.resolve(process.env.PHOENIX_ADMIN_VUE_ROOT)]
    : [
        path.resolve(nodeRoot, '../vue'),
        path.resolve(nodeRoot, '../phoenix-admin-vue'),
      ];
  const vueRoot = vueCandidates.find(candidate => {
    try {
      const packageFile = path.join(candidate, 'package.json');
      return (
        existsSync(packageFile) &&
        JSON.parse(readFileSync(packageFile, 'utf8')).name ===
          'phoenix-admin-vue'
      );
    } catch {
      return false;
    }
  });
  if (!vueRoot) {
    throw new CoolCommException(
      `未找到成对的 Phoenix Admin Vue 本地 Host；已检查：${vueCandidates.join(
        '、'
      )}`
    );
  }
  return { nodeRoot, vueRoot: realpathSync(vueRoot) };
}
