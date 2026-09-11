#!/usr/bin/env sh
# FeedSieve 全量线上数据管理封装（项目级 skill 配套脚本）。
# Key：$FEEDSIEVE_AGENT_KEY 优先，其次 ~/.config/feedsieve/agent.key（0600，不入库）。
# 用法见 SKILL.md；子命令：
#   status | assets [prefix] | audit [n] | releases
#   list | find <handle> | put <handle> <category> <note> [evidence_post_id] | remove <handle>
#   klist | kpack <id> <name_zh> <desc_zh> | krule <id> <pack_id> <phrase> [terms...] | kdel <pack|rule> <id> | kpub | kimport
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
AUTH=(-H "x-agent-key: $KEY")

CMD="$1"; shift || true
case "$CMD" in
  status)  curl -fsSL "${AUTH[@]}" "$BASE/api/agent/status" ;;
  assets)  curl -fsSL "${AUTH[@]}" "$BASE/api/agent/assets${1:+?prefix=$1}" ;;
  audit)   curl -fsSL "${AUTH[@]}" "$BASE/api/agent/audit?limit=${1:-50}" ;;
  releases) curl -fsSL "${AUTH[@]}" "$BASE/api/agent/releases" ;;
  snapshot) curl -fsSL "$BASE/v1/snapshots/latest" ;;

  list)    curl -fsSL "${AUTH[@]}" "$BASE/api/agent/entries" ;;
  put)     handle=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/^@//')
           category="${2:-bot_spam}"; note="${3:-Agent 维护条目}"; evidence="$4"
           body="{\"handle\":\"$handle\",\"category\":\"$category\",\"note\":\"$note\""
           if [ -n "$evidence" ]; then body="$body,\"evidence_post_id\":\"$evidence\""; fi
           body="$body}"
           curl -fsSL -X PUT "${AUTH[@]}" -H 'content-type: application/json' \
             -d "$body" "$BASE/api/agent/entries/$handle" ;;
  find)    handle=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/^@//')
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
           curl -fsSL "${AUTH[@]}" "$BASE/api/agent/entries" | python3 -c "
import json, sys
handle = '$handle'
data = json.load(sys.stdin)
hit = [e for e in data.get('entries', []) if e.get('handle') == handle]
if hit:
    print('maintainer draft:', json.dumps(hit[0], ensure_ascii=False))
else:
    print('maintainer draft: none')
" ;;
  remove)  curl -fsSL -X DELETE "${AUTH[@]}" "$BASE/api/agent/entries/$1" ;;

  klist)   curl -fsSL "${AUTH[@]}" "$BASE/api/agent/keywords" ;;
  kpack)   id="$1"; name="$2"; desc="$3"
           curl -fsSL -X PUT "${AUTH[@]}" -H 'content-type: application/json' \
             -d "{\"id\":\"$id\",\"name_zh\":\"$name\",\"description_zh\":\"$desc\"}" \
             "$BASE/api/agent/keywords/packs/$id" ;;
  krule)   id="$1"; pack_id="$2"; phrase="$3"
           curl -fsSL -X PUT "${AUTH[@]}" -H 'content-type: application/json' \
             -d "{\"id\":\"$id\",\"pack_id\":\"$pack_id\",\"phrase\":\"$phrase\"}" \
             "$BASE/api/agent/keywords/rules/$id" ;;
  kdel)    case "$1" in pack) path=packs ;; rule) path=rules ;; *) echo "kdel: kind must be pack|rule" >&2; exit 1 ;; esac
           curl -fsSL -X DELETE "${AUTH[@]}" "$BASE/api/agent/keywords/$path/$2" ;;
  kpub)    curl -fsSL -X POST "${AUTH[@]}" "$BASE/api/agent/keywords/publish" ;;
  kimport) curl -fsSL -X POST "${AUTH[@]}" "$BASE/api/agent/keywords/import" ;;

  *)
    echo "usage: $0 status|assets|audit|releases|list|find|put|remove|klist|kpack|krule|kdel|kpub|kimport" >&2
    exit 1
    ;;
esac
echo