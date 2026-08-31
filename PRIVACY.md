# FeedSieve 隐私政策 / Privacy Policy

生效日期：2026-08-31 · Contact: [GitHub Issues](https://github.com/realchendahuang/feedsieve/issues)

FeedSieve（福滤娃）是 X（Twitter）扩展：黄框标注垃圾账号，用户点击后执行拉黑。
本政策说明它处理什么数据、什么数据出设备、什么数据绝不出设备。

---

## 中文

### 只在本地处理（绝不出设备）

- X 页面内容：推文文本、昵称、简介、链接 —— 用于识别垃圾账号。
- 识别结果与动作记录：标注、拉黑、撤销、白名单、本地统计。
- X 登录凭证（ct0 / bearer）：仅在你的浏览器内、你点击拉黑/撤销时，用于向 x.com 本身发起请求。不读取、不存储、不发送给 FeedSieve 或任何第三方。
- 浏览历史、私信、密码：不收集。

### 离开设备的数据

**1. 社区名单同步（无你的任何数据）**
扩展从官方 API `feedsieve-api.chendahuang.com` 下载社区名单快照（JSON，经 SHA-256 校验）。该请求不包含你的任何个人数据。

**2. 匿名贡献上报（默认开启，可一键关闭）**
只有当你主动拉黑某个账号后，扩展才向官方 API 上报该账号：

- `handle`（对方账号名）、可选 `x_user_id`
- 分类（如 bot_spam / scam_phishing）
- 话术指纹：推文文本归一化后的单向哈希，原文不出设备
- 该推文外链域名（仅 hostname，最多 5 个，不含 X 自家域名）
- 安装 ID：本机生成的随机 UUID，服务端只存加盐哈希，无法反推
- 扩展版本号

关闭「自动贡献」后完全不发送。上报的账号经自动评分进入社区名单。

**3. 贡献统计查询**
仅当本机曾上报过（存在安装 ID）时，打开扩展面板会查询你的累计贡献数。请求经 POST body 发送安装 ID，返回纯数字。从未上报过的设备不产生此请求。

**4. 抢救票（显式动作）**
你认为误伤并点击「抢救」时，上报 `handle` 与安装 ID。

### 服务器保存什么

官方 API（部署于 Cloudflare Workers + D1）保存：handle、x_user_id、分类、指纹、外链域名、加盐哈希后的安装 ID、时间。不保存 IP、原始安装 ID、Cookie、任何 X 凭证。

### 删除与退出

- 关闭上报：扩展面板 → 社区名单 → 关闭「自动贡献」。
- 删除服务器数据：在 [GitHub Issues](https://github.com/realchendahuang/feedsieve/issues) 提出请求，按安装 ID 哈希删除相关记录。
- 卸载扩展即删除全部本地数据。

### 变更

政策更新会发布在本文件，重大变更随扩展版本说明公告。

---

## English

### Processed locally only (never leaves the device)

- X page content: tweet text, display names, bios, links — used to detect spam accounts.
- Detection results and actions: marks, blocks, unblocks, allowlist, local stats.
- Your X session credentials (ct0 / bearer): used only inside your browser, only when you click block/unblock, only against x.com itself. Never read, stored, or sent to FeedSieve or any third party.
- Browsing history, direct messages, passwords: not collected.

### Data that leaves the device

**1. Community list sync (contains none of your data)**
The extension downloads the community snapshot (JSON, SHA-256 verified) from the official API `feedsieve-api.chendahuang.com`. No personal data is included in this request.

**2. Anonymous contribution (default on, one toggle to disable)**
Only after you actively block an account, the extension reports that account:

- `handle`, optional `x_user_id`
- category (e.g. bot_spam / scam_phishing)
- content fingerprint: a one-way hash of normalized tweet text; the original text never leaves the device
- external link hostnames from that tweet (max 5, X-owned domains excluded)
- installation ID: a random UUID generated locally; the server stores only a salted hash
- extension version

Turn off "自动贡献 / autoContribute" to stop entirely.

**3. Contribution stats**
Only if this device has contributed before, opening the popup queries your cumulative counts. The installation ID is sent in a POST body; the response is numbers only. Devices that never contributed make no such request.

**4. Rescue votes (explicit action)**
Clicking rescue on a wrongly marked account reports the `handle` and installation ID.

### What the server stores

The official API (Cloudflare Workers + D1) stores: handle, x_user_id, category, fingerprint, link domains, salted-hashed installation ID, timestamps. It does not store IPs, raw installation IDs, cookies, or any X credentials.

### Deletion and opt-out

- Stop reporting: popup → 社区名单 → disable 自动贡献.
- Delete server data: open a request in [GitHub Issues](https://github.com/realchendahuang/feedsieve/issues); records are deleted by hashed installation ID.
- Uninstalling the extension removes all local data.

### Changes

Updates are published in this file; significant changes ship with release notes.
