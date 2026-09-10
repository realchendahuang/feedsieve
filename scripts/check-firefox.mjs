import assert from 'node:assert/strict';
import console from 'node:console';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve('apps/extension/.output/firefox-mv3');
const manifest = JSON.parse(readFileSync(resolve(output, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.browser_specific_settings?.gecko?.id, 'feedsieve@chendahuang.com');
assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, '140.0');
assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, [
  'websiteContent',
  'websiteActivity',
  'personallyIdentifyingInfo',
  'authenticationInfo',
]);
assert.ok(manifest.background.scripts.length > 0);
assert.equal(manifest.background.service_worker, undefined);
assert.equal(manifest.browser_specific_settings.gecko_android.strict_min_version, '142.0');
assert.deepEqual(manifest.host_permissions.toSorted(), [
  'https://feedsieve-api.chendahuang.com/*',
  'https://x.com/*',
]);
const bridge = manifest.content_scripts.find((script) => script.world === 'MAIN');
assert.ok(bridge, 'The network bridge must run in the page world');
assert.equal(bridge.run_at, 'document_start');
assert.deepEqual(bridge.matches, ['https://x.com/*']);
for (const file of [
  manifest.action.default_popup,
  ...manifest.background.scripts,
  ...manifest.content_scripts.flatMap((script) => script.js),
]) {
  assert.ok(existsSync(resolve(output, file)), `Missing entrypoint: ${file}`);
}
console.log('Firefox MV3 manifest and entrypoints verified');
