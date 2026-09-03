#!/usr/bin/env sh
# 本地调试三票共识。只允许访问 localhost，绝不向线上伪造社区票。
#
# 先运行 pnpm dev，再：
#   ./scripts/seed.sh <<'EOF'
#   @spam_user bot_spam
#   EOF
set -eu

API="${FEEDSIEVE_API:-http://127.0.0.1:8787}"
case "$API" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *)
    echo "error: seed.sh 只用于本地三票调试；线上条目请使用受 Cloudflare Access 保护的管理后台" >&2
    exit 1
    ;;
esac

count=0
while read -r handle category; do
  case "$handle" in ''|\#*) continue ;; esac
  normalized=$(printf '%s' "$handle" | sed 's/^@//' | tr '[:upper:]' '[:lower:]')
  case "$normalized" in
    *[!a-z0-9_]*|'') echo "skip invalid handle: $handle" >&2; continue ;;
  esac
  if [ "${#normalized}" -gt 15 ]; then
    echo "skip invalid handle: $handle" >&2
    continue
  fi
  case "$category" in
    bot_spam|copy_paste|ai_slop|advertising|adult_gray_traffic|scam_phishing|engagement_bait|other) ;;
    *) echo "skip invalid category: $category" >&2; continue ;;
  esac

  vote=1
  while [ "$vote" -le 3 ]; do
    payload=$(node -e '
      const [handle, category, vote] = process.argv.slice(1);
      process.stdout.write(JSON.stringify({
        installation_id: `local-consensus-${vote}-${handle}`,
        client_version: "local-debug",
        reports: [{ handle, reason: category }],
      }));
    ' "$normalized" "$category" "$vote")
    curl -fsS -X POST -H 'content-type: application/json' \
      --data "$payload" "$API/v1/reports" >/dev/null
    vote=$((vote + 1))
  done
  count=$((count + 1))
  echo "seeded local consensus: @$normalized (3 net votes)"
done

echo "done: $count account(s); open $API/v1/blocklist/latest.yaml"
