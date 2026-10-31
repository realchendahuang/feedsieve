#!/usr/bin/env sh
# 本地质量门禁；GitHub Actions 在 push / PR 时跑同样的步骤。community-api 测试需要 Docker 起本地 PostgreSQL。
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

echo '==> test community-api (workerd + PostgreSQL)'
# 测试连本地 PostgreSQL（docker-compose.yml）；已在跑时这一步是空操作
docker compose up -d --wait postgres
pnpm --filter @feedsieve/community-api test

echo '==> build extension'
pnpm build:extension

echo '==> build and check Firefox extension'
pnpm build:extension:firefox
pnpm check:extension:firefox

echo '==> all checks passed'
