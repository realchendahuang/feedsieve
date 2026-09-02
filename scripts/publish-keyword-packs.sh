#!/usr/bin/env sh
# 发布已审计的词库生成物到 R2。它不改词库内容；先提交 source.json + 生成物，再运行本脚本。
set -eu
cd "$(dirname "$0")/.."
pnpm keyword-packs:check

version=$(node -e "console.log(require('./community/keyword-packs/manifest.json').pack_version)")
bucket="${FEEDSIEVE_KEYWORD_R2_BUCKET:-feedsieve-keyword-packs}"
prefix="keyword-packs/$version"

pnpm exec wrangler r2 object put "$bucket/$prefix/official.json" --remote --file community/keyword-packs/official.json --content-type application/json
pnpm exec wrangler r2 object put "$bucket/keyword-packs/latest.json" --remote --file community/keyword-packs/manifest.json --content-type application/json
echo "published keyword packs v$version to r2://$bucket/keyword-packs/"
