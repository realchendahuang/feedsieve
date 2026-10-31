#!/usr/bin/env sh
# FEEDSIEVE_API / ~/.config/feedsieve/api-base 的统一解析（各发布/镜像脚本 source）。
# POSIX sh 兼容；source 后读 $FEEDSIEVE_API_BASE。
#
# FEEDSIEVE_API_BASE_REQUIRED=1：缺失直接报错退出（mirror / pack-store）。
# 默认：缺失仅置空，由调用方决定降级行为（publish-keyword-packs 跳过远程检查、
# publish-community-whitelist 告警跳过快照发布）。
resolve_feedsieve_api_base() {
  FEEDSIEVE_API_BASE="${FEEDSIEVE_API:-}"
  if [ -z "$FEEDSIEVE_API_BASE" ] && [ -f "$HOME/.config/feedsieve/api-base" ]; then
    FEEDSIEVE_API_BASE="$(cat "$HOME/.config/feedsieve/api-base" 2>/dev/null || true)"
  fi
  if [ -z "$FEEDSIEVE_API_BASE" ] && [ "${FEEDSIEVE_API_BASE_REQUIRED:-0}" = "1" ]; then
    echo "error: 未设置 FEEDSIEVE_API（或写 ~/.config/feedsieve/api-base）" >&2
    exit 1
  fi
}
