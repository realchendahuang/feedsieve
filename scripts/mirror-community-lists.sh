#!/usr/bin/env sh
# 把线上最新社区快照镜像进仓库 community/lists/。
#
# 作用（治理承诺：GitHub 就是审计日志 + jsDelivr CDN 兜底）：
#   1. 每次名单变化都以 git diff 形式可见、可回溯
#   2. 公开仓库同时保留机器 JSON 和人类可读 YAML
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

echo "记得 git add $DIR && git commit，jsDelivr 随 main 分支更新"
