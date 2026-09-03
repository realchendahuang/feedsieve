# FeedSieve Technical Specification

> Status: implementation baseline  
> Updated: 2026-08-26  
> Target: v0.1 → v0.3

这份文档是 FeedSieve 后续开发的**主技术规范**。如果 README、旧讨论或其他设计文档与这里冲突，以本文件和对应 ADR / Schema 为准。

## 1. 核心技术结论

FeedSieve 的第一产品形态是浏览器扩展，真正的技术本体是独立 Block Engine：

> **Detector（识别标注）+ Block Queue（拉黑队列）。**

总原则：

> **可见优先，拉黑唯一。Local detect. Community list. AI last. Native Block through the page.**

对应到工程实现：

1. **标注永不隐藏**：Detector 只在页面上黄框标注垃圾账号并给出理由，不隐藏、折叠、替换任何内容。
2. **社区名单本地查询**：插件定期下载公开的社区快照，刷 Timeline 时只做本地查询，不逐条请求后端。
3. **AI 只做模糊识别**：没有 AI Key 也必须是完整可用产品。
4. **拉黑走浏览器页面**：Block / Unblock 由 X Action Adapter 在用户已登录的 `x.com` 页面中完成，不把 X OAuth / Developer API 作为核心依赖。
5. **用户显式触发**：每个 Block 都由用户按下按钮启动，通过持久化 Block Queue 执行；插件绝不自动静默拉黑。
6. **误伤可撤销**：原生 Unblock 一键放回。
7. **公开透明**：前端、后端、评分规则、名单源文件、构建产物和治理逻辑全部开源。

一句话架构：

```text
x.com
  │
  ├── X Reader Adapter ──> FeedItem
  │                           │
  │                           v
  │                      Detector
  │                 ┌─────────┼─────────┐
  │                 │         │         │
  │            Community  Heuristic  Optional AI
  │                 │
  │            黄框标注（带理由，不隐藏）
  │                 │
  │            待拉黑列表（持久，可增删）
  │                 │
  └── X Action Adapter <── Block Queue（用户按下「一键拉黑」）
                            │
                      原生 Block / Unblock
                      全端生效 + 阻断互动

Community Backend
  │
  ├── explicit Reports / Rescue only
  ├── scoring + anti-abuse
  └── YAML snapshot -> validated JSON artifact -> local cache
```

---

## 2. Monorepo 目录

建议直接按下面结构实施：

```text
feedsieve/
├── apps/
│   └── extension/
│       ├── entrypoints/
│       │   ├── background.ts
│       │   ├── content.tsx
│       │   ├── popup/
│       │   └── options/
│       ├── components/
│       └── assets/
│
├── packages/
│   ├── detector/
│   │   ├── src/community/
│   │   ├── src/heuristics/
│   │   ├── src/fingerprint/
│   │   └── src/types.ts
│   │
│   ├── x-adapter/
│   │   ├── src/reader/
│   │   ├── src/actions/
│   │   ├── src/selectors/
│   │   ├── src/observer/
│   │   └── src/types.ts
│   │
│   ├── block-queue/
│   │   ├── src/queue/
│   │   ├── src/runner/
│   │   ├── src/persistence/
│   │   └── src/types.ts
│   │
│   ├── community-client/
│   │   ├── src/downloader/
│   │   ├── src/storage/
│   │   ├── src/verifier/
│   │   └── src/api/
│   │
│   ├── list-format/
│   │   ├── src/schema/
│   │   ├── src/parser/
│   │   └── src/types.ts
│   │
│   └── shared/
│       ├── src/events/
│       ├── src/config/
│       └── src/utils/
│
├── services/
│   └── community-api/
│       ├── src/routes/
│       ├── src/scoring/
│       ├── src/abuse/
│       ├── src/db/
│       └── migrations/
│
├── community/
│   ├── lists/
│   │   ├── manifest.json
│   │   ├── official.json
│   │   └── blocklist.yaml
│   ├── policy/
│   │   └── v3.yaml
│   ├── schema/
│   │   └── account-list.schema.json
│   └── changelog/
│
├── fixtures/
│   └── x/
│       ├── timeline/
│       ├── replies/
│       ├── profile/
│       └── menus/
│
├── scripts/
│   ├── build-community-lists/
│   ├── validate-community-lists/
│   └── generate-checksums/
│
├── docs/
└── .github/workflows/
```

### 推荐技术栈

- Extension: **WXT + TypeScript + React + Manifest V3**
- Unit test: **Vitest**
- E2E / fixture integration: **Playwright**
- Backend: **Cloudflare Workers + Hono + D1**
- Snapshot distribution: GitHub raw / Release 起步，后续可加 R2 / CDN
- Validation: JSON Schema + YAML parser
- Large local data: IndexedDB（可用 `idb` 轻封装）

第一阶段不要引入复杂微服务。

---

## 3. Browser Extension 执行上下文

Manifest V3 下必须明确每段代码在哪里执行。

### 3.1 Content Script

职责：

- 观察 X DOM
- 提取 Tweet / Account / Link 信息
- 调用 Detector
- 黄框标注 UI（理由标签、勾选、顺手拉黑入口）
- 执行 X Action Adapter 的页面点击动作

默认运行在 **ISOLATED world**。

不要为了方便直接把所有代码注入 MAIN world。只有未来确实需要读取页面 JS runtime 且没有稳定 DOM 替代方案时，才单独建立最小化 main-world bridge。

### 3.2 Extension Service Worker

职责：

- Community Snapshot 定期检查更新
- Extension settings / version migration
- Block Queue 的持久化协调
- Popup / Options / Content Script 消息路由
- 后端 Report / Rescue 请求

Manifest V3 service worker 会被浏览器回收，因此：

> **不能把关键状态只放全局变量。**

队列、下载版本、重试状态等必须持久化。

### 3.3 Popup / Options

Popup 只承担高频操作：

- 待拉黑列表（查看 / 移除）
- 一键批量拉黑入口（进度 / 暂停 / 恢复 / 取消）
- 今日拉黑数量
- 开关 / 标注强度

Options 承担复杂配置：

- 名单订阅
- 启发式开关
- Block Packs
- 社区隐私设置
- Block Queue 设置
- AI Provider（后期）
- 数据导入导出

---

## 4. 最小权限原则

v0.1 建议从最少权限开始：

```text
permissions:
- storage

host_permissions:
- https://x.com/*
```

如果后续确实需要后台管理多个 X Tab，再按需增加 `tabs`。

如果使用静态 Content Script，就不应为了方便提前申请 `scripting`。

如果 Block Queue 需要定时恢复，再增加 `alarms`。

不要申请：

- cookies 权限（`ct0` 等非 httpOnly cookie 在页面上下文可直接读，无需申请）
- webRequest（除非出现无法替代的明确需求）
- X OAuth credential
- 用户密码

会话要素使用边界（2026-08-27 修订，经 PureTwitter / TBWL 实证）：

- 拉黑走 X 网页端自己的 `1.1/blocks/*.json` 端点，使用页面已登录会话
- 只在页面上下文读取 `ct0`（页面本身可见），与公开 web client bearer 一起构成与用户手点 Block 相同的请求
- 凭证绝不出页面：不发往 FeedSieve 后端、不写入 storage、不打日志

原则：

> **能靠当前页面完成的，不拿更高权限。**

---

## 5. X Reader Adapter

`packages/x-adapter` 是 FeedSieve 最需要长期维护的工程边界。

X 经常调整 DOM。如果 Detector 到处直接写 selector，项目很快会失控。

### 5.1 输入 / 输出

Reader Adapter 将 X DOM 转换为稳定内部结构：

```ts
export type FeedItem = {
  source: 'x';
  postId?: string;
  author: {
    xUserId?: string;
    handle: string;
    displayName?: string;
  };
  text: string;
  links: Array<{
    href: string;
    display?: string;
  }>;
  context: 'timeline' | 'reply' | 'search' | 'profile' | 'other';
  isReply?: boolean;
  isRepost?: boolean;
};
```

注意：**`xUserId` 必须允许为空。**

原因是浏览器插件从当前公开 DOM 中通常可以稳定拿到 `@handle` 和 post id，但不应该为了获得稳定 user id 而强依赖 X API 或页面内部私有 runtime。

因此社区协议：

- `handle`: MVP 必需
- `x_user_id`: 有可靠来源时再补充
- 后端允许后续把同一账号的旧 handle 合并到稳定 ID

### 5.2 Selector Registry

不要在业务代码里散落 selector。

```text
x-adapter/src/selectors/
├── tweet.ts
├── menu.ts
├── profile.ts
└── locale.ts
```

每个元素使用多级策略：

1. 稳定 `data-testid` / role
2. DOM 结构 + href 语义
3. aria label
4. locale text fallback

禁止仅依赖易变 CSS class。

### 5.3 DOM Observer

X 是 SPA，需要支持：

- Infinite scroll
- Route change
- Tweet 节点复用
- Modal / Menu portal
- Replies 动态插入

建议：

- `MutationObserver` 只负责发现候选节点
- 使用 WeakSet / internal marker 防止重复处理
- 对实际 Tweet 节点做批量 debounce
- 不在每个 mutation 上执行全页面扫描
- 路由变化后重新初始化 context，但不要销毁全局缓存

### 5.4 Adapter Fixture

每次 X DOM 修复，都保存脱敏 fixture：

```text
fixtures/x/timeline/2026-08-a.html
fixtures/x/menu/block-zh-cn.html
fixtures/x/menu/block-en.html
```

CI 用 fixture 做 Reader / Selector 回归。

不要在 CI 中依赖真实登录 X。

---

## 6. Detector

Detector 不知道 DOM，也不知道 Chrome。它只回答一个问题：**这个账号 / 内容像不像垃圾。**

接口：

```ts
export type DetectContext = {
  item: FeedItem;
  community: CommunityIndex;
  settings: DetectSettings;
};

export type MarkVerdict = {
  mark: boolean;
  reason: string; // 可解释理由，必须非空
  source: 'community' | 'heuristic' | 'fingerprint' | 'domain' | 'ai';
  category?: string; // bot_spam / adult_gray_traffic / ...
  confidence?: number;
  ruleId?: string;
  evidence?: Record<string, unknown>;
};
```

### 6.1 识别信号优先级

固定为：

```text
1. 用户手动标记           -> block + 可选社区贡献
2. Strong Community 名单 -> mark；满足 3 票且 0 抢救才进入批量候选
3. Recommended/Candidate -> mark 供复核，不进入批量候选
4. Content Fingerprint   -> 仅彻底档 review，不进入批量候选
5. Domain 信誉           -> 仅彻底档 review，不进入批量候选
6. 用户配置的关键词/官方完整话术词库 -> 本地 review，不进入批量候选、不上传社区
7. 未配置的单关键词/昵称特征 -> 不进入用户标注层
8. Default               -> 不标注，但保留手动入口
```

标注强度决定名单命中范围：

```text
清爽：仅 Strong 命中标注
标准：Strong + Recommended 命中标注
大扫除：Strong + Recommended + Candidate 命中标注
```

### 6.2 本地弱信号

Detector 可以保留以下信号用于离线评测、证据收集和未来组合模型：

- 机器人账号特征：默认名 + 长随机数字后缀的 handle
- 垃圾域名链接：推文链接命中已知垃圾 hostname 列表
- 模板化文本：同一文本指纹在短时间内重复出现
- 空内容 / 纯链接账号（可选）

建议规则结构：

```ts
export type HeuristicRule = {
  id: string;
  type: 'handle_pattern' | 'spam_domain' | 'template_text' | 'empty_shell';
  enabled: boolean;
  reason: string;
};
```

任何单条启发式都不能直接给用户账号加黄框，更不能进入批量拉黑。间接证据只在彻底档提示复核；面向用户的理由必须翻译为普通描述，不显示 ruleId、指纹、模板等算法术语。

### 6.3 Content Fingerprint

从 v0.4 开始加入，解决“垃圾账号换号但话术不换”的问题。

第一版先做可解释版本：

1. Unicode normalize
2. lowercase / casefold
3. 去掉多余空白
4. URL 替换为占位符
5. @mention 替换为占位符
6. 连续数字可选择归一化
7. 对 normalized text 做 hash

先支持 exact normalized fingerprint。

后续再增加 SimHash / MinHash 做近似模板匹配。

不要第一版就上复杂 embedding。

v0.4 落地形态（`packages/detector/src/fingerprint.ts`）：

- 归一化：小写 -> URL/@提及占位（`fsurl` / `fsmention`）-> 剥离一切非文字字符
  （emoji / 标点 / 空白，含垃圾号防检测插的全角空格）
- 指纹：64bit 确定性哈希（cyrb53 双车道），16 位小写 hex；归一化后短于
  12 字符不产指纹（防无关内容碰撞）
- 指纹来源：正文优先，无正文退回简介（垃圾号爱在 bio 埋话术）
- 本地复读：会话内存追踪器，同一指纹 ≥3 次 -> 标注（`local-repeat`），
  不持久、不上传；仅「大扫除」档启用
- 社区指纹库：上报载荷携带指纹哈希（原文不出设备），服务端 ≥2 个独立安装
  上报才随快照下发；扩展仅「大扫除」档用它标注（用户拍板）

### 6.4 Domain Reputation

链接型诈骗比账号更稳定。

当 DOM 能稳定拿到 expanded / display URL 时，提取 hostname：

```text
spam-account-001 -> bad-domain.example
spam-account-002 -> bad-domain.example
```

以后 Community Entity 不只支持 account，还支持：

```text
account
fingerprint
domain
campaign
```

v0.1 先把接口留出来，不阻塞账号识别主线。

v0.4 落地形态：

- 上报载荷携带推文外链 hostname（去 X 自家域名、去重、单条 ≤5 个）
- 服务端校验 hostname 格式并过滤 `x.com` / `twitter.com` / `t.co` / `twimg.com`
  （含子域）；≥2 个独立安装上报才随快照条目下发（单条目 ≤5 个）
- 扩展侧命中标注 `community-domain`，仅「大扫除」档生效

---

## 7. Community Reputation

### 7.1 核心原则

> **一个人送走垃圾，所有人都可以少看一次。**

社区层只有一个可逆门槛，不再发布 candidate / recommended / strong：

```text
net_votes = block_votes - false_positive_votes
net_votes >= 3 -> community source active
net_votes < 3  -> community source inactive
```

另有独立的 `maintainer` 来源：由服务端受保护的管理页维护，不修改社区票。最终名单是两个来源的并集，快照用 `sources` 明示原因。

### 7.2 公开 Policy，不硬编码

阈值和评分配置放：

```text
community/policy/v3.yaml
```

当前唯一入榜政策：

```yaml
community_blocklist:
  formula: block_votes - false_positive_votes
  min_net_votes: 3
  one_current_vote_per_installation: true

maintainer_source:
  weighted_vote: false
  public_source_label: maintainer
```

这些数字是冷启动默认值，不是永恒真理。以后用公开 PR 修改。

### 7.3 Community Score

先使用简单可解释算法：

```text
effective score
= weighted reports
- weighted rescues
+ consistency bonus
+ temporal spread bonus
- burst penalty
- abuse penalty
```

该分数只用于解释和排序，不决定是否入榜；入榜只看公开净票公式。不要用 ML 黑盒决定名单。

### 7.4 Reporter Trust

第一版：

- 新安装实例默认 trust = 1.0
- 一个 installation 对一个目标只能有一个当前有效 vote
- 连续异常大量上报会降低 trust
- trust 只收紧该安装的每日限额，不改变单票权重
- trust 有公开下限，保留基本参与能力

不要求用户注册。

浏览器本地生成随机 installation id；后续再考虑签名身份。

### 7.5 False-positive vote

区分：

- `放回来`（Unblock）: 用户本地撤销误伤拉黑，不产生社区投票
- `这条还能抢救`: 显式 Community Rescue Vote

这是防误判的重要区别。

---

## 8. Community YAML / JSON 协议

### 8.1 YAML 是公开审计源

```text
community/lists/blocklist.yaml
```

作用：

- GitHub 易读
- PR 审核
- Git Diff
- Fork
- 人工 Appeal / Review

### 8.2 JSON 是运行时产物

```text
community/lists/official.json（由 scripts/mirror-community-lists.sh 从线上快照镜像）
```

作用：

- Extension 下载
- 快速解析
- Schema validate
- checksum / signature
- CDN cache

构建链：

```text
Community votes / maintainer change
      ↓
generate one final entry set
      ↓
readable YAML + machine JSON + checksums
      ↓
Git commit / release
      ↓
extension update
```

### 8.3 Account Entry v2

`x_user_id` 不再作为必须字段：

```yaml
- handle: example_spam
  x_user_id: '123456789' # optional
  aliases:
    - old_handle
  category: bot_spam
  sources: [community, maintainer]
  maintainer_note: '维护者确认该账号持续发送钓鱼链接'
  community_score: 0.91
  report_count: 27
  rescue_count: 2
  net_votes: 25
  first_seen_at: '2026-08-20T12:00:00Z'
  updated_at: '2026-08-26T00:00:00Z'
  evidence_post_ids:
    - '0000000000000000000'
```

### 8.4 Snapshot Manifest

建议增加：

```text
community/lists/manifest.json
```

内容：

```json
{
  "schema_version": 2,
  "policy_version": 3,
  "snapshot_version": "2026.09.02.1",
  "generated_at": "2026-09-02T00:00:00Z",
  "files": [
    {
      "path": "official.json",
      "sha256": "...",
      "entries": 1234
    },
    {
      "path": "blocklist.yaml",
      "sha256": "...",
      "entries": 1234
    }
  ]
}
```

插件先拉 manifest，版本没变就不下载大文件。

### 8.5 大名单扩展

v1 单文件。

当单个列表明显变大后再分片，例如：

```text
official/00.json
official/01.json
...
```

或按 Pack 拆分。

不要过早优化。

---

## 9. Community API

第一版只负责 FeedSieve 自己的数据，不替用户操作 X。

### 9.1 API

```text
POST /v1/reports
POST /v1/rescues
POST /v1/labels/retract
GET  /v1/snapshots/latest
GET  /v1/blocklist/latest.yaml
GET|POST|DELETE /api/admin/* (仅管理域 + Cloudflare Access)
```

### 9.2 Report

```json
{
  "installation_id": "random-local-id",
  "handle": "example_spam",
  "x_user_id": null,
  "reason": "bot_spam",
  "evidence_post_id": "1234567890",
  "client_version": "0.2.0"
}
```

只上传用户**主动点击贡献**的数据。

不要上传：

- 完整 Timeline
- 所有浏览账号
- Cookie
- Access Token
- 私信
- 密码

### 9.3 数据表

最低限度：

```text
accounts
- handle
- x_user_id nullable
- report_count
- rescue_count
- first_seen_at
- updated_at

active_labels
- installation_id_hash
- handle
- label(blocked|allowed)
- updated_at

maintainer_blocklist
- handle
- category
- reason
- active
- created_at / updated_at

maintainer_blocklist_audit
- action(add|update|remove)
- handle / reason / created_at

snapshots
- version
- generated_at
- sha256
```

### 9.4 API Anti-abuse

必须从第一版就有：

- per installation rate limit
- per target idempotency
- IP 只用于服务端短期防滥用，不进入公开数据
- burst detection
- payload validation
- reason enum
- evidence id optional

---

## 10. X Action Adapter

详见 [`X_ACTION_ADAPTER.md`](X_ACTION_ADAPTER.md)。这里定义实施约束。

### 10.1 不依赖 OAuth

目标动作：

```text
block
unblock
mute (v0.2+)
unmute (v0.2+)
not-interested (future)
```

默认由 Content Script 在用户当前登录的 X 页面中完成。

### 10.2 v0.1 动作

```text
黄框账号 / 待拉黑列表
  ↓
用户点「顺手拉黑」或「一键拉黑」
  ↓
X Action Adapter 打开原生菜单并执行 Block
  ↓
验证页面成功反馈
  ↓
误伤 -> 用户点「放回来」-> 原生 Unblock
```

Block 和 Unblock 是 v0.1 的同等一等公民。不成功不假装成功。

### 10.3 Block Queue Task

```ts
type BlockTask = {
  id: string;
  type: 'block' | 'unblock';
  handle: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  attempts: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
};
```

### 10.4 MV3 Queue 持久化

不能把 Queue 只放 service worker memory。

建议：

- queue metadata -> `chrome.storage.local`
- 当前运行状态 -> `chrome.storage.session`
- 大量任务 / 历史 -> IndexedDB（需要时）

### 10.5 执行原则

- 必须用户显式启动
- 用户可随时暂停 / 取消
- 页面反馈成功后才进入下一项
- 出现登录失效、验证、异常 UI 时立即暂停
- 不做“绕过风控”的隐蔽行为
- 不宣称某个固定数量一定安全

默认「一键批量拉黑」只处理用户在待拉黑列表中确认过的账号。

---

## 11. Block Queue

`packages/block-queue` 是独立 package，与 X / 浏览器解耦。

### 11.1 队列语义

```text
pending -> running -> success | failed
                          failed -> pending (retry, attempts < max)
任意状态 -> cancelled
```

### 11.2 待拉黑列表

黄框标注的账号按 handle 去重后进入待拉黑列表：

```ts
type PendingEntry = {
  handle: string;
  reason: string; // 来自 Detector 的标注理由
  markedAt: number;
  source: MarkVerdict['source'];
};
```

- 持久化，跨页面 / 会话累积
- Popup 可查看、可移除
- 用户按下「一键拉黑 N 个」时生成 BlockTask 并进入队列
- 已成功拉黑的 handle 记入 `blockedHandles`，避免重复入队

### 11.3 Runner 模式

```text
User presses 一键拉黑
       ↓
Build tasks from 待拉黑列表
       ↓
Queue persisted
       ↓
Runner has usable x.com tab
       ↓
Service Worker dispatches one task
       ↓
Content Script executes native action
       ↓
Result persisted
       ↓
Next task
```

如果没有可用 X 页面：

- 暂停
- 提示用户打开 X

不要偷偷在不可见上下文执行大量动作。

### 11.4 批量规则

必须：

- 用户显式启动
- 显示总数 / 已完成 / 失败
- Pause / Resume / Cancel
- 每一步确认页面状态
- 异常登录 / Challenge 立即暂停
- 失败 task 有明确原因

不要：

- 承诺某个固定批量数量一定安全
- 为绕过平台检测设计隐蔽行为
- 无提示持续后台操作

---

## 12. 本地存储

建议分层：

### chrome.storage.local

适合：

- settings
- 待拉黑列表
- blockedHandles
- snapshot version
- queue metadata
- daily stats

### chrome.storage.sync

只放很小的用户设置，例如：

- 最终名单索引（不按启发式强度二次筛选）
- UI preference

不要放大名单。

### IndexedDB

适合：

- 大型 Community Snapshot
- Fingerprint index
- 识别缓存
- 大量 Block Queue history

从架构上使用 `CommunityStore` 接口隔离存储实现。

---

## 13. Community Snapshot 更新

不要 Timeline 每条内容查网络。

流程：

```text
Extension startup / alarm
   ↓
GET manifest.json
   ↓
version unchanged -> stop
   ↓
version changed
   ↓
download JSON
   ↓
validate schema
   ↓
verify checksum
   ↓
build local index
   ↓
atomic replace old snapshot
```

下载失败时继续使用最后一个有效版本。

永远不要因为后端不可用让 X 页面卡住。

---

## 14. UI 规范

### 黄框标注

被 Detector 命中的账号推文，加黄框 + 理由标签：

```text
┌────────────────────────────────┐
│ ⚠ 3 人标记为机器人               │  <- 黄框 + 普通理由
│ （推文内容原样显示）              │
│ [标记垃圾并拉黑] [误标？]          │
└────────────────────────────────┘
```

- 黄框只影响样式，**不影响任何内容显示**
- 理由优先显示人数与可理解分类；技术字段留在调试数据，不放主界面
- 只有高置信候选进入当前页面批量列表
- 未命中账号的 X 操作栏仍提供「标记垃圾」入口

### Popup

```text
当前页面 5 个
[列表：每个高置信账号 + 普通理由]
[全部拉黑 5 个]

漏网账号 [@用户名或主页链接] [标记垃圾并拉黑]

社区清理 47 个
[自动排除关注 / 白名单 / 已拉黑]
[一键开始清理] [进度：12 / 47] [暂停] [取消]
今日送走 38 个
```

### 动作反馈

```text
拉黑成功：已送走，全端清净
拉黑失败：没送走：目标不存在 / 菜单没找到 / 超时
误伤恢复：拉错了？放回来（Unblock）
```

---

## 15. 安全边界

### Extension

- 不执行远程代码
- Community YAML / JSON 只是数据
- 所有远程数据先 schema validate
- DOM 输入视为不可信
- 注入 UI 使用 textContent / React escaping
- 不把后端密钥打进扩展
- 不读取 X Cookie

### Backend

- 所有输入 validate
- API rate limit
- 不公开 installation id
- 不公开 IP
- GitHub 只发布聚合数据
- Snapshot build 可复现

### Open Governance

名单公开 ≠ 举报人公开。

我们公开的是：

- 目标
- 分类
- score
- report/rescue 统计
- 可选公开证据
- policy
- changelog

---

## 16. 测试策略

### detector

必须纯单测：

- 名单命中（Strong / Recommended / Candidate + 强度档位）
- 启发式（handle 模式 / 垃圾域名 / 模板文本）
- fingerprint（后期）
- explainability（每个 mark 都有 reason）

### x-adapter reader

Fixture contract test：

```text
fixture HTML -> expected FeedItem
```

### x-adapter actions

使用 mock X menu DOM 测：

- menu open
- menu item find
- confirm
- success detection
- timeout
- unexpected locale
- block + unblock 双向

CI 不执行真实 Block。

### block-queue

状态机单测：

- pending -> running -> success
- failed retry
- cancel
- 持久化恢复

### Extension E2E

Playwright 加载 unpacked extension，使用本地 X-like fixture 页面测试：

```text
render tweet
-> content script detects
-> 黄框标注（不隐藏内容）
-> 加入待拉黑列表
-> queue 状态变化
```

### Manual Smoke Test

每次发布前人工在真实 x.com 验证：

- Home
- Replies
- Search
- Profile
- 中文 / 英文界面
- Light / Dark

---

## 17. 本地质量门禁

不使用 GitHub Actions，检查全部在本地完成。git `pre-push` 钩子（`.githooks/pre-push`）在每次 push 前自动执行：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build:extension
```

手动全量验证：`pnpm verify`。跳过钩子：`git push --no-verify`（仅限紧急）。

克隆后一次性启用钩子：`git config core.hooksPath .githooks`。

Community list PR 的检查（validate / build / checksum / diff）后续以本地脚本形式加入同一钩子。

以后可以增加本地脚本自动生成条目差异摘要：

```text
+12 accounts
-3 accounts
2 status upgrades
5 rescues
```

---

## 18. 实施顺序

### Phase 0 — Skeleton

- pnpm workspace
- WXT extension
- packages/detector
- packages/x-adapter
- packages/block-queue
- Vitest
- Playwright fixtures

验收：扩展能加载，x.com content script 能运行。

### Phase 1 — Read + Detect（黄框标注）

- Timeline / Replies Reader
- FeedItem
- Detector：内置名单 + 启发式
- 黄框 UI + 理由标签

验收：无需网络就能稳定标注；标注可解释；内容零改动。

### Phase 2 — Single Native Action

- X Action Adapter
- Block current account
- Unblock（误伤恢复）
- state / error detection

验收：用户显式点击后可以稳定完成一次 Block / Unblock。

### Phase 3 — Block Queue（一键批量拉黑）

- 待拉黑列表持久化
- 队列状态机
- 进度 / 暂停 / 恢复 / 取消
- MV3 恢复
- 失败原因

验收：跨会话可恢复；取消安全；失败不假装成功。

### Phase 4 — Community Snapshot Consumer

- manifest
- JSON download
- schema / checksum
- local index
- 标注强度

验收：新用户安装后无需配置即可标注公开名单。

### Phase 5 — Community Contribution Backend

- Worker / Hono
- D1 migrations
- Report
- Rescue
- rate limit
- 一安装一账号一张当前票
- 维护者独立来源与审计

验收：用户主动贡献后，后端按净票公式更新最终名单；维护者来源不改变社区票。

### Phase 6 — Open List Pipeline

- policy/v3.yaml
- YAML generator
- JSON builder
- CI
- changelog

验收：名单变化完全可审计、可复现。

### Phase 7 — Fingerprint + Domain

- normalized fingerprint
- domain entities
- campaign foundation

### Phase 8 — Optional AI

只在前面无法判断时调用。

---

## 19. v0.1 Definition of Done

v0.1 不需要后端。

必须做到：

- Chrome / Edge 可安装
- X Home + Replies + Search 基础可工作
- 不明显拖慢滚动
- 黄框标注（内置名单 + 启发式，带理由）
- 待拉黑列表（持久、可增删）
- 一键批量拉黑（Block Queue）
- 单账号 `顺手拉黑`
- 一键撤销（Unblock）
- 本地统计
- 页面内容除黄框外零改动
- X Adapter 有 fixture tests
- Detector / Block Queue 有 unit tests

v0.1 发布时即使 Community API、AI 都不存在，也应该已经是一个真正有价值的产品。

---

## 20. 重要非目标

第一阶段明确不做：

- 任何 Hide / Collapse / 内容替换
- 自动静默拉黑
- 第三方完整 X 客户端
- 强依赖 X Developer API
- 强依赖 X OAuth
- 自动上传浏览历史
- AI 每条 Tweet 扫描
- “观点正确性”审核
- 复杂分布式后端

---

## 21. 最终工程原则

每次要增加新能力时，先问四个问题：

1. **能不能本地识别？**
2. **能不能不增加 X 权限？**
3. **用户能不能知道为什么被标注？**
4. **如果服务器和 AI 全挂了，标注和拉黑还工作吗？**

如果四个答案都处理得好，FeedSieve 才会是一个真正可靠、透明、耐维护的开源清理工具。
