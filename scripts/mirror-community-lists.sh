#!/usr/bin/env sh
# 把线上最新社区快照镜像进仓库 community/lists/。
#
# 作用（公开审计留档）：官方 Worker 快照是权威数据源（扩展直接从 API 拉取，
# 不经 jsDelivr 或本仓库分发）；这里把线上快照以 git diff 形式留在公开仓库，
# 供人读、审计与构建期打包兜底（扩展随包内置 official.json）。
#
# 运行方式：发版前 / 名单大变化后在本地手动运行一次并提交（仓库没有云端 CI，不会自动跑）。
#
# 用法: scripts/mirror-community-lists.sh   （发版前 / 名单变化后运行并提交）
# API 地址: FEEDSIEVE_API 环境变量，或本地 ~/.config/feedsieve/api-base（0600）
set -e
cd "$(dirname "$0")/.."
# shellcheck source=lib/api-base.sh
. "$(dirname "$0")/lib/api-base.sh"
FEEDSIEVE_API_BASE_REQUIRED=1
resolve_feedsieve_api_base
API="$FEEDSIEVE_API_BASE"
DIR="community/lists"

# 网络：curl 带超时+重试，防端点挂起
CURL="curl -fsSL --max-time 60 --retry 3 --retry-delay 5"

$CURL "$API/v1/snapshots/latest" -o "$DIR/manifest.json"

version=$(node -p "JSON.parse(require('node:fs').readFileSync('$DIR/manifest.json', 'utf8')).snapshot_version")

node -e "
const m = JSON.parse(require('node:fs').readFileSync('$DIR/manifest.json', 'utf8'));
for (const f of m.files) console.log(f.path + '\t' + f.sha256);
" | while IFS="$(printf '\t')" read -r path sha; do
  $CURL "$API/v1/snapshots/$version/$path" -o "$DIR/$path"
  actual=$(shasum -a 256 "$DIR/$path" | cut -d' ' -f1)
  if [ "$actual" != "$sha" ]; then
    echo "error: checksum mismatch for $path (manifest=$sha actual=$actual)" >&2
    exit 1
  fi
  echo "mirrored $DIR/$path (v$version, sha256 ok)"
done

echo "done: git add $DIR && git commit（Actions 每天自动做；无变化时不要硬造空提交）"
