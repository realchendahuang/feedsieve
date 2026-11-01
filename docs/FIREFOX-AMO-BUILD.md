# Building FeedSieve for Firefox (AMO source submission)

This archive contains the complete source used to build the submitted Firefox
package. Nothing is minified by hand and no generated code is edited.

## Requirements

- Node.js >= 22
- pnpm 11 (`corepack enable` picks the version from `package.json`)
- Network access once, for dependency installation

## Build

```sh
pnpm install --frozen-lockfile
pnpm --filter @feedsieve/extension build:firefox
```

The unpacked extension is written to `apps/extension/.output/firefox-mv3/`.
`pnpm install` runs `scripts/copy-runtime-data.mjs` and `wxt prepare`; the build
command copies the same data again before running WXT.

## What is in the archive

- `apps/extension/` — extension entrypoints, UI, content script, tests
- `packages/` — workspace libraries used by the extension
  (`@feedsieve/detector`, `metrics`, `x-adapter`, `community-lists`, `shared`,
  `block-queue`)
- `community/` — public list snapshot and keyword-pack data copied into the
  extension at build time
- `apps/extension/src/lib/detection/variant-tables.json` — variant mapping data
- lockfile, workspace config and TypeScript configs

Generated folders (`node_modules`, `.output`, `dist`, `.wrangler`) and local
configuration are not included.

## Runtime notes for reviewers

- The extension makes no remote code requests. All JavaScript is bundled in the
  submitted package.
- It reads only pages on `x.com` (host permission `https://x.com/*`).
- It talks to the project's own API at `https://api.feedsieve.win` with ordinary
  CORS requests; no host permission is requested for it.
- The AI-flavor check (only after an explicit click) sends up to 20 public
  replies of one account to the project's API, which forwards the text once to a
  third-party language-model service for scoring. Full details are in
  `PRIVACY.md`.
- Scheduling and article editing happen locally; the extension never confirms or
  publishes on the user's behalf.

Contact: https://github.com/realchendahuang/feedsieve/issues
