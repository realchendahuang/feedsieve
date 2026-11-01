# FeedSieve 隐私政策 / Privacy Policy

生效日期：2026-09-01（2026-09-13 增补独立用户反馈样本；2026-10-30 增补本地热帖、全站热榜与本机保存的博主主页帖子；2026-10-31 增补博主主页帖子库众包、调整全站热榜上报节奏与防刷、增补 AI 味检测与规则命中上报，随 0.11.0 发布生效；2026-11-01 增补发帖排期与文章编辑（仅本机），随 0.12.0 发布生效；2026-11-01 调整 AI 味公开裁决为社区投票 + Jev，不再由维护者复核；2026-11-01 增补：你自己的主页公开帖子数字也参与主页帖子库众包，使用独立的每日会话编号；2026-11-02 取消主页帖子库的粉丝数门槛） · Contact: [GitHub Issues](https://github.com/realchendahuang/feedsieve/issues)

FeedSieve（福滤娃）是 X（Twitter）扩展：黄框标注垃圾账号、用户点击后执行拉黑；并基于页面已经加载的公开数据，显示帖子热度、热帖列表和博主主页分析。
本政策说明它处理什么数据、什么数据出设备、什么数据绝不出设备。

Firefox 版通过 `browser_specific_settings.gecko.data_collection_permissions` 声明与本文相同的数据用途（websiteContent / websiteActivity / personallyIdentifyingInfo / authenticationInfo）；两个浏览器的口径一致。

---

## 中文

### 只在本地处理（绝不出设备）

- X 页面内容：推文文本、昵称、简介、链接 —— 在本地用于识别垃圾账号；用户处理后的有限证据按下述授权上传。
- 识别结果与动作记录：标注、拉黑、撤销、白名单、本地统计，以及你自定义的关键词规则、对官方预置词包的订阅/启停状态和最近一次校验通过的公开词库版本缓存。例外：官方规则打黄框的账号会按下文第 10 条匿名上报（可单独关闭）。
- 你的 X 关注列表：用于形成每个用户自己的「关注保护」名单，只保存在浏览器本地，绝不作为白名单或抢救票上传。
- X 登录凭证（ct0 / bearer）：仅在你点击拉黑/撤销时，从页面 Cookie 读取 `ct0`，随该次请求发给 x.com 本身；不存储、不写日志、不发送给 FeedSieve 或任何第三方。
- 浏览历史（访问过哪些网址）、私信、密码：不收集。开启「参与全站热榜」时会上传你刷到的公开帖子指标，见下文第 7 条；你打开过的博主主页的公开帖子数字按第 8 条共享。
- 帖子公开指标与作者公开资料：你浏览 X 时页面已经加载的帖子浏览数、互动数、发布时间、正文前 1000 字、作者名称、头像地址、粉丝数，用于在本地显示流速、量级和「热帖」列表。多个 X 标签页的数据会在扩展后台合并，只保存在浏览器的会话内存里（`storage.session`），关闭浏览器即清空；扩展不会为此额外请求 X。开启「参与全站热榜」时，其中一部分按下文第 7 条上传。
- 博主主页的帖子：你在 X 上打开过的博主主页，扩展会保存你浏览时页面已经加载的这个博主的公开帖子和公开资料（各项计数、发帖时间、正文前 1000 字、帖子类型），用于「主页」视图显示他的爆款和规律。保存在本机（`storage.local`，不设数量上限、不淘汰），其中的公开帖子数字按下文第 8 条与其他用户共享。扩展不会主动替你滚动页面，也不会额外请求 X；只有你在「主页」视图里点「补全这个博主」时，才会分步向下滚动让 X 自己加载更多帖子（最多约一分钟，随时可停）。可随时在「设置 → 清空主页数据」删除本机数据。
- 发帖排期与文章编辑：你设的发帖时间表、扩展在 X「草稿 › 预排期」页面和你新建 / 修改 / 删除预排期帖子时顺带读到的已排期帖子（ID、发布时间、正文前 280 字、图片数），以及你在 X 文章编辑器里粘贴或导入的 Markdown、你在面板里写的草稿、文章编辑时自动存的备份（标题和正文的 Markdown，每篇 5 个版本、最多 30 篇），都只在本机处理（`storage.local`），不上传到 FeedSieve 服务器，可在面板里删除。扩展只替你填写 X 自带的定时下拉框、把 Markdown 换成 X 编辑器的格式，不替你点「确认」「预排期」「发布」，也不为此额外请求 X。
- 个人配置备份：只有你点击「导出个人配置」或选择文件导入时，扩展才会在本机创建或读取 JSON 文件。它仅含自定义关键词、官方词库开关、界面语言和社区名单显示偏好；不含登录态、安装 ID、黑白名单、关注保护、历史、队列、统计或名单上传授权。该功能不会自动上传文件或内容。

### 离开设备的数据

**1. 社区名单同步（无你的任何数据）**
扩展从官方 API `api.feedsieve.win` 下载社区名单快照（黑名单与验证正常白名单，JSON，经 SHA-256 校验与发布者签名验证），最多每 30 分钟检查一次；有新版本时优先只下载两版之间的增量，套在本机已验证的旧版上，重建出的全文必须与签名清单里的 SHA-256 一致，否则改下载全量。该请求不包含你的任何个人数据。

**2. 黑白名单上传（默认开启，可一键关闭）**
开启「名单上传」时，扩展同步你明确维护的本地黑名单和白名单，包括升级前已保存在本机的历史记录。它不上传仅仅浏览过、仅仅被标注但未处理的账号（被官方规则标注的账号另按第 10 条匿名上报，不是票）；也不上传关注保护名单、你的自定义关键词或官方词库的订阅/启停状态。公开词库下载不携带安装 ID、X 账号、浏览历史或自定义词；由关键词触发的拉黑不会回灌成社区举报票，但其显式操作证据可进入下述独立待审样本池；直接执行「社区清理」产生的批量拉黑同样只记录在本机。

- 黑名单：`handle`（对方账号名）、可选 `x_user_id`、分类、话术指纹单向哈希、外链 hostname（最多 5 个），以及拉黑时刻的判定材料——命中那条推文的原文（截 500 字）、作者昵称与简介原文。这些内容本来就是你拉黑动作发生时公开发布的 X 内容，随票上传用于官方反滥用分析与误报治理，只在「名单上传」开启时发送，且不含你尚未处理的浏览内容。
- 白名单：`handle`、可选 `x_user_id`、当时的检测来源、规则 ID 与检测理由（旧记录可能只有 handle）
- 两者共同携带：本机随机安装 ID 与扩展版本号；服务端只保存安装 ID 的加盐哈希

同一安装对同一账号只保留一个当前判断，后一次“拉黑 / 白名单”覆盖前一次。本地名单删除后会撤回当前票；原始上报证据仍用于误标审计，直到你提出服务器数据删除请求。关闭「名单上传」后完全不发送。

**3. 贡献统计查询**
仅当本机曾上报过（存在安装 ID）时，打开扩展面板会查询你的累计贡献数。请求经 POST body 发送安装 ID，返回纯数字。从未上报过的设备不产生此请求。

**4. 抢救票（显式动作）**
你认为误伤并点击「抢救」时，上报 `handle`、可选 `x_user_id`、误标规则证据与安装 ID，并作为当前负标签计票。

**5. 关键词贡献（显式动作）**
你在关键词页点击「贡献给官方词库」（或在官网词库页提交）时，上传你主动挑选的短语与安装 ID（网页通道为加盐哈希后的 IP）。短语进入维护者人工审阅队列，审阅通过后才纳入官方词库；不参与黑名单计票。受每日额度限制。

**6. 独立用户反馈样本（v0.9.4）**
开启「名单上传」时，用户明确标记垃圾、采纳检测后拉黑（包括页面批量操作）、点击误标加入白名单，会保存独立事件。事件包含对方账号和可用的帖子 ID、正文（最多 4000 字符）、昵称（160 字符）、简介（1000 字符）、截断标记、证据采集与操作时间、扩展及词库版本、检测来源/规则/信号。个人用途拉黑、社区名单批量清理、普通添加白名单和仅浏览/仅检测不创建这些样本。自定义关键词正文不上传，规则 ID 脱敏。

样本由用户反馈产生，不自动当作真实内容标签，不影响社区票数。维护者经受保护的后台复核，另存结论、模板家族、招揽/导流/引用/否定等标注及审计历史；复核后的证据用于反滥用评测及未来模型研究，不公开到名单、GitHub 或模型供应商；这些样本不交给任何外部模型（AI 味检测见第 9 条，与样本无关）。网络失败保留本地独立事件，下次同步补交；关闭「名单上传」暂停采集和补交，重新开启可补交此前积压。服务器删除请求覆盖这些样本及其复核记录；关闭上传本身不删除已提交记录。

**7. 全站热榜（默认开启，可单独关闭；「仅本地运行」打开时一并停止）**
扩展默认每 15 分钟最多一次（服务器可以把间隔调长，最长 1 小时），把你正常浏览 X 时页面已经加载的、**正在火的**公开帖子（流速达到每小时 1000 次浏览）的指标发给官方 API，用来汇总「全站热帖」；其余帖子、X 标记为可能敏感的帖子不上传，上次发过且数字没怎么变的也不重发。上传字段：帖子 ID、作者 handle、昵称、头像地址、是否蓝标、粉丝数、发帖时间、正文前 280 字、第一张图片地址、浏览/点赞/转发/回复/引用/收藏数，以及观测时刻（取整到分钟）。不上传：你自己的 X 账号与帖子、受保护账号的帖子、在私信/通知/书签/列表/社群/设置页面上看到的帖子、安装 ID、Cookie 或任何 X 凭证。请求只带一个每天更换的随机会话编号（服务器加盐哈希后保存，只用于限速和「足够多人看到才上榜」的门槛），跨天无法关联。为了防止一台机器换编号刷榜，服务器把请求 IP 所在网段（IPv4 前 3 段、IPv6 前 3 组）连同当天日期加盐哈希后取前 16 位（每天换，跨天同样无法关联），和观测存在一起，用来要求上榜帖子来自不同网段；不保存完整 IP。扩展不会为此额外请求 X；上传直接从扩展后台发往官方 API，不经过 x.com 页面。服务器保存观测（含网段哈希）26 小时、帖子 48 小时后删除。

**8. 博主主页帖子库众包（默认开启；「仅本地运行」打开时一并停止）**
你打开过某个博主的主页后，扩展会从官方 API 取回其他用户已经收集到的这个博主的公开帖子数字，合并进本机；同时把你浏览时页面已经加载、服务器还没有或已经明显更新的这个博主的公开帖子数字发给官方 API（最多 5 分钟一次），让下一个打开这个主页的人直接看到。只报服务器还不知道的部分，已知的不重复上传。上传字段：帖子 ID、博主 handle、发帖时间、帖子类型（原创/回复/引用）、媒体类型、是否置顶、正文前 280 字、第一张图片地址、语言、浏览/点赞/转发/回复/引用/收藏数；博主的昵称、头像地址、是否蓝标、粉丝数、关注数、发帖数、注册时间。不上传：你自己的 X 账号信息、受保护账号的帖子、只在私信/通知/书签/列表/社群/设置页面上看到的帖子、你打开过哪些主页的记录、安装 ID、Cookie 或任何 X 凭证。上报只带一个每天更换的随机会话编号（与全站热榜的不是同一个，服务器加盐哈希后只用于每日限额，不和帖子存在一起）。你自己的主页和别人的主页一样参与：这些公开帖子数字会以上述方式上报（本人提供的数据最完整），但用另一个单独的每日会话编号，和你看其他主页的记录不在同一个会话里。取回某个博主的数据时，服务器和 Cloudflare 会和访问任何网站一样看到请求的 IP 和博主 handle，服务器不保存二者的对应关系（限额只记 IP 的加盐哈希和当天次数）；受保护账号不会去取。粉丝数不设门槛：小博主的公开帖子同样可能对以后有用。服务器按帖子去重，一条帖子只存一份。

**9. AI 味检测（显式动作；「仅本地运行」打开时不可用）**
只有你点了回复上的机器人图标、主页的「AI 味」Tab 或面板里的「开始检测 / 测测我自己」，扩展才会在那个账号的「回复」页往下翻几屏，读取 X 已经加载的这个账号最近最多 20 条公开回复及其所回复的原帖（回复截 200 字、原帖截 80 字、去掉 t.co 短链）、帖子 ID，以及页面上显示的这个账号的昵称和头像地址，连同对方 handle、本机随机安装 ID、回复涉及几个不同的人（只有数字）发给官方 API。扩展不会为此额外请求 X。

官方 API 把最近 10 条回复和回复间隔（不含 handle）交给第三方语言模型服务判定一次；分数落在灰色地带时再用后 10 条判一次。结论（AI / 疑似 / 真人、分数、参与判定的回复 ID、节奏统计、昵称、头像地址）按账号缓存 7–30 天；服务器不保存回复正文。一个人测出的结论只返回给他本人：要等另一个安装交来重合的回复、或独立重判落在同一侧，才对所有人公开（主页 Tab、评论区标记、官网结果页 `feedsieve.win/ai/账号`、分享预览图）。公开结论由社区票和 Jev 的判定一起决定：任一方向至少 3 票且领先，就按该方向公开；两边都至少 3 票且持平，显示「社区争议中」；不再由维护者复核，也不会因为申诉自动撤下。

你点「是 AI / 是真人」时上传对方 handle、你的选择和安装 ID。AI 票至少 3 票且多于真人票时，账号进入社区 AI 号名单；真人票至少 3 票且领先时，公开结论为真人并从名单撤下；两边都至少 3 票且持平显示「社区争议中」。扩展每 30 分钟最多下载一次这份名单（只含 handle、分数、是否入名单），用来在评论区标记或折叠，你可以在面板「AI 味」里关掉或改成折叠。你查过谁、自己测出的结果、投过什么只在本机另存一份（`storage.local`）。分享图在本机生成，不上传。检测失败时（回复不够、太集中、你点了停止）只上报失败类型，不带账号。每个安装每天最多发起 20 次新判定。

**10. 规则命中上报（默认开启，可单独关闭；「仅本地运行」打开时一并停止）**
扩展的官方规则（官方关键词词库、昵称/提及招揽、内置组合规则、社区指纹/域名）给某个账号打了黄框时，会匿名记一条，默认每 15 分钟最多上报一次：对方 handle、规则 ID、检测来源、分类、正文指纹的单向哈希、触发的帖子 ID。同一账号同一规则每天只报一次。不上传：你的自定义关键词及其命中、名单命中、正文原文、昵称和简介、你自己的 X 账号、安装 ID、Cookie 或任何 X 凭证；扩展不会为此额外请求 X。请求只带一个每天更换的随机会话编号（与全站热榜、主页帖子库的都不是同一个），服务器另存「IP 网段 + 当天日期」加盐哈希的前 16 位，用来判断命中来自不同网络；不保存完整 IP。

命中**不是投票**，永远不会单独让一个账号进入黑名单。服务器只用它：统计每条规则 14 天内的误伤率（被点「误标？」的账号 ÷ 被它标注的账号），误伤率超线的规则自动停用并随签名名单下发；给已有至少 2 张人工净票、没有误标票的账号作独立佐证（最近 7 天里某一天来自至少 3 个不同网段；网段哈希每天换，所以按天统计）；推断名单条目的分类；给维护者复核排序。服务器保存 21 天后删除。

### 服务器保存什么

官方 API（运行在 Cloudflare Workers，数据存放在维护者自管服务器上的 PostgreSQL 数据库）保存：handle、x_user_id、分类、指纹、外链域名、拉黑时携带的公开判定材料（推文原文/昵称/简介，只做反滥用分析，不对外公开检索）、误标来源/规则/理由、当前黑白标签、加盐哈希后的安装 ID、你主动贡献的关键词短语、时间。不保存原始 IP（网页关键词提交的 IP 级限流只保存盐哈希）、原始安装 ID、Cookie、任何 X 凭证。

### 删除与退出

- 关闭上报：扩展面板 → 设置 → 关闭「名单上传」；或分别关闭「参与全站热榜」「上报规则命中」；打开「仅本地运行」停止全部上报。
- 删除服务器数据：在 [GitHub Issues](https://github.com/realchendahuang/feedsieve/issues) 提出请求，按安装 ID 哈希删除相关记录。
- 卸载扩展即删除全部本地数据。

### 变更

政策更新会发布在本文件，重大变更随扩展版本说明公告。

---

## English

### Processed locally only (never leaves the device)

- X page content: tweet text, display names, bios, links — detection runs locally; bounded evidence from explicit actions may be uploaded as described below.
- Detection results and actions: marks, blocks, unblocks, allowlist, local stats.
- Your X following list: used as a per-user protection list and stored locally only. It is never uploaded as an allow or rescue vote.
- Your X session credentials (ct0 / bearer): read from the page cookie only at the moment you click block/unblock, and sent only to x.com itself. Never stored, logged, or sent to FeedSieve or any third party.
- Browsing history (which URLs you visit), direct messages, passwords: not collected. With "Join the global hot list" on, metrics of public posts you scroll past are uploaded as described in item 7 below; public post numbers of creator profiles you open are shared as described in item 8.
- Public post metrics and public author profiles: view and engagement counts, post time, the first 1000 characters, author name, avatar URL and follower count of posts X already loaded while you browse, used locally for velocity, tier and the "Hot posts" list. Data from several X tabs is merged in the extension background and kept only in browser session memory (`storage.session`), cleared when the browser closes; the extension makes no extra requests to X for it.
- Creator profile posts: for creator profiles you open on X, the extension keeps the public posts and public profile stats X already loaded while you browse (counts, post time, first 1000 characters, post type), so the "Profile" view can show their outliers and patterns. It is stored on this device (`storage.local`, no count limit and no eviction); its public post numbers are shared with other users as described in item 8 below. The extension never scrolls the page or makes extra requests to X for it. Clear the local copy any time under Settings → Clear profile data.
- Posting schedule and article editing: your posting schedule, the scheduled posts the extension reads from X’s Drafts › Scheduled page and from the scheduled posts you create, edit or delete on X (ID, publish time, first 280 characters, media count), Markdown you paste or import into the X Articles editor, drafts you write in the panel, and automatic backups of articles you edit (title and body as Markdown, 5 versions per article, up to 30 articles) are processed on this device only (`storage.local`), never uploaded to FeedSieve, and can be deleted in the panel. The extension only fills in X’s own schedule dropdowns and converts Markdown to X’s editor formatting; it never clicks Confirm, Schedule or Publish for you and makes no extra requests to X for this.
- Personal config backup: only an explicit “Export personal config” click or file import creates or reads a local JSON file. It contains custom keywords, official-rule switches, UI language, and community display preferences only; it excludes sign-in data, installation IDs, lists, following protection, history, queues, statistics, and the list-upload consent. This feature never uploads the file or its contents automatically.

### Data that leaves the device

**1. Community list sync (contains none of your data)**
The extension downloads the community snapshot (JSON, SHA-256 and publisher-signature verified) from the official API `api.feedsieve.win`, checking at most every 30 minutes. When a new version exists it first fetches only the changes between the two versions and applies them to the verified local copy; the rebuilt file must match the SHA-256 in the signed manifest, otherwise the full file is downloaded. No personal data is included in this request.

**2. Blocklist and allowlist uploads (default on, one toggle to disable)**
When “List uploads” is enabled, the extension syncs the local blocklist and allowlist entries you explicitly maintain, including records already stored locally before an upgrade. Merely viewed or merely marked accounts are never uploaded as votes (accounts marked by official rules are reported anonymously under item 10, which are not votes). Neither is the following-protection list. Blocks performed by Community Clean are kept as local action records and do not create new community report votes.

- Blocklist: `handle`, optional `x_user_id`, category, one-way content fingerprint, and up to five external link hostnames — plus the evidence behind the decision at block time: the text of the tweet that triggered the block (truncated to 500 characters), the account's display name, and its bio. Those are contents the account had published publicly on X when you blocked it; they are uploaded with the vote for spam analysis and false-positive review, only while “List uploads” is enabled, and never include content you merely viewed without acting on.
- Allowlist: `handle`, optional `x_user_id`, detection source, rule ID, and the detector's reason when available; legacy records may contain only the handle
- Both include a random local installation ID and extension version; the server stores only a salted hash of that ID

Each installation has only one current judgment per account, so a later block/allow decision replaces the earlier one. Removing a local list entry retracts the current vote; original evidence remains for false-positive auditing until you request server-side deletion. Turn off “List uploads” to stop all such transmissions.

**3. Contribution stats**
Only if this device has contributed before, opening the popup queries your cumulative counts. The installation ID is sent in a POST body; the response is numbers only. Devices that never contributed make no such request.

**4. Rescue votes (explicit action)**
Clicking rescue on a wrongly marked account reports its `handle`, optional `x_user_id`, rule evidence, and installation ID as a current negative label.

**5. Keyword contributions (explicit action)**
When you click “Contribute to official wordpacks” in the keywords page (or submit from the website wordpack tab), the phrases you actively selected are uploaded together with the installation ID (the web channel sends a salted, hashed IP instead). Phrases enter a maintainer review queue and are added to official wordpacks only after review; they never affect blocklist votes. Daily quotas apply.

**6. Independent user feedback samples (v0.9.4)**
While List uploads is enabled, explicit spam marking, accepting a detection by blocking (including page batches), and correcting a false positive create independent evidence events. Events include the target handle, available post ID, text (4000 characters), display name (160), bio (1000), truncation flags, observation/action times, extension/catalog versions, and detector source/rule/signals. Personal blocks, community batch cleanup, ordinary allowlist additions, passive browsing and engine judgments alone do not create samples. Custom keyword text is excluded and custom rule IDs are redacted.

Feedback is an unverified claim, independent of community votes. Maintainers review evidence behind authenticated admin access and record separate labels, template families, semantic tags and review history. Reviewed evidence supports anti-abuse evaluation and future model research; it is not published in lists or GitHub or sent to model vendors. These samples are never passed to any external model (the AI flavor check in item 9 is separate). Failed uploads remain in a local outbox; disabling List uploads pauses collection and retries, and re-enabling can send the backlog. Server deletion requests cover samples and review history. Disabling uploads alone does not delete submitted data.

**7. Global hot list (on by default, can be turned off on its own; local-only mode stops it too)**
By default at most once every 15 minutes (the server can stretch this to up to 1 hour), the extension sends the official API metrics of public posts that X already loaded while you browsed and that are **heating up** (at least 1,000 views per hour), to build the global hot list; other posts and posts X marks as possibly sensitive are not sent, and posts already sent whose numbers barely moved are not sent again. Fields sent: post ID, author handle, display name, avatar URL, verified flag, follower count, post time, the first 280 characters, the first image URL, view/like/repost/reply/quote/bookmark counts, and the observation time (rounded to the minute). Not sent: your own X account or posts, posts from protected accounts, posts seen on DM, notification, bookmark, list, community or settings pages, the install ID, cookies or any X credentials. Requests carry only a random session ID that changes every day (stored as a salted hash, used only for rate limits and the "seen by enough people" threshold), so days cannot be linked. To stop one machine from rotating IDs to game the list, the server stores with each observation the first 16 characters of a salted hash of the request's network (first 3 parts of an IPv4 address, first 3 groups of IPv6) plus the date, and requires listed posts to come from different networks. The hash changes every day, so days still cannot be linked; the full IP is not stored. The extension makes no extra requests to X for this; uploads go from the extension background straight to the official API, not through the x.com page. The server deletes observations (including the network hash) after 26 hours and posts after 48 hours.

**8. Shared creator profile library (on by default; local-only mode stops it)**
After you open a creator's profile, the extension fetches the public post numbers other users already collected for that creator from the official API and merges them locally. It also sends the official API that creator's public post numbers that X already loaded while you browsed and that the server does not have yet or has an outdated copy of (at most once every 5 minutes), so the next person opening the profile sees them right away. Only what the server does not know yet is sent. Fields sent: post ID, creator handle, post time, post type (original/reply/quote), media type, pinned flag, the first 280 characters, the first image URL, language, view/like/repost/reply/quote/bookmark counts; the creator's display name, avatar URL, verified flag, follower, following and post counts, and join date. Not sent: your own X account or posts, posts from protected accounts, posts seen only on DM, notification, bookmark, list, community or settings pages, which profiles you opened, the install ID, cookies or any X credentials. Uploads carry only a random session ID that changes every day (separate from the hot list one, stored as a salted hash only for daily rate limits and never stored with posts). When fetching a creator's data, the server and Cloudflare see the request IP and the creator handle, as with any website; the server does not store the link between them (rate limits keep only a salted IP hash and a daily count). Your own profile, protected accounts and creators under 1,000 followers are never fetched. Only creators with at least 1,000 followers are collected. The server de-duplicates by post and keeps one copy of each post.

**9. AI flavor check (explicit action; unavailable in local-only mode)**
Only after you click the robot icon on a reply, the "AI flavor" tab on a profile, or "Check / Check myself" in the panel does the extension scroll a few screens down that account's Replies tab and read up to 20 of its most recent public replies X already loaded, the posts they reply to (replies truncated to 200 characters, parent posts to 80, t.co links removed), post IDs, and the display name and avatar URL shown on the page. These are sent with the account handle, this device's random install ID and the number of distinct people replied to (a number only) to the official API. The extension makes no extra requests to X for this.

The official API passes the 10 most recent replies and the reply gaps (without the handle) to a third-party language model service once, and a second time with the next 10 when the score is borderline. The result (AI / suspect / human, score, IDs of replies used, rhythm stats, display name, avatar URL) is cached per account for 7–30 days; reply text is not stored. A result from one person is returned only to that person; it becomes visible to everyone (profile tab, reply labels, the public page `feedsieve.win/ai/handle`, share previews) only after another install submits overlapping replies or an independent re-check lands on the same side. The public verdict is decided by community votes together with Jev's result: at least 3 votes in one direction and a lead in that direction publishes that verdict; at least 3 votes on both sides with a tie shows "community dispute". Maintainer review is no longer used, and an appeal no longer withdraws a public verdict automatically.

Clicking "It's AI / It's human" sends the handle, your choice and the install ID. An account joins the community AI list when at least 3 votes say AI and they outnumber human votes; when at least 3 human votes lead, the public verdict is human and the account leaves the list; at least 3 votes on both sides with a tie shows "community dispute". The extension downloads that list (handle, score, listed flag) at most every 30 minutes to label or fold those accounts in replies; you can turn this off or switch to folding under "AI flavor" in the panel. Who you checked, your own results and your votes are also kept on this device (`storage.local`). Share images are made on your device and never uploaded. When a check fails (too few replies, too concentrated, or you pressed Stop), only the failure type is reported, without any account. Each install can start at most 20 new checks per day.

**10. Rule hit reports (on by default, can be turned off on its own; local-only mode stops it too)**
When an official rule (the official keyword packs, profile/mention invitation rules, built-in combination rules, community fingerprints or domains) marks an account, the extension records it anonymously and reports at most every 15 minutes by default: the account handle, rule ID, detection source, category, a one-way hash of the text fingerprint, and the post ID. Each account and rule is reported at most once a day. Not sent: your custom keywords or their hits, list hits, tweet text, display names or bios, your own X account, the install ID, cookies or any X credentials; the extension makes no extra requests to X for this. Requests carry only a random session ID that changes every day (separate from the hot list and profile library ones); the server also stores the first 16 characters of a salted hash of the request's network plus the date to tell hits from different networks apart; the full IP is not stored.

Rule hits are **not votes** and can never put an account on the blocklist by themselves. The server uses them only to measure each rule's false-positive rate over 14 days (accounts marked "Misflagged?" ÷ accounts the rule marked) and turn off rules above the limit through the signed list; to back up accounts that already have at least 2 net human votes and no false-positive votes (hits from at least 3 networks on one day in the last 7 days; the network hash changes daily, so networks are counted per day); to infer list categories; and to sort the maintainers' review queue. The server deletes them after 21 days.

### What the server stores

The official API (running on Cloudflare Workers, with data in a PostgreSQL database on servers run by the maintainer) stores: handle, x_user_id, category, fingerprint, link domains, the public block-time evidence carried with votes (tweet text, display name, bio — used for abuse analysis, never publicly searchable), false-positive source/rule/reason, current block/allow label, salted-hashed installation ID, keyword phrases you actively contributed, and timestamps. It does not store raw IPs (IP-level rate limiting for web keyword submissions keeps only a salted hash), raw installation IDs, cookies, or any X credentials.

### Deletion and opt-out

- Stop reporting: popup → Settings → disable List uploads; or turn off "Join the global hot list" and "Report rule hits" separately; local-only mode stops all uploads.
- Delete server data: open a request in [GitHub Issues](https://github.com/realchendahuang/feedsieve/issues); records are deleted by hashed installation ID.
- Uninstalling the extension removes all local data.

### Changes

Updates are published in this file; significant changes ship with release notes.
