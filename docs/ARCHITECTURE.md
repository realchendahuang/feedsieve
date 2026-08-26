# FeedSieve Architecture

> Canonical implementation details: [`TECHNICAL_SPEC.md`](TECHNICAL_SPEC.md)

## 1. 总体原则

FeedSieve 的第一产品形态是浏览器扩展，真正的技术本体是独立 Filter Engine。

核心原则：

> **Local first. Community second. AI third. Browser-native actions when needed.**

也就是：

- 本地规则先过滤
- 社区公开信誉其次
- AI 只处理模糊内容
- X 原生 Block / Mute 等动作通过当前已登录的网页完成
- 不把 X OAuth / Developer API 作为核心依赖

## 2. 总体架构

```text
                          FeedSieve
                              │
        ┌─────────────────────┴─────────────────────┐
        │                                           │
 Browser Extension                           Open Community
        │                                           │
   ┌────┴─────┐                              Reports / Rescue
   │          │                                    │
Reader     Actions                                  │
Adapter    Adapter                                  │
   │          │                                     │
   v          v                                     │
FeedItem   X Native UI                              │
   │                                                │
   └──────────────────> Filter Engine <─────────────┘
                             │
               ┌─────────────┼─────────────┐
               │             │             │
          Personal       Community      Optional AI
               │             │
               │        Local Snapshot
               │             │
               └─────── Decision ──────────┘
                             │
                    KEEP / COLLAPSE / HIDE
```

## 3. Monorepo

```text
apps/
  extension/               # WXT + React + Manifest V3

packages/
  filter-engine/           # 与 X / 浏览器解耦的核心判断
  x-adapter/               # X Reader + Action Adapter
  community-client/        # 快照下载 / 缓存 / 校验
  list-format/             # YAML / JSON / Schema
  shared/

services/
  community-api/           # Report / Rescue / Score / Snapshot

community/
  source/                  # 人类可读 YAML
  lists/                   # Extension 读取的 JSON
  policy/                  # 公开评分阈值
  schema/
  changelog/

fixtures/x/                # X DOM 回归测试
```

## 4. Browser Extension 上下文

### Content Script

负责：

- 观察 X SPA DOM
- 提取 FeedItem
- 调用 Filter Engine
- Inline UI
- Hide / Collapse
- X Action Adapter 页面动作

默认使用 isolated world。

### Service Worker

负责：

- Community Snapshot 更新
- 设置迁移
- Report / Rescue 网络请求
- Action Queue 持久化协调
- Popup / Content Script 消息

Manifest V3 service worker 会休眠，关键状态不能只保存在内存。

### Popup / Options

Popup 做高频操作，Options 做规则、名单、隐私、Filter Pack 等高级配置。

## 5. X Reader Adapter

Reader Adapter 把不断变化的 X DOM 转成稳定内部模型：

```ts
type FeedItem = {
  source: 'x';
  postId?: string;
  author: {
    xUserId?: string;
    handle: string;
    displayName?: string;
  };
  text: string;
  links: Array<{ href: string; display?: string }>;
  context: 'timeline' | 'reply' | 'search' | 'profile' | 'other';
};
```

`xUserId` 允许为空。插件不应为了获取稳定 ID 强依赖 X API 或私有 runtime。

Selector 必须集中维护：

```text
packages/x-adapter/src/selectors/
```

优先级：

1. data-testid / role
2. href / DOM 语义
3. aria label
4. locale text fallback

不要依赖单个易变 CSS class。

## 6. Filter Engine

固定优先级：

```text
Personal Allowlist
    > Personal Blocklist
    > Keyword / Regex / Domain
    > Content Fingerprint
    > Community Reputation
    > Heuristic
    > Optional AI
```

输出必须可解释：

```ts
type Decision = {
  action: 'keep' | 'collapse' | 'hide';
  source: string;
  reason: string;
  category?: string;
  confidence?: number;
  ruleId?: string;
};
```

## 7. Community Snapshot

Timeline 滚动时不实时访问后端。

```text
Community API / GitHub
       ↓
manifest.json
       ↓
version changed?
       ↓
recommended.json
       ↓
schema + checksum
       ↓
local index
       ↓
Filter Engine lookup
```

服务器挂掉时继续使用上一个有效 Snapshot。

### YAML / JSON

- `community/source/*.yaml`: 可读、可 Review、可 Fork
- `community/lists/*.json`: 运行时构建产物
- `community/policy/v1.yaml`: 公开评分政策

`x_user_id` 为 optional，`handle` 是 MVP 必需字段。

## 8. Community API

只负责 FeedSieve 自己的社区系统：

```text
POST /v1/reports
POST /v1/rescues
GET  /v1/snapshots/latest
```

不负责替用户操作 X，也不需要用户 X OAuth。

只上传用户主动贡献的数据，不上传完整浏览历史。

## 9. X Action Adapter

详见 [`X_ACTION_ADAPTER.md`](X_ACTION_ADAPTER.md)。

核心原则：

> **Read the page. Filter locally. Act through the page.**

### v0.1

先实现单账号：

```text
抬走
-> Local Hide
-> 可选「顺手拉黑」
-> 打开 X 原生菜单
-> Block
-> 等待页面成功反馈
```

### 批量原生动作

后续使用持久化 `Native Action Queue`，不是简单 for-loop。

必须：

- 用户显式启动
- 进度
- 暂停 / 恢复 / 取消
- 页面成功反馈
- 异常自动停止
- MV3 service worker 重启后可恢复

默认“一键启用社区名单”只做 FeedSieve 本地过滤，不自动执行成千上万次 X Block。

## 10. Local Storage

- `chrome.storage.local`: settings / personal rules / small lists / queue metadata
- `chrome.storage.sync`: 少量可同步设置
- IndexedDB: large snapshot / fingerprint index / large history

## 11. Content Fingerprint / Domain

账号会换，垃圾模板和诈骗域名可能继续存在。

因此长期 Community Entity 设计为：

```text
Account
Content Fingerprint
Domain
Campaign
```

第一阶段只实施 Account；接口从一开始保留扩展能力。

## 12. Testing

### Unit

Filter Engine 纯单测。

### Fixture Contract

```text
X fixture HTML -> expected FeedItem
```

### Action Mock

X 原生菜单使用 fixture 测试，不在 CI 中真实 Block。

### Manual Smoke

发布前真实 X 检查：

- Home
- Replies
- Search
- Profile
- 中文 / 英文
- Light / Dark

## 13. 技术基线

推荐：

- WXT
- TypeScript
- React
- Manifest V3
- Vitest
- Playwright
- Cloudflare Workers + Hono + D1
- JSON Schema
- YAML + deterministic JSON build

## 14. 设计非目标

第一阶段不做：

- 完整第三方 X 客户端
- X OAuth 作为必需能力
- X Developer API 作为核心依赖
- 每条 Tweet 调 AI
- 默认上传浏览历史
- 后台偷偷批量 Block
- “观点正确性”审核

后续开发请优先遵循 [`TECHNICAL_SPEC.md`](TECHNICAL_SPEC.md) 的阶段和验收标准。
