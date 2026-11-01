import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve('apps/extension/.output/firefox-mv3');
const manifest = JSON.parse(readFileSync(resolve(output, 'manifest.json'), 'utf8'));

assert.equal(manifest.manifest_version, 3);

const gecko = manifest.browser_specific_settings?.gecko;
// 必须和 AMO 上已存在的 feedsieve 条目（0.8.2，slug=feedsieve）一致；AMO 首次提交后不可改。
assert.equal(gecko?.id, 'feedsieve@feedsieve.local');
assert.equal(gecko?.strict_min_version, '140.0');
assert.deepEqual(gecko?.data_collection_permissions?.required, [
  'websiteContent',
  'websiteActivity',
  'personallyIdentifyingInfo',
  'authenticationInfo',
]);
// Android 端侧边栏 / 弹窗未验收，暂不声明 gecko_android。
assert.equal(manifest.browser_specific_settings?.gecko_android, undefined);

// Firefox MV3 用 background.scripts；出现 service_worker 说明构建目标错了。
assert.ok(manifest.background?.scripts?.length > 0, 'background.scripts 为空');
assert.equal(manifest.background?.service_worker, undefined);

// Firefox 没有 sidePanel：权限里不能有，界面走 sidebar_action。
assert.deepEqual([...manifest.permissions].sort(), ['storage', 'unlimitedStorage']);
assert.equal(manifest.permissions.includes('sidePanel'), false);
assert.equal(manifest.side_panel, undefined);
assert.equal(manifest.sidebar_action?.default_panel, 'popup.html');

assert.deepEqual([...manifest.host_permissions].sort(), ['https://x.com/*']);

const bridge = manifest.content_scripts?.find((script) => script.world === 'MAIN');
assert.ok(bridge, 'MAIN world 网络桥缺失');
assert.equal(bridge.run_at, 'document_start');
assert.deepEqual(bridge.matches, ['https://x.com/*']);

for (const file of [
  manifest.action?.default_popup,
  ...manifest.background.scripts,
  ...manifest.content_scripts.flatMap((script) => script.js),
].filter(Boolean)) {
  assert.ok(existsSync(resolve(output, file)), `缺少入口文件：${file}`);
}

console.log('Firefox MV3 manifest and entrypoints verified');
