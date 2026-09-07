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

# 防回滚在发布侧的镜像：远程 latest 已 >= 本地版本时拒绝，避免把最新指针顶回
# 客户端拒绝接收（rollback_rejected）的旧版本，比如 Worker 后台已发布更新时。
# API 不可达（离线发布）时告警继续；--force 可跳过该检查（如修复 latest 指针）。
# API 地址: FEEDSIEVE_API 环境变量，或本地 ~/.config/feedsieve/api-base（0600，不入库）
api_base="${FEEDSIEVE_API:-}"
if [ -z "$api_base" ] && [ -f "$HOME/.config/feedsieve/api-base" ]; then
  api_base="$(cat "$HOME/.config/feedsieve/api-base" 2>/dev/null || true)"
fi
latest_url="${api_base:+$api_base/v1/keyword-packs/latest}"
if [ -z "$latest_url" ]; then
  echo "warning: 未设置 FEEDSIEVE_API / api-base，跳过远程版本检查（无法访问 latest）"
  latest_url=""
fi
if [ "${1:-}" = "--force" ]; then
  echo "warning: --force given, skipping remote version check"
elif [ -n "$latest_url" ] && remote_version=$(curl -fsS --max-time 15 "$latest_url" 2>/dev/null \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const m=JSON.parse(s);process.stdout.write(typeof m.pack_version==='string'?m.pack_version:'')}catch{}})" \
    || true) && [ -n "$remote_version" ]; then
  node -e "
const a='$version'.split('.').map(Number), b='$remote_version'.split('.').map(Number);
if (a.length !== 4 || b.length !== 4) process.exit(0);
const cmp = a[0]-b[0] || a[1]-b[1] || a[2]-b[2] || a[3]-b[3];
if (cmp <= 0) { console.error('remote latest $remote_version >= local $version; refusing to move latest backwards. Bump pack_version in source.json, or publish through the admin console, or pass --force.'); process.exit(1); }
"
  echo "remote latest $remote_version < local $version (ok)"
else
  echo "warning: cannot reach $latest_url; skipping remote version check (offline publish)"
fi

pnpm exec wrangler r2 object put "$bucket/$prefix/official.json" --remote --file community/keyword-packs/official.json --content-type application/json
pnpm exec wrangler r2 object put "$bucket/keyword-packs/latest.json" --remote --file community/keyword-packs/manifest.json --content-type application/json
echo "published keyword packs v$version to r2://$bucket/keyword-packs/"
