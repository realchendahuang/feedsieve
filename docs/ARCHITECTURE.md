# FeedSieve Architecture

## 总体原则

MVP 采用浏览器扩展，但核心过滤逻辑必须和浏览器 UI、X DOM、AI Provider 解耦。

同时明确一个重要技术原则：

> **FeedSieve 不把 X OAuth / X Developer API 作为 Block / Mute 等原生动作的核心依赖。**

因为 FeedSieve 本身运行在用户已经登录的 `x.com` 页面中。X 已经提供给用户的 Block、Mute、Unblock、Unmute 等操作，应优先通过浏览器页面交互完成。

推荐拆成：

```text
apps/
  extension/                # WXT browser extension

packages/
  filter-engine/            # 独立过滤核心
  x-adapter/                # X Reader + Native Actions
  community-client/         # 社区名单下载、缓存、校验
  shared/                   # types / schemas / utils

services/
  community-api/            # 开源社区后端，只负责 FeedSieve 社区数据
```

推荐技术栈：

- WXT
- TypeScript
- React
- Manifest V3
- WebExtension Storage
- Optional FeedSieve Community API
- Optional OpenAI-compatible provider

## 总体链路

```text
                         FeedSieve
                             │
            ┌────────────────┴────────────────┐
            │                                 │
      Filter Engine                   X Browser Adapter
            │                                 │
            │                      ┌──────────┴──────────┐
            │                      │                     │
       Filter Decision          Reader               Actions
            │                      │                     │
            │                  Timeline               Block
            │                  Replies                Mute
            │                  Search                 Unblock
            │                  Account                Unmute
            │                                         Not interested
            │                                             │
            │                                      Native Action Queue
            │
            ├── Personal Rules
            ├── Community Reputation
            ├── Content Fingerprints
            ├── Domain Reputation
            └── Optional AI
```

核心原则：

> **Read the page. Filter locally. Act through the page.**

## 1. Content Observer

监听 X 的动态页面更新。

要求：

- 支持 SPA 路由
- 避免重复处理同一 DOM 节点
- 尽量在内容进入视野前判断
- X DOM 结构变化后容易维护
- Observer 只负责发现内容，不承担过滤业务逻辑

## 2. X Adapter = Reader + Actions

X Adapter 不再只负责读取页面，而是明确拆成两个能力。

### Reader

负责把 X 页面转成稳定内部结构：

- post id
- author handle
- author stable id（如果能可靠获得）
- display name
- text
- links
- media presence
- reply / repost context
- page context
- visible metadata

内部建议统一为：

```ts
type FeedItem = {
  source: "x";
  postId?: string;
  author: {
    id?: string;
    handle: string;
    displayName?: string;
  };
  text: string;
  links: string[];
  context: "timeline" | "reply" | "search" | "other";
};
```

### Actions

负责帮用户执行 X 页面本来就允许的原生动作：

- block
- unblock
- mute
- unmute
- not interested

FeedSieve 不需要为了这些动作获得用户的 X OAuth Token。

更不应该把用户 Cookie、密码或 X 登录凭证上传到 FeedSieve 后端。

详细设计见 [`X_ACTION_ADAPTER.md`](X_ACTION_ADAPTER.md)。

## 3. Locator Layer

X 的 DOM 经常变化，因此 `x-adapter` 必须维护独立 Locator 层。

优先级建议：

1. `data-testid`
2. `role`
3. `aria-*`
4. 稳定 DOM 相对结构
5. 文本匹配作为 fallback

禁止 `filter-engine` 直接依赖具体 selector。

例如：

```ts
interface XLocators {
  findPostMenu(article: HTMLElement): HTMLElement | null;
  findMenuItem(action: XNativeAction): HTMLElement | null;
  findConfirmDialog(action: XNativeAction): HTMLElement | null;
}
```

X 改版时优先修 Locator，而不是污染 Filter Engine。

## 4. Filter Engine

这是 FeedSieve 真正的技术本体。

它不应该知道自己运行在 Chrome、Firefox，甚至不应该知道当前信息流一定来自 X。

输入：

```ts
FeedItem + UserRules + CommunitySnapshot + Settings
```

输出：

```ts
type Decision = {
  action: "keep" | "collapse" | "hide";
  reason: string;
  category?: string;
  confidence?: number;
  source?: "personal" | "local_rule" | "community" | "heuristic" | "ai";
};
```

### 推荐优先级

```text
Personal Allowlist
    > Personal Blocklist
    > Local Rules
    > Community Rules
    > Heuristics
    > AI
```

用户自己的明确选择永远拥有最高优先级。

## 5. 三层过滤链路

```text
X Page
  |
  v
Content Observer
  |
  v
X Reader / Post Extractor
  |
  v
Feature Normalizer
  |
  +------> Personal Allowlist -> Keep
  |
  v
Layer 1: Local Rules
  |
  +------> confident spam -> Hide
  |
  v
Layer 2: Community Reputation
  |
  +------> community-listed entity -> Hide / Collapse
  |
  v
Duplicate / Fingerprint / Domain Heuristics
  |
  v
Layer 3: Optional AI
  |
  v
Decision
  |
  +------> keep
  +------> collapse
  +------> hide
  |
  v
Local Stats + Explicit Feedback
```

### Layer 1: Local Rules

- keyword
- regex
- account denylist
- account allowlist
- domain list
- repeated content fingerprints
- user-generated rules
- local filter packs

### Layer 2: Community Reputation

不只维护账号信誉，长期建议逐步支持四类实体：

- Account Reputation
- Content Fingerprint Reputation
- Domain Reputation
- Campaign Reputation

这样垃圾账号换号以后，相同模板、相同域名和相同 Campaign 仍然可以被识别。

### Layer 3: Optional AI

AI 只处理规则、信誉和启发式仍然无法判断的模糊内容。

默认不要求 AI Key。

## 6. Community Reputation

社区层不需要在 Timeline 滚动时实时请求服务端。

推荐：

```text
FeedSieve Community API
       |
       v
Open Scoring
       |
       v
YAML Canonical Snapshot
       |
       v
CI Validate / Build
       |
       v
Versioned JSON Snapshot
       |
       v
Extension periodically downloads
       |
       v
Local cache
       |
       v
Filter Engine local lookup
```

### 用户贡献

只有用户明确点击“抬走这个账号”等贡献动作时，才提交报告。

最小 payload：

```ts
{
  accountId?: string,
  handle: string,
  reason: string,
  evidencePostId?: string,
  reporterInstallationId: string,
  timestamp: string
}
```

默认不上传完整浏览历史。

详细设计见 [`COMMUNITY_FILTERING.md`](COMMUNITY_FILTERING.md)。

## 7. Community API

社区后端只负责 FeedSieve 自己的数据，不负责替用户调用 X。

第一版可以使用：

- Cloudflare Workers
- D1 / PostgreSQL
- KV / CDN for versioned filter snapshots

职责：

- 接收显式报告
- 去重
- Reporter Trust
- Community Score
- Sybil / Burst detection
- 生成版本化社区清单
- 提供全量 / 增量下载

明确边界：

```text
X Session Credentials
    -> 永远留在用户浏览器

FeedSieve Community API
    -> 不需要 X Cookie / Password / OAuth Token
```

## 8. Native Action Queue

单账号 Block/Mute 可以直接执行页面动作。

但“一键同步社区名单到 X”必须经过队列。

推荐状态：

```ts
type QueueItem = {
  action: "block_account" | "mute_account" | "unblock_account" | "unmute_account";
  handle: string;
  accountId?: string;
  status: "pending" | "running" | "success" | "failed" | "skipped";
  attempts: number;
  error?: string;
};
```

默认串行执行：

```text
pending
  ↓
running
  ↓
等待菜单 / Dialog / 页面反馈
  ↓
success / failed
  ↓
next
```

原因不是为了伪装真人，而是 X UI 本身是有状态的，不适合多个 Dropdown / Dialog 并发操作。

用户必须可以：

- 查看进度
- 暂停
- 继续
- 停止
- 重试失败项

出现 Challenge、页面结构异常或连续失败时，自动暂停，而不是继续乱点。

## 9. Local Hide 与 X Native Block 分离

这是 FeedSieve 的关键产品边界。

### FeedSieve Local Hide

默认、即时、可撤销：

```text
Community List
   ↓
Local Cache
   ↓
Filter Engine
   ↓
Hide / Collapse
```

### X Native Block / Mute

只有用户明确要求同步时才执行：

```text
User clicks Sync to X
   ↓
Native Action Queue
   ↓
X Browser UI
   ↓
Block / Mute
```

一句话：

> **Hide 是 FeedSieve 自己的能力；Block / Mute 是 FeedSieve 帮用户操作 X 的能力。**

两者都不要求把 FeedSieve 设计成 X API 客户端。

## 10. AI Adapter

AI Provider 必须可插拔，而且只负责模糊判断。

首版可以支持 OpenAI-compatible API：

```text
Provider
- baseURL
- apiKey
- model
- timeout
- prompt template
```

AI 请求只发送完成判断所需的最小信息。

建议 Decision Cache，避免同一内容重复消耗模型调用。

## 11. Storage

### Extension Local

- settings
- allowlist
- personal blocklist
- custom rules
- community snapshot
- stats
- cached decisions
- anonymous reporter identity
- native action queue

### Community Backend

- accounts
- fingerprints
- domains
- campaigns
- reporters
- reports
- list entries
- snapshot versions

## 12. UI

### Inline Action

推文 / 账号附近提供极简操作：

> 抬走

本地立即隐藏后，可追加：

> 已滤。要不要顺手让 X 也别再给你看？

- 不用
- Mute
- Block

### Inline Placeholder

> 已滤，别看了 · 为什么？ · 我偏要看

### Popup

- 今日过滤数量
- 当前过滤强度
- Community Filter 开关
- Native Action Queue 状态
- 今日战报

### Options

- 关键词 / 正则
- 黑白名单
- Filter Packs
- 社区过滤强度
- Native Action 默认策略
- AI Provider
- 隐私设置
- 数据导入导出

## 13. X 改版与测试

`x-adapter` 是最容易因为 X 改版失效的模块。

仓库建议维护：

```text
fixtures/x/
├── timeline/
├── replies/
├── post-menu/
├── block-dialog/
├── mute-state/
└── account-page/
```

测试：

- Locator Unit Tests
- Filter Engine Unit Tests
- Action Queue State Tests
- Extension + Mock DOM Integration Tests
- 每个 Release 的 X Manual Smoke Test

详细 Action 测试规则见 [`X_ACTION_ADAPTER.md`](X_ACTION_ADAPTER.md)。

## 14. 后续扩展

架构从一开始给以下能力留接口：

- Firefox
- Safari
- Community Filter Packs
- 自定义 AI Provider
- 本地模型
- 规则导入导出
- 多语言
- Filter SDK
- Reddit / YouTube / 其他信息流 Adapter

最终原则：

> **Filter Engine 决定“要不要看”；X Action Adapter 帮用户完成“要不要在 X 本身也处理掉”。**
