# FeedSieve Architecture

> Canonical implementation details: [`TECHNICAL_SPEC.md`](TECHNICAL_SPEC.md)

## 1. 总体原则

FeedSieve 的第一产品形态是浏览器扩展，真正的技术本体是独立 Block Engine（Detector + Block Queue）。

核心原则：

> **可见优先，拉黑唯一。Local detect. Community list. AI last. Native Block through the page.**

也就是：

- Detector 黄框标注垃圾账号，**永不隐藏内容**
- 社区公开名单在本地查询，提供识别弹药
- AI 只识别模糊案例
- 拉黑全部通过用户已登录页面原生菜单完成，不把 X OAuth / Developer API 作为核心依赖
- 每个 Block 由用户显式触发，误伤可撤销（原生 Unblock）

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
   └────────────────> Detector <────────────────────┘
                        │
                  黄框标注（带理由，不隐藏）
                        │
                  待拉黑列表（持久）
                        │
                  Block Queue
                        │
             原生 Block / Unblock
             全端生效 + 阻断互动
```

## 3. Monorepo

```text
apps/
  extension/               # WXT + React + Manifest V3

packages/
  detector/                # 识别标注（纯逻辑，与 X / 浏览器解耦）
  x-adapter/               # X Reader + Action Adapter
  block-queue/             # 持久化拉黑队列
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
- 调用 Detector
- 黄框标注 UI（理由标签、勾选）
- 执行 X Action Adapter 的页面动作

默认使用 isolated world。

### Service Worker

负责：

- Community Snapshot 更新
- 设置迁移
- Report / Rescue 网络请求
- Block Queue 持久化协调
- Popup / Content Script 消息

Manifest V3 service worker 会休眠，关键状态不能只保存在内存。

### Popup / Options

Popup 做高频操作：待拉黑列表（增删）、一键拉黑入口、今日统计、开关。

Options 做高级配置：名单订阅、启发式开关、标注强度、隐私设置。

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

## 6. Detector

Detector 不知道 DOM，也不知道 Chrome。它只回答一个问题：**这个账号 / 内容像不像垃圾。**

```ts
type MarkVerdict = {
  mark: boolean;
  reason: string;            // 可解释理由，必须非空
  source: 'community' | 'heuristic' | 'fingerprint' | 'domain' | 'ai';
  category?: string;         // bot_spam / adult_gray_traffic / ...
  confidence?: number;
};
```

识别信号优先级：

```text
1. Community 名单命中（Strong / Recommended / Candidate，按标注强度）
2. 本地启发式（机器人账号特征 / 垃圾域名 / 模板文本）
3. Content Fingerprint / Domain 信誉（后期）
4. Optional AI（最后）
```

每个标注必须可解释——用户点击黄框就能看到「为什么」。

## 7. 黄框标注 UI

- 黄框 + 理由标签（如「名单命中 · bot_spam」）
- 可勾选 / 取消勾选
- 「顺手拉黑」入口
- **绝不隐藏、折叠、替换任何页面内容**

标注账号自动进入「待拉黑列表」（按 handle 去重）。

## 8. Block Queue

批量拉黑是持久化队列，不是 for-loop。详见 [`X_ACTION_ADAPTER.md`](X_ACTION_ADAPTER.md)。

要求：

- 用户显式启动
- 慢速逐个执行，验证页面成功反馈后再进入下一项
- 进度 / 暂停 / 恢复 / 取消
- MV3 service worker 重启后状态不丢
- 登录异常 / 风控页面立即停
- 失败任务有明确原因，不假装成功

默认只处理用户在「待拉黑列表」中确认过的账号；不自动执行。

## 9. Community Snapshot

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
Detector lookup
```

服务器挂掉时继续使用上一个有效 Snapshot。

### YAML / JSON

- `community/source/*.yaml`: 可读、可 Review、可 Fork
- `community/lists/*.json`: 运行时构建产物
- `community/policy/v1.yaml`: 公开评分政策

`x_user_id` 为 optional，`handle` 是 MVP 必需字段。

## 10. Community API

只负责 FeedSieve 自己的社区系统：

```text
POST /v1/reports
POST /v1/rescues
GET  /v1/snapshots/latest
```

不负责替用户操作 X，也不需要用户 X OAuth。

只上传用户主动贡献的数据，不上传完整浏览历史。

## 11. X Action Adapter

详见 [`X_ACTION_ADAPTER.md`](X_ACTION_ADAPTER.md)。

核心原则：

> **Read the page. Mark locally. Block through the page.**

### v0.1

```text
黄框账号
-> 顺手拉黑 / 一键批量拉黑
-> 打开 X 原生菜单
-> Block
-> 等待页面成功反馈
-> 误伤 -> 原生 Unblock 一键放回
```

## 12. Local Storage

- `chrome.storage.local`: settings / 待拉黑列表 / queue metadata / 名单版本 / 统计
- `chrome.storage.sync`: 少量可同步设置
- IndexedDB: large snapshot / 队列历史 / 识别缓存

## 13. Content Fingerprint / Domain

账号会换，垃圾模板和诈骗域名可能继续存在。

长期 Community Entity 设计为：

```text
Account
Content Fingerprint
Domain
Campaign
```

第一阶段只实施 Account；Detector 接口从一开始保留扩展能力。

## 14. Testing

### Unit

Detector 纯单测；Block Queue 状态机单测。

### Fixture Contract

```text
X fixture HTML -> expected FeedItem
```

### Action Mock

X 原生菜单使用 fixture 测试（Block / Unblock / 超时 / 语言回退），不在 CI 中真实 Block。

### E2E

Playwright 加载 unpacked extension，使用本地 X-like fixture 页面：

```text
render tweet -> detect -> 黄框标注 -> 加入待拉黑列表 -> queue 状态变化
```

### Manual Smoke

发布前真实 X 检查：

- Home
- Replies
- Search
- Profile
- 中文 / 英文
- Light / Dark

## 15. 技术基线

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

## 16. 设计非目标

第一阶段不做：

- 任何 Hide / Collapse / 内容替换
- 自动静默拉黑（必须用户显式触发）
- 完整第三方 X 客户端
- X OAuth 作为必需能力
- X Developer API 作为核心依赖
- 每条 Tweet 调 AI
- 默认上传浏览历史
- “观点正确性”审核

后续开发请优先遵循 [`TECHNICAL_SPEC.md`](TECHNICAL_SPEC.md) 的阶段和验收标准。
