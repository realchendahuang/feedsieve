#!/usr/bin/env sh
# 本地质量门禁：检查集与 CI 相同；CI 额外运行 pnpm 依赖审计（--audit-level high）。
# push 前由 .githooks/pre-push 自动执行（克隆后 pnpm install 会自动启用钩子）。
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
