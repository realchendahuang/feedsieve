# FeedSieve Architecture

## 总体原则

MVP 采用浏览器扩展，但核心过滤逻辑必须和浏览器 UI、X DOM、AI Provider 解耦。

推荐拆成：

```text
apps/
  extension/           # WXT browser extension

packages/
  filter-engine/       # 独立过滤核心
  x-adapter/           # X DOM / account / post extraction
  shared/              # types / schemas / utils

services/
  community-api/       # 可选社区过滤后端
```

推荐技术栈：

- WXT
- TypeScript
- React
- Manifest V3
- WebExtension Storage
- Optional FeedSieve Community API
- Optional OpenAI-compatible provider

## 过滤链路

```text
X Page
  |
  v
Content Observer
  |
  v
X Adapter / Post Extractor
  |
  v
Feature Normalizer
  |
  +------> Personal Allowlist -> Keep
  |
  v
Layer 1: Local Rule Engine
  |
  +------> confident spam -> Hide
  |
  v
Layer 2: Community Reputation
  |
  +------> community-listed account -> Hide / Collapse
  |
  v
Layer 3: Optional AI Classifier
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

## 1. Content Observer

监听 X 的动态页面更新。

要求：

- 支持 SPA 路由
- 避免重复处理同一 DOM 节点
- 尽量在内容进入视野前判断
- X DOM 结构变化后容易维护
- Observer 只负责发现内容，不承担过滤业务逻辑

## 2. X Adapter

负责把 X 页面转成稳定的内部结构。

尽量提取：

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

不要让 `filter-engine` 直接依赖具体 CSS selector。

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

## 3. Filter Engine

这是 FeedSieve 真正的技术本体。

它不应该知道自己运行在 Chrome、Firefox 还是未来其他信息流里。

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
  source?: "personal" | "community" | "ai";
};
```

### Layer 1: Local Rules

本地规则支持：

- keyword
- regex
- account denylist
- account allowlist
- domain list
- repeated content fingerprints
- user-generated rules
- local filter packs

优先级建议：

```text
Personal Allowlist
    > Personal Blocklist
    > Local Rules
    > Community Rules
    > AI
```

用户自己的明确决定永远拥有最高优先级。

## 4. Community Reputation

社区层不需要实时请求服务端。

推荐工作方式：

```text
FeedSieve Community API
       |
       v
Versioned Filter Snapshot
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

这样 Timeline 滚动时仍然是纯本地匹配，不会因为服务器响应速度影响页面。

快照建议包含：

```ts
type CommunityAccountEntry = {
  accountId?: string;
  handle: string;
  category: string;
  score: number;
  status: "candidate" | "recommended" | "strong";
  updatedAt: string;
};
```

### 用户贡献

只有用户明确点击“抬走这个账号”时，才向服务端提交报告。

建议最小 payload：

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

## 5. Community API

社区共创需要一个很小的后端，而不是大型平台。

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
- 提供增量 / 全量下载

浏览器扩展不应该在滚动 Timeline 时逐条查询 Community API。

## 6. AI Adapter

AI Provider 必须可插拔，而且只负责第三层模糊判断。

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

建议加入 Decision Cache，避免同一内容重复消耗模型调用。

## 7. Storage

### Extension Local

- settings
- allowlist
- personal blocklist
- custom rules
- community snapshot
- stats
- cached decisions
- anonymous reporter identity

### Community Backend

- accounts
- reporters
- reports
- list entries
- snapshot versions

## 8. UI

### Inline Action

在 X 推文 / 账号附近提供极简操作：

> 抬走

点击后可选择原因，并允许用户决定：

- 只对我隐藏
- 同时匿名贡献给社区

### Inline Placeholder

内容被折叠时只显示：

> 已滤，别看了 · 为什么？ · 我偏要看

### Popup

- 今日过滤数量
- 当前过滤强度
- Community Filter 开关
- 今日战报

### Options

- 关键词 / 正则
- 黑白名单
- Filter Packs
- 社区过滤强度
- AI Provider
- 隐私设置
- 数据导入导出

## 9. Action 与 X 原生 Block 分离

FeedSieve 自己的 `hide / collapse` 是核心动作。

X 原生的 `mute / block` 应该作为可选同步能力，而不是核心依赖。

这样可以：

- 不依赖 X 写 API
- 一键撤销社区清单
- 避免批量修改用户账号状态
- 让过滤在没有 X Developer API 的情况下正常工作

## 10. 后续扩展

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
