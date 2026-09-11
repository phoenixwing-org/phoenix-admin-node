const { EntryGenerator } = require('@midwayjs/bundle-helper');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const receiptFile = path.join(
  process.cwd(),
  '.runtime',
  'pah-plugin-compile.json'
);
if (!existsSync(receiptFile)) {
  throw new Error('缺少编译前插件健康收据；请先运行 entities:sync');
}
const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
if (receipt.formatVersion !== 1 || !Array.isArray(receipt.ignoredModuleIds)) {
  throw new Error('编译前插件健康收据无效');
}
const ignore = receipt.ignoredModuleIds.map(
  moduleId => `**/modules/${moduleId}/**`
);

new EntryGenerator({ ignore }).run();
process.stdout.write(
  `[phoenix-plugin-health] host=node phase=bundle ignored=${receipt.ignoredModuleIds.length}\n`
);
