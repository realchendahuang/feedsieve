# 发版流程

本项目按 `主版本.次版本.修订号` 发版；扩展与社区 API 共用同一个版本号。

## 1. 写 CHANGELOG

在 `CHANGELOG.md` 顶部加一条：

```markdown
## [0.12.2] — 2026-11-01

### 本次主题

- 具体变更，按用户能感知的行为写。
```

并在文件底部补 compare 链接：

```markdown
[0.12.2]: https://github.com/realchendahuang/feedsieve/compare/v0.12.1...v0.12.2
```

`## [Unreleased]` 里已经写好的条目直接挪进新版本，不要重复保留。

## 2. 跑发版脚本

```sh
scripts/release.sh 0.12.2
```

脚本会依次做：

1. 校验版本号格式、`CHANGELOG.md` 条目与 compare 链接
2. 检查当前在 `main`、除 `CHANGELOG.md` 外工作区干净、tag 不存在
3. 更新 `apps/extension/package.json` 与 `apps/community-api/package.json`
4. 跑 `scripts/pack-store.sh`（`pnpm verify` + 构建 + manifest/内容审计 + smoke）
5. 构建通过后才提交、打 `vX.Y.Z` tag、推送 main 与 tag
6. 用 CHANGELOG 内容创建 GitHub Release 并上传 zip 与 sha256

先看计划、不实际执行：

```sh
scripts/release.sh 0.12.2 --dry-run
```

`--skip-verify` 会跳过完整门禁与商店审计、只打 zip，仅用于本地调试，不要用于正式发版。

## 3. 发布到 Chrome 应用商店

扩展对外安装以 Chrome 应用商店为主。上传与送审需要维护者本机的商店登录态，
不在仓库脚本内，手动在开发者后台操作：

1. 若上一版还在审核，先撤销审核
2. 上传 `apps/extension/.output/feedsieve-X.Y.Z-chrome.zip`
3. 确认版本号与权限（`storage` / `unlimitedStorage` / `sidePanel` / `x.com`）
4. 提交审核，保持「通过审核后自动发布」

## 3.1 同时发布 Firefox（AMO）

```sh
scripts/release.sh 0.13.1 --firefox
```

在 Chrome 包之外，还会跑 `scripts/pack-firefox.sh`：构建 Firefox MV3、
`check-firefox.mjs`、`web-ext lint`（要求 0 errors）、zip 审计，并生成
AMO 审核用完整源码包。GitHub Release 会多挂：

- `feedsieve-X.Y.Z-firefox.zip` + `.sha256`
- `feedsieve-X.Y.Z-firefox-source.zip` + `.sha256`

AMO 上传与送审同样需要登录态，不在脚本内；流程见 [`FIREFOX.md`](FIREFOX.md)。
Firefox 的 Gecko ID 是官方自有的 `feedsieve-official@feedsieve.win`；AMO 上已有的
`feedsieve@feedsieve.local` 和 `feedsieve@feedsieve.win` 都被第三方占用，不要更新它们。

## 4. 发版后检查

- GitHub Release 的 `vX.Y.Z` 有 `feedsieve-X.Y.Z-chrome.zip`
- GitHub Actions `verify` 在 tag 对应的 commit 上通过
- Chrome 商店与 AMO 条目状态均为「待审核」或「已通过审核」，通过后自动发布
- 官网与 README 中的版本相关内容（如截图、量级名称）与新版本一致

## 约定

- 不在版本号里加 `-beta` / `-rc` 后缀；预发布用 GitHub Release 的 pre-release 标记。
- 不重复使用已推送的 tag；发错了就发下一版。
- 商店的描述、截图、隐私理由按版本更新，不要只换 zip。
