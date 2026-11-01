#!/usr/bin/env sh
# FeedSieve 发版：版本号 → CHANGELOG 校验 → 商店级构建审计 → 提交打标 → GitHub Release。
# Chrome Web Store 的上传与送审不在本脚本内（需要浏览器登录态），
# 维护者按全局 skill `feedsieve-release` 完成。
#
# 用法：
#   scripts/release.sh 0.12.3
#   scripts/release.sh 0.12.3 --firefox        # 同时构建 Firefox 包与 AMO 源码包
#   scripts/release.sh 0.12.3 --dry-run        # 只检查并打印计划
#   scripts/release.sh 0.12.3 --skip-verify    # 跳过完整门禁/商店审计，只打 zip（仅本地调试）
#
# 前置：CHANGELOG.md 已写好 `## [x.y.z]` 条目和底部 compare 链接；
# 除 CHANGELOG.md 外工作区干净。脚本会提交 CHANGELOG 与两个 package.json。

set -eu

VERSION="${1:-}"
DRY_RUN=0
SKIP_VERIFY=0
FIREFOX=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --skip-verify) SKIP_VERIFY=1 ;;
    --firefox) FIREFOX=1 ;;
  esac
done

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

[ -n "$VERSION" ] || fail "用法：scripts/release.sh <x.y.z> [--firefox] [--dry-run] [--skip-verify]"
echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "版本号必须是 x.y.z：$VERSION"

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

TAG="v$VERSION"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = "main" ] || fail "请在 main 分支发版（当前：$BRANCH）"

grep -q "^## \[$VERSION\]" CHANGELOG.md || fail "CHANGELOG.md 没有 ## [$VERSION] 条目，先写本版变更"
grep -q "^\[$VERSION\]:" CHANGELOG.md || fail "CHANGELOG.md 底部缺少 [$VERSION]: compare 链接"

OTHER=$(git status --porcelain | grep -v '^ M CHANGELOG.md' || true)
[ -z "$OTHER" ] || fail "除 CHANGELOG.md 外还有未提交改动：$OTHER"

# 本地 main 落后/分叉时，先把问题暴露出来，别等提交和打标之后才 push 失败。
git fetch origin main --quiet
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] ||
  fail "本地 main 与 origin/main 不一致，先同步或合并"

CURRENT=$(node -p "require('./apps/extension/package.json').version")
echo "版本号：$CURRENT → $VERSION"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] 更新 apps/extension 与 apps/community-api 的 version"
  if [ "$SKIP_VERIFY" -eq 0 ]; then
    echo "[dry-run] 跑 scripts/pack-store.sh（pnpm verify + zip + manifest/内容审计 + smoke）"
  else
    echo "[dry-run] 跳过门禁，只构建 zip"
  fi
  if [ "$FIREFOX" -eq 1 ]; then
    echo "[dry-run] 跑 scripts/pack-firefox.sh（Firefox 构建 + web-ext lint + AMO 源码包）"
  fi
  echo "[dry-run] 构建通过后再提交 CHANGELOG 与版本号，推 main，打 tag ${TAG}"
  echo "[dry-run] 创建 GitHub Release 并上传 zip"
  exit 0
fi

git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && fail "本地已有 tag $TAG"
! git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1 ||
  fail "远端已有 tag $TAG"

node - "$VERSION" <<'NODE'
const fs = require('node:fs');
const version = process.argv[2];
for (const p of ['apps/extension/package.json', 'apps/community-api/package.json']) {
  const raw = fs.readFileSync(p, 'utf8');
  const next = raw.replace(/"version": "[^"]+"/, `"version": "${version}"`);
  if (next === raw) throw new Error(`未能更新版本号：${p}`);
  fs.writeFileSync(p, next);
}
NODE

# 先构建并审计产物，再提交/打标：构建失败不会留下「tag 已推、没有 Release」的半发布。
if [ "$SKIP_VERIFY" -eq 0 ]; then
  sh scripts/pack-store.sh
else
  echo "跳过完整门禁与商店审计（--skip-verify）：只构建 zip"
  pnpm --filter @feedsieve/extension zip
fi

ZIP="apps/extension/.output/feedsieve-$VERSION-chrome.zip"
[ -f "$ZIP" ] || fail "没有生成 $ZIP"

FIREFOX_ZIP=""
FIREFOX_SOURCE=""
if [ "$FIREFOX" -eq 1 ]; then
  sh scripts/pack-firefox.sh
  FIREFOX_ZIP="apps/extension/.output/feedsieve-$VERSION-firefox.zip"
  FIREFOX_SOURCE="apps/extension/.output/feedsieve-$VERSION-firefox-source.zip"
  [ -f "$FIREFOX_ZIP" ] || fail "没有生成 $FIREFOX_ZIP"
  [ -f "$FIREFOX_SOURCE" ] || fail "没有生成 $FIREFOX_SOURCE"
fi

git add CHANGELOG.md apps/extension/package.json apps/community-api/package.json
git commit -m "chore(release): $VERSION"
git push --no-verify origin main
git tag "$TAG"
git push --no-verify origin "$TAG"

NOTES=$(mktemp)
trap 'rm -f "$NOTES"' EXIT
awk -v ver="$VERSION" '
  index($0, "## [" ver "]") == 1 { on=1; next }
  on && index($0, "## [") == 1 { exit }
  on { print }
' CHANGELOG.md > "$NOTES"
cat >> "$NOTES" <<EOF

### 安装

- Chrome 应用商店：https://chromewebstore.google.com/detail/feedsieve/amhdjglnonjaoenddnifpnljgmocfdph
- 或下载下方 \`feedsieve-$VERSION-chrome.zip\`，解压后在 \`chrome://extensions\` 打开开发者模式 → 加载已解压的扩展程序。
EOF
if [ "$FIREFOX" -eq 1 ]; then
  cat >> "$NOTES" <<EOF
- Firefox：官方 AMO 条目提交审核中；离线包见下方 \`feedsieve-$VERSION-firefox.zip\`。
- AMO 审核用源码包：\`feedsieve-$VERSION-firefox-source.zip\`。
EOF
fi

ASSETS="$ZIP"
if [ -f "$ZIP.sha256" ]; then ASSETS="$ASSETS $ZIP.sha256"; fi
if [ -n "$FIREFOX_ZIP" ]; then
  ASSETS="$ASSETS $FIREFOX_ZIP"
  if [ -f "$FIREFOX_ZIP.sha256" ]; then ASSETS="$ASSETS $FIREFOX_ZIP.sha256"; fi
  ASSETS="$ASSETS $FIREFOX_SOURCE"
  if [ -f "$FIREFOX_SOURCE.sha256" ]; then ASSETS="$ASSETS $FIREFOX_SOURCE.sha256"; fi
fi

# shellcheck disable=SC2086
gh release create "$TAG" $ASSETS --title "$TAG" --notes-file "$NOTES"

echo
echo "GitHub Release 完成：$TAG"
echo "下一步：按 feedsieve-release skill 上传 $ZIP 到 Chrome Web Store 并提交审核。"
