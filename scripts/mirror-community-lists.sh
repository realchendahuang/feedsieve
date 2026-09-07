#!/usr/bin/env sh
# 把线上最新社区快照镜像进仓库 community/lists/。
#
# 作用（公开审计留档）：官方 Worker 快照是权威数据源（扩展直接从 API 拉取，
# 不经 jsDelivr 或本仓库分发）；这里把线上快照以 git diff 形式留在公开仓库，
# 供人读、审计与构建期打包兜底（扩展随包内置 official.json）。
#
# 运行方式：GitHub Actions 每日 01:17 UTC 自动跑（无变化不提交），
# 发版前 / 名单大变化后也可手动在本地运行一次并提交。
#
# 用法: scripts/mirror-community-lists.sh   （发版前 / 名单变化后运行并提交）
# 环境变量: FEEDSIEVE_API（默认官方实例）
set -e
cd "$(dirname "$0")/.."

API="${FEEDSIEVE_API:-https://feedsieve-api.chendahuang.com}"
DIR="community/lists"

curl -fsSL "$API/v1/snapshots/latest" -o "$DIR/manifest.json"

version=$(python3 -c "import json; print(json.load(open('$DIR/manifest.json'))['snapshot_version'])")

python3 -c "
import json
for item in json.load(open('$DIR/manifest.json'))['files']:
    print(item['path'] + '\t' + item['sha256'])
" | while IFS="$(printf '\t')" read -r path sha; do
  curl -fsSL "$API/v1/snapshots/$version/$path" -o "$DIR/$path"
  actual=$(shasum -a 256 "$DIR/$path" | cut -d' ' -f1)
  if [ "$actual" != "$sha" ]; then
    echo "error: checksum mismatch for $path (manifest=$sha actual=$actual)" >&2
    exit 1
  fi
  echo "mirrored $DIR/$path (v$version, sha256 ok)"
done

echo "done: git add $DIR && git commit（Actions 每天自动做；无变化时不要硬造空提交）"
