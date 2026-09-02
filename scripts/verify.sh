#!/usr/bin/env sh
# 本地质量门禁：与原 CI 相同的检查集，push 前由 .githooks/pre-push 自动执行。
# 手动运行：pnpm verify；跳过钩子：git push --no-verify。

set -e

echo '==> lint'
pnpm lint

echo '==> keyword pack artifacts'
pnpm keyword-packs:check

echo '==> typecheck'
pnpm typecheck

echo '==> test'
pnpm test

echo '==> test community-api (workerd)'
pnpm --filter @feedsieve/community-api test

echo '==> build extension'
pnpm build:extension

echo '==> all checks passed'
