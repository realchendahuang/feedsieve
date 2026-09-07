#!/usr/bin/env sh
# FeedSieve 全量线上数据管理封装（项目级 skill 配套脚本）。
# Key：$FEEDSIEVE_AGENT_KEY 优先，其次 ~/.config/feedsieve/agent.key（0600，不入库）。
# 用法见 SKILL.md；子命令：
#   status | assets [prefix] | audit [n] | releases
#   list | put <handle> <category> <note> | remove <handle>
#   klist | kpack <id> <name_zh> <desc_zh> | krule <id> <pack_id> <phrase> [terms...] | kdel <pack|rule> <id> | kpub | kimport
set -e

BASE="${FEEDSIEVE_API:-https://feedsieve-api.chendahuang.com}"
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
  put)     handle="$1"; category="${2:-bot_spam}"; note="${3:-Agent 维护条目}"
           curl -fsSL -X PUT "${AUTH[@]}" -H 'content-type: application/json' \
             -d "{\"handle\":\"$handle\",\"category\":\"$category\",\"note\":\"$note\"}" \
             "$BASE/api/agent/entries/$handle" ;;
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
  kdel)    curl -fsSL -X DELETE "${AUTH[@]}" "$BASE/api/agent/keywords/$1/$2" ;;
  kpub)    curl -fsSL -X POST "${AUTH[@]}" "$BASE/api/agent/keywords/publish" ;;
  kimport) curl -fsSL -X POST "${AUTH[@]}" "$BASE/api/agent/keywords/import" ;;

  *)
    echo "usage: $0 status|assets|audit|releases|list|put|remove|klist|kpack|krule|kdel|kpub|kimport" >&2
    exit 1
    ;;
esac
echo