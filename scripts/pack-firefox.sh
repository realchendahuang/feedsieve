#!/usr/bin/env bash
# Firefox / AMO 发布打包：构建 -> manifest 校验 -> web-ext lint -> zip -> 完整源码 zip。
# 产物（不入库）：
#   apps/extension/.output/feedsieve-<version>-firefox.zip
#   apps/extension/.output/feedsieve-<version>-firefox-source.zip
#   *.sha256
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./apps/extension/package.json').version")
OUT="apps/extension/.output"
ZIP="$OUT/feedsieve-${VERSION}-firefox.zip"
SOURCE="$OUT/feedsieve-${VERSION}-firefox-source.zip"

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

echo "==> 构建 Firefox MV3"
pnpm --filter @feedsieve/extension build:firefox
pnpm check:extension:firefox

echo "==> web-ext lint"
npx --yes web-ext@10 lint --source-dir "$OUT/firefox-mv3" --output json > "$OUT/web-ext-lint.json" || true
node - "$OUT/web-ext-lint.json" <<'EOF'
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const errors = report.errors ?? [];
const warnings = report.warnings ?? [];
if (errors.length > 0) {
  console.error('✗ web-ext lint 有错误：');
  for (const error of errors) console.error(` - ${error.message}`);
  process.exit(1);
}
console.log(`✓ web-ext lint 0 errors · ${warnings.length} warnings`);
EOF

echo "==> 打包扩展"
pnpm --filter @feedsieve/extension zip:firefox
[ -f "$ZIP" ] || fail "未找到 $ZIP"

echo "==> ZIP 内容审计"
node - "$ZIP" <<'EOF'
const [zipPath] = process.argv.slice(2);
const { execSync } = require('node:child_process');
const files = execSync(`unzip -Z1 "${zipPath}"`).toString().split('\n').filter(Boolean);
const bad = files.filter((file) =>
  /(\.env|\.local\.|\.dev\.vars|secret|credential|id_rsa|password)/i.test(file),
);
if (bad.length) {
  console.error(`✗ 可疑文件: ${bad.join(', ')}`);
  process.exit(1);
}
if (!files.includes('manifest.json')) {
  console.error('✗ manifest.json 不在 zip 根目录');
  process.exit(1);
}
console.log(`✓ ${files.length} 个文件，无 .env / 密钥 / 本地配置`);
EOF

echo "==> 完整源码包（AMO 审核用）"
rm -f "$SOURCE"
zip -rq "$SOURCE" \
  apps/extension \
  packages \
  community \
  package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json \
  LICENSE PRIVACY.md docs/FIREFOX.md docs/FIREFOX-AMO-BUILD.md \
  -x '*/node_modules/*' \
     'apps/extension/.output/*' \
     'apps/extension/public/community/*' \
     'apps/extension/stats.html' \
     '*/dist/*' \
     '*/.wrangler/*' \
     '*.zip' \
     '*.sha256' \
     '*.env' \
     '*/.env*' \
     '*/.secrets/*'

node - "$SOURCE" <<'EOF'
const [zipPath] = process.argv.slice(2);
const { execSync } = require('node:child_process');
const files = execSync(`unzip -Z1 "${zipPath}"`).toString().split('\n').filter(Boolean);
const has = (prefix) => files.some((file) => file.startsWith(prefix));
const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};
has('apps/extension/entrypoints/') || fail('源码包缺 apps/extension/entrypoints');
has('packages/') || fail('源码包缺 workspace packages');
has('community/lists/official.json') || fail('源码包缺名单快照');
has('pnpm-lock.yaml') || fail('源码包缺 pnpm-lock.yaml');
has('docs/FIREFOX-AMO-BUILD.md') || fail('源码包缺构建说明');
if (files.some((file) => file.includes('node_modules/') || file.includes('.output/'))) {
  fail('源码包混入了 node_modules / .output');
}
console.log(`✓ 源码包 ${files.length} 个文件，含 workspace packages 与构建说明`);
EOF

echo "==> SHA-256"
(cd "$OUT" && shasum -a 256 "feedsieve-${VERSION}-firefox.zip") |
  tee "$OUT/feedsieve-${VERSION}-firefox.zip.sha256"
(cd "$OUT" && shasum -a 256 "feedsieve-${VERSION}-firefox-source.zip") |
  tee "$OUT/feedsieve-${VERSION}-firefox-source.zip.sha256"

echo ""
echo "Firefox 包就绪：$ZIP"
echo "AMO 源码包：$SOURCE"
echo "上传前：这是官方新条目（feedsieve@feedsieve.win），不要更新 AMO 上第三方的 .local 条目。"
