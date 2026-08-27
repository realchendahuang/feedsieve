#!/usr/bin/env sh
# FeedSieve 社区后台管理 CLI（依赖 sh + curl，无其他依赖）。
#
# 用法:
#   ./admin.sh health                    检查服务存活
#   ./admin.sh candidates                待审队列（new + candidate，按票数降序）
#   ./admin.sh promote <handle> <status> 人工提升/驳回，status ∈ recommended|strong|dismissed
#   ./admin.sh publish                   生成并发布新快照版本
#
# 环境变量:
#   FEEDSIEVE_API          默认 https://feedsieve-api.chendahuang.com
#   FEEDSIEVE_ADMIN_TOKEN  admin 令牌；未设置时回退读 ~/.feedsieve-secrets.txt
set -e

API="${FEEDSIEVE_API:-https://feedsieve-api.chendahuang.com}"
TOKEN="${FEEDSIEVE_ADMIN_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$HOME/.feedsieve-secrets.txt" ]; then
  TOKEN=$(grep '^ADMIN_TOKEN=' "$HOME/.feedsieve-secrets.txt" | cut -d= -f2)
fi
if [ -z "$TOKEN" ]; then
  echo "error: 设置 FEEDSIEVE_ADMIN_TOKEN 或创建 ~/.feedsieve-secrets.txt" >&2
  exit 1
fi
AUTH="authorization: Bearer $TOKEN"

cmd="${1:-help}"
case "$cmd" in
  health)
    curl -sS "$API/healthz"
    ;;
  candidates)
    curl -sS -H "$AUTH" "$API/admin/candidates"
    ;;
  promote)
    handle="${2:-}"
    status="${3:-}"
    if [ -z "$handle" ] || [ -z "$status" ]; then
      echo "用法: admin.sh promote <handle> <recommended|strong|dismissed>" >&2
      exit 1
    fi
    curl -sS -X POST -H "$AUTH" -H 'content-type: application/json' \
      -d "{\"handle\":\"$handle\",\"status\":\"$status\"}" \
      "$API/admin/promote"
    ;;
  publish)
    curl -sS -X POST -H "$AUTH" "$API/admin/publish"
    ;;
  *)
    echo "用法: admin.sh <health|candidates|promote <handle> <status>|publish>" >&2
    exit 1
    ;;
esac
echo
