#!/usr/bin/env sh
# 发布已审计的词库生成物到 R2。它不改词库内容；先提交 source.json + 生成物，再运行本脚本。
# manifest 必须带发布者签名（build-keyword-packs.mjs 在有密钥文件时自动嵌入），
# 扩展侧验签后才接受 —— R2 是公开存储，签名是发布者身份的唯一证明。
set -eu
cd "$(dirname "$0")/.."
pnpm keyword-packs:check

version=$(node -e "console.log(require('./community/keyword-packs/manifest.json').pack_version)")
bucket="${FEEDSIEVE_KEYWORD_R2_BUCKET:-feedsieve-keyword-packs}"
prefix="keyword-packs/$version"

node -e "
const m = require('./community/keyword-packs/manifest.json');
if (!m.signature) { console.error('manifest 未签名，拒绝发布：先确认 .secrets/ 存在密钥文件并重跑 pnpm keyword-packs:build'); process.exit(1); }
console.log('manifest signed by', m.signature.key_id);
"

pnpm exec wrangler r2 object put "$bucket/$prefix/official.json" --remote --file community/keyword-packs/official.json --content-type application/json
pnpm exec wrangler r2 object put "$bucket/keyword-packs/latest.json" --remote --file community/keyword-packs/manifest.json --content-type application/json
echo "published keyword packs v$version to r2://$bucket/keyword-packs/"
