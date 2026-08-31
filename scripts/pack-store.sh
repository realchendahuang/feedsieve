#!/usr/bin/env bash
# 商店发布打包：全量门禁 -> 构建 zip -> manifest/内容审计 -> checksum。
# 产物：apps/extension/.output/feedsieve-v<version>-chrome.zip + .sha256（不入库）
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./apps/extension/package.json').version")
API_BASE="https://feedsieve-api.chendahuang.com"
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
const hosts = [...(m.host_permissions ?? [])].sort();
const expected = [`${apiBase}/*`, 'https://x.com/*'].sort();
JSON.stringify(hosts) === JSON.stringify(expected) ||
  fail(`host_permissions 异常: ${hosts.join(', ')}`);
ok(`MV3 · v${m.version} · host_permissions = x.com + 官方 API`);
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

echo "==> SHA-256"
(cd "$OUT" && shasum -a 256 "feedsieve-${VERSION}-chrome.zip") |
  tee "$OUT/feedsieve-${VERSION}-chrome.zip.sha256"

echo ""
echo "商店包就绪：$ZIP"
echo "上传前：把 checksum 记入 docs/RELEASES.md，并确认构建自 v${VERSION} tag。"
