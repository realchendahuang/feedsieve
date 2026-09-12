#!/usr/bin/env sh
# 社区抢救名单 → 推荐白名单 一键管道（维护者本地手动）。
# 把 promote(迁移) → enrich(拉 X 资料) → publish --check(校验) → publish(发布)
# 四步串成一个入口；默认在发布前停下等你回车确认，--auto 才跳过确认（仍不 bypass）。
#
# 用法：
#   scripts/whitelist-pipeline.sh --dry-run     # 全程只读：promote/enrich 均预览
#   scripts/whitelist-pipeline.sh              # 回填 + 校验，发布前确认
#   scripts/whitelist-pipeline.sh --auto       # 不确认，直接发布
#   scripts/whitelist-pipeline.sh --no-publish # 只备好候选与资料，不发布
#
# 行为要点：
#   - promote 幂等：抢救条目全部已入册时自动跳过 enrich，直接校验
#   - enrich 断点续跑：X guest 限流中断后，重跑本脚本即接着拉
#   - publish 同步整份文件进 D1 并触发快照发布（当日一版节流）
set -eu
cd "$(dirname "$0")/.."

MODE=prompt
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY="--dry-run" ;;
    --auto) MODE=auto ;;
    --no-publish) MODE=skip ;;
    *) echo "usage: $0 [--dry-run] [--auto] [--no-publish]" >&2; exit 1 ;;
  esac
done

echo "== 1/4 抢救候选迁移（${DRY:-写入模式}）=="
node scripts/promote-rescued-whitelist.mjs $DRY || exit 1

# 零候选时 enrich 无事可做；有候选才花时间拉资料
echo "== 2/4 拉取 X 公开资料回填（${DRY:-写入模式，约 1.3s/条）} =="
node scripts/enrich-rescued-whitelist.mjs $DRY || true

echo "== 3/4 publish 全量校验 =="
sh scripts/publish-community-whitelist.sh --check

if [ "$MODE" = "skip" ]; then
  echo "== 4/4 按 --no-publish 跳过发布：候选已就绪，之后跑 scripts/publish-community-whitelist.sh 生效 =="
  exit 0
fi
if [ "$MODE" = "prompt" ]; then
  printf "以上校验通过，确认发布进 D1（不 bypass 快照日闸）？[y/N] "
  read -r answer
  case "$answer" in
    y | Y | yes) ;;
    *) echo "已取消发布（候选与资料都在 whitelist.yaml，随时可重来）"; exit 0 ;;
  esac
fi
echo "== 4/4 发布 =="
sh scripts/publish-community-whitelist.sh
