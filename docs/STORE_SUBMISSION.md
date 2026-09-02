# Chrome Web Store 上架手册

首次上架与后续发版的操作手册。材料全部本地生成，门禁全在本地（不使用 CI）。

## 1. 材料清单

| 材料                    | 路径                                                                | 状态                         |
| ----------------------- | ------------------------------------------------------------------- | ---------------------------- |
| 商店 ZIP                | `apps/extension/.output/feedsieve-v<版本>-chrome.zip`               | `scripts/pack-store.sh` 产出 |
| ZIP checksum            | 同目录 `.sha256`                                                    | 脚本产出                     |
| 商店图标 128×128        | `apps/extension/public/icon-128.png`                                | 已就绪                       |
| 截图 1280×800 ×2~3      | `assets/store/screenshot-*.png`                                     | 真机拍摄                     |
| 宣传图 440×280          | `assets/store/promo-440x280.png`                                    | 已就绪                       |
| 跑马灯 1400×560（可选） | `assets/store/marquee-1400x560.png`                                 | 已就绪                       |
| 隐私政策 URL            | `https://github.com/realchendahuang/feedsieve/blob/main/PRIVACY.md` | 已就绪                       |
| 支持链接                | `https://github.com/realchendahuang/feedsieve/issues`               | 已就绪                       |
| 主页                    | `https://github.com/realchendahuang/feedsieve`                      | —                            |

打包命令（自动跑 verify + 构建 + manifest/ZIP 审计 + checksum）：

```bash
bash scripts/pack-store.sh
```

## 2. 开发者账号（一次性）

1. 登录 Google 账号，先开启两步验证（发布/更新的前提）。
2. 打开 [Developer Dashboard](https://chrome.google.com/webstore/devconsole)，注册开发者账号。
3. 支付一次性注册费（注册页显示的金额为准）。
4. 账号页验证联系邮箱；填写发布商名称（如 `FeedSieve`）。
5. 开发者邮箱一经设置不可更改，建议用专用邮箱并定期查看。

## 3. 商店信息（Listing）

- **名称**：`FeedSieve 福滤娃`
- **简短描述**（≤132 字符）：

  ```text
  X 赛博清洁工：黄框标注垃圾账号，一键批量真拉黑。标注永不隐藏内容。
  ```

- **详细描述**（纯文本，直接粘贴）：

  ```text
  FeedSieve（福滤娃）是 X（Twitter）时间线的赛博清洁工。

  高置信才标注，绝不隐藏内容：
  • 高置信垃圾账号在时间线上被黄框标出，徽章使用“3 人标记为诈骗”等普通理由
  • 你依然能看到每一条推文，判断权在你

  拉黑永远由你按下按钮：
  • 插件漏识别时，在推文旁或面板中“标记垃圾并拉黑”
  • 点单个黄框拉黑一个账号
  • 或打开扩展面板，一键拉黑当前页面全部黄框账号
  • 社区清理只处理至少 3 人确认且无人抢救的账号，并自动排除关注、白名单和已拉黑账号
  • 拉黑全部可撤销（「已拉黑」列表 → 撤销）

  关注保护：
  • 可将自己的完整关注列表同步为本地保护名单
  • 关注列表不上传社区

  社区名单（可选，默认开启，可关闭）：
  • 内置社区维护的垃圾账号名单，自动标注
  • 你维护的黑名单匿名上传为正样本：账号名、分类、话术指纹哈希与外链域名
  • 你维护的白名单匿名上传为负样本：账号名与当时的检测规则，帮助纠正误标

  隐私（一行版）：凭证、推文原文和关注列表不出设备，只同步你明确维护的黑白名单；可在设置中关闭。
  完整政策：https://github.com/realchendahuang/feedsieve/blob/main/PRIVACY.md

  适用范围：x.com。标注永不隐藏 · 误伤可撤销。
  ```

- **类别**：工具（Tools）· **语言**：中文（简体），可后补英文 locale
- **图标/截图/宣传图**：按第 1 节路径上传

## 4. 隐私标签（Privacy）

- **单一用途声明**：

  ```text
  在 X 时间线上识别并标注垃圾账号，并在用户明确点击时通过 X 原生接口执行拉黑/撤销。
  ```

- **权限用途说明**：

  | 权限                                               | 用途                                                                 |
  | -------------------------------------------------- | -------------------------------------------------------------------- |
  | `storage`                                          | 缓存社区名单快照、用户设置、本地统计、已拉黑记录                     |
  | 主机权限 `https://x.com/*`                         | 内容脚本在时间线识别账号并标注；用户点击时经 X 自身会话执行拉黑/撤销 |
  | 主机权限 `https://feedsieve-api.chendahuang.com/*` | 自有 API：下载经校验的社区名单快照；开启名单上传时同步匿名黑白标签   |

- **数据使用勾选**（收集 = 离开设备的数据）：
  - ✅ 网站内容（Website content）——拉黑对象的话术指纹（单向哈希）与外链域名
  - ✅ 用户活动（User activity）——用户明确加入黑名单或白名单的账号与分类/误标规则
  - ✅ 唯一标识符（Unique identifiers）——本机随机安装 ID，服务端仅存加盐哈希
  - ❌ 其余全部不收集（PII、认证信息、通信、位置、浏览历史等）
- **合规声明**：按表单逐条勾选（不出售数据、仅按披露用途使用、不用于与单一用途无关的目的等），均与实现一致。
- **隐私政策 URL**：`https://github.com/realchendahuang/feedsieve/blob/main/PRIVACY.md`

## 5. 审核员说明（Notes for reviewers，直接粘贴）

```text
What FeedSieve does
- Marks spam accounts on x.com with a yellow frame (a visual border only) plus a
  badge explaining why. It never hides, collapses, or removes content.
- Blocking happens ONLY on explicit user clicks: single block on a marked tweet,
  manual “Mark spam & block”, or batch block via the popup. Every block can be
  undone in the popup.
- The user's following list can be synced as a local-only protection list. It is
  excluded from batch actions and is never uploaded as a community vote.

How to test
1. Open https://x.com (e.g. https://x.com/search?q=spam&f=live). Accounts in the
   community spam list get a yellow frame and a reason badge.
2. Open the popup: it lists the accounts currently marked on the page. Click
   "一键拉黑" to block them via the logged-in user's own X session; the popup
   shows per-account results and an unblock list.
3. Paste an X handle or profile URL into "漏网账号" to test the manual path.
4. Popup → Settings: "List uploads / 名单上传" (on by default) controls both
   blocklist and allowlist uploads; turning it off stops them. The ⟳ button
   syncs the community snapshot.

Permissions rationale
- "storage": caches the community snapshot, settings, local stats, and
  blocked/unblock records.
- Host "https://x.com/*": content scripts read the timeline DOM to identify
  accounts and execute the user-triggered block/unblock against X's own
  endpoints with the user's existing session (no cookies permission; the
  session token is read from the page context and sent only to x.com itself).
- Host "https://feedsieve-api.chendahuang.com/*" (our own API, shipped in this
  repo): downloads the community snapshot (JSON validated by schema + SHA-256)
  and, when List uploads is enabled, syncs only entries the user explicitly
  maintains in the local blocklist or allowlist. Block entries include handle,
  category, one-way content-fingerprint hash, and external link hostnames;
  allow entries include handle and available false-positive rule evidence.
  The local following-protection list and blocks copied from Community Clean are
  explicitly excluded from uploads.
  Both use a random installation ID that is stored server-side only as a salted hash.

  Keyword-rule packs are public data only: the extension downloads a version manifest and
  JSON pack from this same API, verifies the SHA-256 checksum and schema, and caches the
  last known-good copy. Users explicitly subscribe to industry packs; a match only shows a
  review highlight and never auto-blocks, bulk-blocks, or uploads a report.

Why a MAIN-world content script
- x.com renders account data through its own GraphQL responses. A page-context
  script observes window.fetch/XMLHttpRequest responses to read the same public
  fields the page already displays (handle, user id). It does not read
  credentials or cookies, does not modify or block any request, and forwards
  only parsed fields to this extension's own isolated content script via
  CustomEvent. Raw responses are never stored or transmitted.

No remote code
- All JavaScript is bundled locally in the package. Remote content is data-only
  (JSON snapshots), schema- and checksum-validated before use.

Data handling
- Browsing history, DMs, passwords, and cookies are never collected. Original
  tweet text never leaves the device (only one-way hashes). Privacy policy:
  https://github.com/realchendahuang/feedsieve/blob/main/PRIVACY.md
```

## 6. 分发与提交

1. 上传 ZIP → 检查「软件包」页无警告。
2. 填完 商店信息 / 隐私 / 分发 三个标签。
3. 分发：公开（Public），所有国家/地区，免费。
4. 审核员说明粘贴到提交框。
5. 提交审核。默认「审核通过后自动发布」；想人工放行就取消自动发布（通过后 30 天内手动发布，过期退回草稿）。

### 提交前 checklist

- [ ] `pnpm verify` 全绿
- [ ] `bash scripts/pack-store.sh` 通过，ZIP + checksum 产出
- [ ] checksum 已记入 `docs/RELEASES.md`
- [ ] git tag（如 `v0.7.0`）与本次构建一致
- [ ] 上传 ZIP 后版本号、权限与第 4 节描述一致
- [ ] 隐私政策 URL、支持链接可公开访问

## 7. 后续发版

1. 改代码 → `apps/extension/package.json` 与 `apps/community-api/package.json` 同步升版（保持一致）。
2. 更新 `docs/RELEASES.md`（只写事实，不写形容词）。
3. `bash scripts/pack-store.sh` → commit → tag → 上传新 ZIP → 提交审核。
4. 商店审核通过即覆盖旧版本；如需回滚，在 Dashboard 重新上传上一个 tag 构建的 ZIP。
