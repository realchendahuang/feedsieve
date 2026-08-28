#!/usr/bin/env sh
# 种子脚本：向 D1 accounts 表写入人工背书（status=strong）的种子条目。
#
# 用法: ./scripts/seed.sh <<'EOF'
#   @Fox_Looper bot_spam
#   spam_user99 adult_gray_traffic
# EOF
#
# - 每行 "handle category"，# 开头为注释
# - 幂等（INSERT OR IGNORE）；只增不改，误种用 admin promote dismissed 撤销
# - handle 会被归一化（去@、小写），非法字符直接跳过
set -e
cd "$(dirname "$0")/.."

now=$(date +%s)
count=0

while read -r handle category; do
  case "$handle" in ''|\#*) continue ;; esac
  h=$(printf '%s' "$handle" | sed 's/^@//' | tr '[:upper:]' '[:lower:]')
  case "$h" in
    *[!a-z0-9_]*|'') echo "skip invalid handle: $handle" >&2; continue ;;
  esac
  case "$category" in
    bot_spam|copy_paste|ai_slop|advertising|adult_gray_traffic|scam_phishing|engagement_bait|other) ;;
    *) echo "skip invalid category: $category" >&2; continue ;;
  esac
  pnpm exec wrangler d1 execute feedsieve-community --remote \
    --config wrangler.local.jsonc \
    --command "INSERT OR IGNORE INTO accounts (handle, category, status, report_count, rescue_count, first_report_at, updated_at) VALUES ('$h', '$category', 'strong', 1, 0, $now, $now)" \
    >/dev/null
  count=$((count + 1))
done

echo "seeded $count accounts (status=strong)"
echo "记得执行 ./scripts/admin.sh publish 让条目进入快照"
