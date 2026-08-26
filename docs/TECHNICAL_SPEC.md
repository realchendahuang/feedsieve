# FeedSieve Technical Specification

> Status: implementation baseline  
> Updated: 2026-08-26  
> Target: v0.1 → v0.3

这份文档是 FeedSieve 后续开发的**主技术规范**。如果 README、旧讨论或其他设计文档与这里冲突，以本文件和对应 ADR / Schema 为准。

## 1. 核心技术结论

FeedSieve 的第一产品形态是浏览器扩展，但真正的技术本体是独立 Filter Engine。

总原则：

> **Local first. Community second. AI third. Browser-native actions when needed.**

对应到工程实现：

1. **本地过滤优先**：关键词、正则、个人黑白名单、域名、重复模板等全部本地完成。
2. **社区信誉其次**：插件定期下载公开的社区快照，刷 Timeline 时只做本地查询，不逐条请求后端。
3. **AI 只做模糊判断**：没有 AI Key 也必须是完整可用产品。
4. **X 原生操作走浏览器页面**：Block / Mute 等操作优先由 X Action Adapter 辅助用户在已登录的 `x.com` 页面中完成，不把 X OAuth / Developer API 作为核心依赖。
5. **公开透明**：前端、后端、评分规则、名单源文件、构建产物和治理逻辑全部开源。
6. **用户最终控制**：Personal Allowlist 永远可以覆盖 Community / AI 的自动判断。

一句话架构：

```text
x.com
  │
  ├── X Reader Adapter ──> FeedItem
  │                           │
  │                           v
  │                    Filter Engine
  │                ┌──────────┼──────────┐
  │                │          │          │
  │             Personal   Community   Optional AI
  │                │          │
  │                └──── Decision ──────┘
  │                           │
  │                  KEEP / COLLAPSE / HIDE
  │
  └── X Action Adapter ──> user-initiated Block / Mute / ...

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
│   ├── filter-engine/
│   │   ├── src/pipeline/
│   │   ├── src/rules/
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
│   ├── source/
│   │   ├── recommended.yaml
│   │   └── packs/
│   ├── lists/
│   │   ├── manifest.json
│   │   ├── recommended.json
│   │   └── packs/
│   ├── policy/
│   │   └── v1.yaml
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
- 调用本地 Filter Engine
- 折叠 / 隐藏内容
- 注入极简 UI
- 执行 X Action Adapter 的页面点击动作

默认运行在 **ISOLATED world**。

不要为了方便直接把所有代码注入 MAIN world。只有未来确实需要读取页面 JS runtime 且没有稳定 DOM 替代方案时，才单独建立最小化 main-world bridge。

### 3.2 Extension Service Worker

职责：

- Community Snapshot 定期检查更新
- Extension settings / version migration
- Native Action Queue 的持久化协调
- Popup / Options / Content Script 消息路由
- 后端 Report / Rescue 请求

Manifest V3 service worker 会被浏览器回收，因此：

> **不能把关键状态只放全局变量。**

队列、下载版本、重试状态等必须持久化。

### 3.3 Popup / Options

Popup 只承担高频操作：

- 今日过滤数量
- 开关
- 当前过滤强度
- 社区包状态
- 今日战报入口

Options 承担复杂配置：

- 个人黑白名单
- Keyword / Regex
- Filter Packs
- 社区隐私设置
- Action Queue 设置
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

如果 Native Action Queue 需要定时恢复，再增加 `alarms`。

不要申请：

- cookies
- webRequest（除非出现无法替代的明确需求）
- X OAuth credential
- 用户密码

原则：

> **能靠当前页面完成的，不拿更高权限。**

---

## 5. X Reader Adapter

`packages/x-adapter` 是 FeedSieve 最需要长期维护的工程边界。

X 经常调整 DOM。如果 Filter Engine 到处直接写 selector，项目很快会失控。

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

## 6. Filter Engine

Filter Engine 不知道 DOM，也不知道 Chrome。

接口：

```ts
export type FilterContext = {
  item: FeedItem;
  userRules: UserRules;
  community: CommunityIndex;
  settings: FilterSettings;
};

export type Decision = {
  action: 'keep' | 'collapse' | 'hide';
  source:
    | 'allowlist'
    | 'personal_account'
    | 'keyword'
    | 'regex'
    | 'domain'
    | 'fingerprint'
    | 'community'
    | 'heuristic'
    | 'ai';
  reason: string;
  category?: string;
  confidence?: number;
  ruleId?: string;
  evidence?: Record<string, unknown>;
};
```

### 6.1 决策优先级

固定为：

```text
1. Personal Allowlist       -> KEEP
2. Personal Blocklist       -> HIDE
3. Explicit local rules     -> COLLAPSE / HIDE
4. Domain / Fingerprint     -> COLLAPSE / HIDE
5. Community Reputation     -> COLLAPSE / HIDE
6. Heuristic                -> COLLAPSE
7. Optional AI              -> COLLAPSE / HIDE
8. Default                  -> KEEP
```

个人白名单是最高优先级。

### 6.2 v0.1 Local Rules

必须实现：

- Account denylist / allowlist
- Keyword
- Exact phrase
- Regex
- Basic repeated content

建议规则结构：

```ts
export type LocalRule = {
  id: string;
  type: 'account' | 'keyword' | 'phrase' | 'regex' | 'domain';
  pattern: string;
  action: 'collapse' | 'hide';
  enabled: boolean;
};
```

### 6.3 Content Fingerprint

从 v0.2/v0.3 开始加入，解决“垃圾账号换号但话术不换”的问题。

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

v0.1 先把接口留出来，不阻塞账号过滤主线。

---

## 7. Community Reputation

### 7.1 核心原则

> **一个人发现垃圾，所有人都可以少看一次。**

但社区层不等于“5 人举报就永久封禁”。

状态：

```text
normal
candidate
recommended
strong
```

### 7.2 公开 Policy，不硬编码

阈值和评分配置放：

```text
community/policy/v1.yaml
```

第一版建议：

```yaml
candidate:
  min_independent_reports: 5

recommended:
  min_effective_score: 8
  min_distinct_days: 2
  max_rescue_ratio: 0.25

strong:
  min_effective_score: 20
  min_distinct_days: 3
  max_rescue_ratio: 0.15
```

这些数字是冷启动默认值，不是永恒真理。以后用公开 PR 修改。

### 7.3 Community Score v1

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

不要第一版用 ML 黑盒决定名单。

### 7.4 Reporter Trust v1

第一版：

- 新安装实例默认 trust = 1.0
- 一个 installation 对一个目标只能有一个当前有效 vote
- 连续异常大量举报降低权重
- 长期和社区结果一致可缓慢提升
- 经常被 Rescue 推翻则降低
- trust 设置上下限

不要求用户注册。

浏览器本地生成随机 installation id；后续再考虑签名身份。

### 7.5 Rescue

区分：

- `我偏要看`: 只本地展开，不产生社区投票
- `这条还能抢救`: 显式 Community Rescue Vote

这是防误判的重要区别。

---

## 8. Community YAML / JSON 协议

### 8.1 YAML 是公开审计源

```text
community/source/recommended.yaml
```

作用：

- GitHub 易读
- PR 审核
- Git Diff
- Fork
- 人工 Appeal / Review

### 8.2 JSON 是运行时产物

```text
community/lists/recommended.json
```

作用：

- Extension 下载
- 快速解析
- Schema validate
- checksum / signature
- CDN cache

构建链：

```text
DB / governance change
      ↓
generate YAML snapshot
      ↓
JSON Schema validation
      ↓
deterministic YAML -> JSON
      ↓
checksum
      ↓
Git commit / release
      ↓
extension update
```

### 8.3 Account Entry v1

`x_user_id` 不再作为必须字段：

```yaml
- handle: example_spam
  x_user_id: "123456789" # optional
  aliases:
    - old_handle
  category: bot_spam
  status: recommended
  community_score: 0.91
  report_count: 27
  rescue_count: 2
  first_seen_at: "2026-08-20T12:00:00Z"
  updated_at: "2026-08-26T00:00:00Z"
  evidence_post_ids:
    - "0000000000000000000"
```

### 8.4 Snapshot Manifest

建议增加：

```text
community/lists/manifest.json
```

内容：

```json
{
  "schema_version": 1,
  "snapshot_version": "2026.08.26.1",
  "generated_at": "2026-08-26T00:00:00Z",
  "files": [
    {
      "path": "recommended.json",
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
recommended/00.json
recommended/01.json
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
GET  /v1/snapshots/latest
GET  /v1/accounts/:handle        # optional explainability endpoint
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
- id
- handle
- x_user_id nullable
- status
- community_score
- first_seen_at
- updated_at

account_aliases
- account_id
- handle
- first_seen_at
- last_seen_at

reporters
- installation_id_hash
- trust_score
- created_at
- updated_at

votes
- reporter_id
- account_id
- kind(report|rescue)
- reason
- evidence_post_id nullable
- created_at
- updated_at

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
mute
unblock
unmute
not-interested (future)
```

默认由 Content Script 在用户当前登录的 X 页面中完成。

### 10.2 Single Action 先行

v0.1 只实现：

```text
当前 Tweet / Profile
  ↓
用户点「抬走」
  ↓
FeedSieve Local Hide
  ↓
可选「顺手拉黑」
  ↓
X Action Adapter 打开原生菜单并执行 Block
```

先把单账号流程做稳定。

### 10.3 Native Action Queue

批量原生 Block 不进入 v0.1 核心验收。

后续 Queue 结构：

```ts
type NativeActionTask = {
  id: string;
  type: 'block' | 'mute' | 'unblock' | 'unmute';
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

默认社区名单的“一键启用”仍然是 FeedSieve 本地 Hide，不是几千次原生 Block。

---

## 11. 本地存储

建议分层：

### chrome.storage.local

适合：

- settings
- personal rules
- allowlist / small blocklist
- snapshot version
- queue metadata
- daily stats

### chrome.storage.sync

只放很小的用户设置，例如：

- 过滤模式
- UI preference

不要放大名单。

### IndexedDB

适合：

- 大型 Community Snapshot
- Fingerprint index
- 历史 decision cache
- 大量 Action Queue history

从架构上使用 `CommunityStore` 接口隔离存储实现。

---

## 12. Community Snapshot 更新

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

## 13. UI 规范

### Inline Action

默认尽量不占空间。

建议 hover 或 `...` 附近提供：

> 抬走

点击后：

```text
这条味儿不对，抬走了。

[只在福滤娃隐藏]
[顺手拉黑]
[贡献给社区]
```

### Placeholder

```text
已滤，别看了 · 为什么？ · 我偏要看
```

### Why Drawer

必须可解释：

```text
Community · Bot Spam
Score 0.91
27 Reports / 2 Rescue

[查看公开名单]
[这条还能抢救]
[自己人，别开枪]
```

### Filter Strength

普通用户只暴露三档：

- 清爽：Strong
- 标准：Strong hide + Recommended collapse
- 大扫除：Strong + Recommended hide，Candidate collapse

高级规则放 Options。

---

## 14. 安全边界

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

## 15. 测试策略

### filter-engine

必须纯单测：

- allowlist precedence
- blocklist precedence
- keyword
- regex
- fingerprint
- community threshold
- explainability

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

CI 不执行真实 Block。

### Extension E2E

Playwright 加载 unpacked extension，使用本地 X-like fixture 页面测试：

```text
render tweet
-> content script detects
-> filter engine decision
-> collapse
-> restore
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

## 16. CI

PR 必跑：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm test:fixtures
pnpm build:extension
pnpm community:validate
pnpm community:build
```

Community list PR：

1. validate YAML
2. build JSON
3. JSON Schema validate
4. ensure deterministic output
5. generate checksum
6. show entry count diff

以后可以增加 GitHub Bot 自动评论：

```text
+12 accounts
-3 accounts
2 status upgrades
5 rescues
```

---

## 17. 实施顺序

### Phase 0 — Skeleton

- pnpm workspace
- WXT extension
- packages/filter-engine
- packages/x-adapter
- Vitest
- Playwright fixtures

验收：扩展能加载，x.com content script 能运行。

### Phase 1 — Read + Local Hide

- Timeline / Replies Reader
- FeedItem
- personal blocklist
- keyword / regex
- collapse / hide UI
- “我偏要看”

验收：无需网络就能稳定过滤。

### Phase 2 — Single Native Action

- X Action Adapter
- Block current account
- Mute current account（可后补）
- state / error detection

验收：用户显式点击后可以辅助完成一次 X 原生动作。

### Phase 3 — Community Snapshot Consumer

- manifest
- JSON download
- schema / checksum
- local index
- Filter Pack UI

验收：新用户安装后无需配置即可使用公开名单。

### Phase 4 — Community Contribution Backend

- Worker / Hono
- D1 migrations
- Report
- Rescue
- rate limit
- score v1

验收：用户主动贡献后，后端可聚合并生成候选结果。

### Phase 5 — Open List Pipeline

- policy/v1.yaml
- YAML generator
- JSON builder
- CI
- changelog

验收：名单变化完全可审计、可复现。

### Phase 6 — Native Action Queue

- persistent queue
- progress UI
- pause / resume / cancel
- failure recovery

验收：小批量用户主动任务可恢复执行；异常时安全停止。

### Phase 7 — Fingerprint + Domain

- normalized fingerprint
- domain entities
- campaign foundation

### Phase 8 — Optional AI

只在前面无法判断时调用。

---

## 18. v0.1 Definition of Done

v0.1 不需要后端。

必须做到：

- Chrome / Edge 可安装
- X Home + Replies 可工作
- 不明显拖慢滚动
- Account Blocklist / Allowlist
- Keyword / Regex
- Inline `抬走`
- Hide / Collapse
- `我偏要看`
- Why reason
- 本地统计
- 单账号 `顺手拉黑` 至少在一个主要语言界面稳定工作
- X Adapter 有 fixture tests
- Filter Engine 有 unit tests

v0.1 发布时即使 Community API、AI、批量 Queue 都不存在，也应该已经是一个真正有价值的产品。

---

## 19. 重要非目标

第一阶段明确不做：

- 第三方完整 X 客户端
- 强依赖 X Developer API
- 强依赖 X OAuth
- 自动上传浏览历史
- AI 每条 Tweet 扫描
- 后台偷偷批量 Block
- “观点正确性”审核
- 复杂分布式后端

---

## 20. 最终工程原则

每次要增加新能力时，先问四个问题：

1. **能不能本地做？**
2. **能不能不增加 X 权限？**
3. **用户能不能知道为什么被过滤？**
4. **如果服务器和 AI 全挂了，基础产品还工作吗？**

如果四个答案都处理得好，FeedSieve 才会是一个真正可靠、透明、耐维护的开源过滤器。
