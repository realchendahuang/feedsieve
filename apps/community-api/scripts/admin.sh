#!/usr/bin/env sh
# FeedSieve 社区后台管理 CLI（依赖 sh + curl，无其他依赖）。
#
# 用法:
#   ./admin.sh health                    检查服务存活
#   ./admin.sh candidates                待审队列（只读，透明度用）
#   ./admin.sh false-positives           误标反馈（按规则汇总 + 最近记录）
#   ./admin.sh publish                   生成并发布新快照版本（cron 已自动跑，手动是保险丝）
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
  false-positives)
    curl -sS -H "$AUTH" "$API/admin/false-positives"
    ;;
  publish)
    curl -sS -X POST -H "$AUTH" "$API/admin/publish"
    ;;
  *)
    echo "用法: admin.sh <health|candidates|false-positives|publish>" >&2
    exit 1
    ;;
esac
echo
