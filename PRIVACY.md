# FeedSieve 隐私政策 / Privacy Policy

生效日期：2026-09-01 · Contact: [GitHub Issues](https://github.com/realchendahuang/feedsieve/issues)

FeedSieve（福滤娃）是 X（Twitter）扩展：黄框标注垃圾账号，用户点击后执行拉黑。
本政策说明它处理什么数据、什么数据出设备、什么数据绝不出设备。

---

## 中文

### 只在本地处理（绝不出设备）

- X 页面内容：推文文本、昵称、简介、链接 —— 用于识别垃圾账号。
- 识别结果与动作记录：标注、拉黑、撤销、白名单、本地统计，以及你自定义的关键词规则、对官方预置词包的订阅/启停状态和最近一次校验通过的公开词库版本缓存。
- 你的 X 关注列表：用于形成每个用户自己的「关注保护」名单，只保存在浏览器本地，绝不作为白名单或抢救票上传。
- X 登录凭证（ct0 / bearer）：仅在你的浏览器内、你点击拉黑/撤销时，用于向 x.com 本身发起请求。不读取、不存储、不发送给 FeedSieve 或任何第三方。
- 浏览历史、私信、密码：不收集。
- 个人配置备份：只有你点击「导出个人配置」或选择文件导入时，扩展才会在本机创建或读取 JSON 文件。它仅含自定义关键词、官方词库开关、界面语言和社区名单显示偏好；不含登录态、安装 ID、黑白名单、关注保护、历史、队列、统计或名单上传授权。该功能不会自动上传文件或内容。

### 离开设备的数据

**1. 社区名单同步（无你的任何数据）**
扩展从官方 API `feedsieve-api.chendahuang.com` 下载社区名单快照（JSON，经 SHA-256 校验）。该请求不包含你的任何个人数据。

**2. 黑白名单上传（默认开启，可一键关闭）**
开启「名单上传」时，扩展同步你明确维护的本地黑名单和白名单，包括升级前已保存在本机的历史记录。它不上传仅仅浏览过、仅仅被标注但未处理的账号；也不上传关注保护名单、你的自定义关键词或官方词库的订阅/启停状态。公开词库下载不携带安装 ID、X 账号、浏览历史或自定义词；由本地关键词触发的拉黑会明确标记为仅本地，不会回灌成社区举报票；直接执行「社区清理」产生的批量拉黑同样只记录在本机。

- 黑名单：`handle`（对方账号名）、可选 `x_user_id`、分类、话术指纹单向哈希、外链 hostname（最多 5 个）
- 白名单：`handle`、可选 `x_user_id`、当时的检测来源、规则 ID 与检测理由（旧记录可能只有 handle）
- 两者共同携带：本机随机安装 ID 与扩展版本号；服务端只保存安装 ID 的加盐哈希

同一安装对同一账号只保留一个当前判断，后一次“拉黑 / 白名单”覆盖前一次。本地名单删除后会撤回当前票；原始上报证据仍用于误标审计，直到你提出服务器数据删除请求。关闭「名单上传」后完全不发送。

**3. 贡献统计查询**
仅当本机曾上报过（存在安装 ID）时，打开扩展面板会查询你的累计贡献数。请求经 POST body 发送安装 ID，返回纯数字。从未上报过的设备不产生此请求。

**4. 抢救票（显式动作）**
你认为误伤并点击「抢救」时，上报 `handle`、可选 `x_user_id`、误标规则证据与安装 ID，并作为当前负标签计票。

### 服务器保存什么

官方 API（部署于 Cloudflare Workers + D1）保存：handle、x_user_id、分类、指纹、外链域名、误标来源/规则/理由、当前黑白标签、加盐哈希后的安装 ID、时间。不保存 IP、原始安装 ID、Cookie、任何 X 凭证。

### 删除与退出

- 关闭上报：扩展面板 → 设置 → 关闭「名单上传」。
- 删除服务器数据：在 [GitHub Issues](https://github.com/realchendahuang/feedsieve/issues) 提出请求，按安装 ID 哈希删除相关记录。
- 卸载扩展即删除全部本地数据。

### 变更

政策更新会发布在本文件，重大变更随扩展版本说明公告。

---

## English

### Processed locally only (never leaves the device)

- X page content: tweet text, display names, bios, links — used to detect spam accounts.
- Detection results and actions: marks, blocks, unblocks, allowlist, local stats.
- Your X following list: used as a per-user protection list and stored locally only. It is never uploaded as an allow or rescue vote.
- Your X session credentials (ct0 / bearer): used only inside your browser, only when you click block/unblock, only against x.com itself. Never read, stored, or sent to FeedSieve or any third party.
- Browsing history, direct messages, passwords: not collected.
- Personal config backup: only an explicit “Export personal config” click or file import creates or reads a local JSON file. It contains custom keywords, official-rule switches, UI language, and community display preferences only; it excludes sign-in data, installation IDs, lists, following protection, history, queues, statistics, and the list-upload consent. This feature never uploads the file or its contents automatically.

### Data that leaves the device

**1. Community list sync (contains none of your data)**
The extension downloads the community snapshot (JSON, SHA-256 verified) from the official API `feedsieve-api.chendahuang.com`. No personal data is included in this request.

**2. Blocklist and allowlist uploads (default on, one toggle to disable)**
When “List uploads” is enabled, the extension syncs the local blocklist and allowlist entries you explicitly maintain, including records already stored locally before an upgrade. Merely viewed or merely marked accounts are never uploaded. Neither is the following-protection list. Blocks performed by Community Clean are kept as local action records and do not create new community report votes.

- Blocklist: `handle`, optional `x_user_id`, category, one-way content fingerprint, and up to five external link hostnames
- Allowlist: `handle`, optional `x_user_id`, detection source, rule ID, and the detector's reason when available; legacy records may contain only the handle
- Both include a random local installation ID and extension version; the server stores only a salted hash of that ID

Each installation has only one current judgment per account, so a later block/allow decision replaces the earlier one. Removing a local list entry retracts the current vote; original evidence remains for false-positive auditing until you request server-side deletion. Turn off “List uploads” to stop all such transmissions.

**3. Contribution stats**
Only if this device has contributed before, opening the popup queries your cumulative counts. The installation ID is sent in a POST body; the response is numbers only. Devices that never contributed make no such request.

**4. Rescue votes (explicit action)**
Clicking rescue on a wrongly marked account reports its `handle`, optional `x_user_id`, rule evidence, and installation ID as a current negative label.

### What the server stores

The official API (Cloudflare Workers + D1) stores: handle, x_user_id, category, fingerprint, link domains, false-positive source/rule/reason, current block/allow label, salted-hashed installation ID, and timestamps. It does not store IPs, raw installation IDs, cookies, or any X credentials.

### Deletion and opt-out

- Stop reporting: popup → Settings → disable List uploads.
- Delete server data: open a request in [GitHub Issues](https://github.com/realchendahuang/feedsieve/issues); records are deleted by hashed installation ID.
- Uninstalling the extension removes all local data.

### Changes

Updates are published in this file; significant changes ship with release notes.
