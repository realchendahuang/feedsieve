#!/usr/bin/env bash
# 商店发布打包：全量门禁 -> 构建 zip -> manifest/内容审计 -> checksum。
# 产物：apps/extension/.output/feedsieve-v<version>-chrome.zip + .sha256（不入库）
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./apps/extension/package.json').version")
# API 地址: FEEDSIEVE_API 环境变量，或本地 ~/.config/feedsieve/api-base（0600，不入库）
. "$(dirname "$0")/lib/api-base.sh"
FEEDSIEVE_API_BASE_REQUIRED=1
resolve_feedsieve_api_base
API_BASE="$FEEDSIEVE_API_BASE"
OUT="apps/extension/.output"
ZIP="$OUT/feedsieve-${VERSION}-chrome.zip"

echo "==> pnpm verify（lint + typecheck + 全部测试 + 构建）"
pnpm verify

echo "==> wxt zip"
pnpm --filter @feedsieve/extension zip
[ -f "$ZIP" ] || { echo "✗ 未找到 $ZIP"; exit 1; }

echo "==> manifest 审计"
node - "$OUT/chrome-mv3/manifest.json" "$VERSION" "$API_BASE" <<'EOF'
const [manifestPath, version, apiBase] = process.argv.slice(2);
const fs = require('node:fs');
const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
const ok = (msg) => console.log(`✓ ${msg}`);
m.manifest_version === 3 || fail('manifest_version != 3');
m.version === version || fail(`版本不一致: manifest=${m.version} package=${version}`);
// 社区 API 走 CORS，不占主机权限；新增任何主机都会让 Chrome 升级时停用扩展
const hosts = [...(m.host_permissions ?? [])].sort();
JSON.stringify(hosts) === JSON.stringify(['https://x.com/*']) ||
  fail(`host_permissions 异常（只允许 x.com）: ${hosts.join(', ')}`);
ok(`MV3 · v${m.version} · host_permissions = x.com`);
// 构建产物里的 API 地址必须是官方实例（防 dev 覆盖泄进生产包）
const { execSync } = require('node:child_process');
const dir = require('node:path').dirname(manifestPath);
const hit = execSync(`grep -rlF ${JSON.stringify(apiBase)} ${JSON.stringify(dir)} || true`).toString().trim();
hit || fail(`构建产物里找不到 API 地址 ${apiBase}`);
const local = execSync(`grep -rlE "https?://(localhost|127\\.0\\.0\\.1)" ${JSON.stringify(dir)} --include=*.js || true`).toString().trim();
local && fail(`构建产物含本地地址: ${local}`);
ok(`API 地址 = ${apiBase}`);
const war = m.web_accessible_resources ?? [];
if (war.some(e => (e.resources ?? []).some(p => p.includes('community') || p === '*' || p === '**'))) {
  fail('随包检测数据不得通过 WAR 暴露；必须走后台缓存');
}
ok('随包检测数据仅由后台读取');
EOF

echo "==> ZIP 内容审计"
node - "$ZIP" <<'EOF'
const [zipPath] = process.argv.slice(2);
const { execSync } = require('node:child_process');
const files = execSync(`unzip -Z1 "${zipPath}"`).toString().split('\n').filter(Boolean);
const bad = files.filter((f) =>
  /(\.env|\.local\.|\.dev\.vars|secret|credential|id_rsa|password)/i.test(f),
);
if (bad.length) {
  console.error(`✗ 可疑文件: ${bad.join(', ')}`);
  process.exit(1);
}
console.log(`✓ ${files.length} 个文件，无 .env / 密钥 / 本地配置`);
EOF

echo "==> 随包数据资源审计"
node - "$ZIP" <<'EOF'
const [zipPath] = process.argv.slice(2);
const { execFileSync } = require('node:child_process');
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
const ok = (msg) => console.log(`✓ ${msg}`);
const read = (p) => {
  try {
    return JSON.parse(execFileSync('unzip', ['-p', zipPath, p], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
  } catch (e) {
    fail(`随包资源缺失或非法: ${p} (${e.message})`);
  }
};
const list = read('community/lists/official.json');
(Array.isArray(list.entries) && list.entries.length > 0 && typeof list.snapshot_version === 'string') ||
  fail('lists/official.json 结构异常');
ok(`名单快照 ${list.snapshot_version} · ${list.entries.length} 条`);
const pack = read('community/keyword-packs/official.json');
const ruleCount = (pack.packs ?? []).reduce((n, p) => n + (p.rules?.length ?? 0), 0);
ruleCount > 0 || fail('keyword-packs/official.json 无规则');
ok(`官方词库 ${pack.pack_version} · ${ruleCount} 条规则`);
const vt = read('community/keyword-packs/variant-tables.json');
for (const k of ['trad_simp', 'radicals', 'confusables']) {
  (vt[k] && Object.keys(vt[k]).length > 0) || fail(`variant-tables.json 缺 ${k}`);
}
ok(`变体表 简${Object.keys(vt.trad_simp).length}/部${Object.keys(vt.radicals).length}/混${Object.keys(vt.confusables).length}`);
EOF

echo "==> Chromium MV3 离线冷启动与恢复验收"
node scripts/smoke-extension-runtime.mjs

echo "==> SHA-256"
(cd "$OUT" && shasum -a 256 "feedsieve-${VERSION}-chrome.zip") |
  tee "$OUT/feedsieve-${VERSION}-chrome.zip.sha256"

echo ""
echo "商店包就绪：$ZIP"
echo "上传前：把 checksum 记入 docs/legacy/RELEASES.md，并确认构建自 v${VERSION} tag。"
