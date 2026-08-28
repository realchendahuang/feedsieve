#!/usr/bin/env sh
# 把线上最新社区快照镜像进仓库 community/lists/。
#
# 作用（治理承诺：GitHub 就是审计日志 + jsDelivr CDN 兜底）：
#   1. 每次名单变化都以 git diff 形式可见、可回溯
#   2. Worker 不可达时，扩展从 jsDelivr 读这里的最近一次提交
#
# 用法: scripts/mirror-community-lists.sh   （发版前 / 名单变化后运行并提交）
# 环境变量: FEEDSIEVE_API（默认官方实例）
set -e
cd "$(dirname "$0")/.."

API="${FEEDSIEVE_API:-https://feedsieve-api.chendahuang.com}"
DIR="community/lists"

curl -fsSL "$API/v1/snapshots/latest" -o "$DIR/manifest.json"

read -r version path sha <<EOF
$(python3 -c "
import json
m = json.load(open('$DIR/manifest.json'))
f = m['files'][0]
print(m['snapshot_version'], f['path'], f['sha256'])
")
EOF

curl -fsSL "$API/v1/snapshots/$version/$path" -o "$DIR/$path"

actual=$(shasum -a 256 "$DIR/$path" | cut -d' ' -f1)
if [ "$actual" != "$sha" ]; then
  echo "error: checksum mismatch (manifest=$sha actual=$actual)" >&2
  exit 1
fi

echo "mirrored $DIR/$path (v$version, sha256 ok)"
echo "记得 git add $DIR && git commit，jsDelivr 随 main 分支更新"
