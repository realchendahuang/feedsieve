#!/usr/bin/env sh
# FeedSieve 维护者名单 Agent API 封装（项目级，与 feedsieve-admin 同源）。
# Key 读取：$FEEDSIEVE_AGENT_KEY 优先，其次 ~/.config/feedsieve/agent.key（0600）。
# API 地址：$FEEDSIEVE_API 优先，其次 ~/.config/feedsieve/api-base（0600）；绝不硬编码真实域名。
# 用法:
#   m.sh list                                  维护者条目（含已撤销）
#   m.sh find <handle>                         查 handle 是否已在公开名单 / 维护者条目
#   m.sh put <handle> <category> <note> [evidence_post_id]
#   m.sh remove <handle>
#   m.sh snapshot                              当前公开快照清单
set -e

BASE="${FEEDSIEVE_API:-$(cat "$HOME/.config/feedsieve/api-base" 2>/dev/null || true)}"
if [ -z "$BASE" ]; then
  echo "error: 未设置 API 地址（export FEEDSIEVE_API 或写 ~/.config/feedsieve/api-base）" >&2
  exit 1
fi
KEY_FILE="${FEEDSIEVE_AGENT_KEY_FILE:-$HOME/.config/feedsieve/agent.key}"
KEY="${FEEDSIEVE_AGENT_KEY:-$(cat "$KEY_FILE" 2>/dev/null || true)}"
if [ -z "$KEY" ]; then
  echo "error: no agent key (set FEEDSIEVE_AGENT_KEY or $KEY_FILE)" >&2
  exit 1
fi

norm() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/^@//'; }

CMD="$1"
shift || true
case "$CMD" in
  list)
    curl -fsSL -H "x-agent-key: $KEY" "$BASE/api/agent/entries"
    ;;
  find)
    handle=$(norm "$1")
    json=$(curl -fsSL "$BASE/v1/snapshots/latest")
    ver=$(printf '%s' "$json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["snapshot_version"])')
    echo "snapshot: $ver"
    curl -fsSL "$BASE/v1/snapshots/$ver/official.json" | python3 -c "
import json, sys
handle = '$handle'
data = json.load(sys.stdin)
hit = [e for e in data.get('entries', []) if e.get('handle') == handle]
if hit:
    e = hit[0]
    print('public: IN LIST  category=%s sources=%s net_votes=%s' % (
        e.get('category'), ','.join(e.get('sources', [])), e.get('net_votes')))
    if e.get('maintainer_note'):
        print('  note:', e['maintainer_note'])
else:
    print('public: not in list')
"
    curl -fsSL -H "x-agent-key: $KEY" "$BASE/api/agent/entries" | python3 -c "
import json, sys
handle = '$handle'
data = json.load(sys.stdin)
hit = [e for e in data.get('entries', []) if e.get('handle') == handle]
if hit:
    print('maintainer draft:', json.dumps(hit[0], ensure_ascii=False))
else:
    print('maintainer draft: none')
"
    ;;
  put)
    # 服务端按小写 handle 匹配路径与 body，必须先归一化再写
    handle=$(norm "$1")
    category="${2:-bot_spam}"
    note="${3:-Agent 维护条目}"
    evidence="$4"
    body="{\"handle\":\"$handle\",\"category\":\"$category\",\"note\":\"$note\""
    if [ -n "$evidence" ]; then
      body="$body,\"evidence_post_id\":\"$evidence\""
    fi
    body="$body}"
    curl -fsSL -X PUT \
      -H "x-agent-key: $KEY" \
      -H 'content-type: application/json' \
      -d "$body" \
      "$BASE/api/agent/entries/$handle"
    ;;
  remove)
    curl -fsSL -X DELETE -H "x-agent-key: $KEY" "$BASE/api/agent/entries/$1"
    ;;
  snapshot)
    curl -fsSL "$BASE/v1/snapshots/latest"
    ;;
  *)
    echo "usage: m.sh list | find <handle> | put <handle> <category> <note> [evidence_post_id] | remove <handle> | snapshot" >&2
    exit 1
    ;;
esac
echo