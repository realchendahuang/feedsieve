# FeedSieve X Action Adapter

## 1. 核心结论

FeedSieve 是运行在 `x.com` 页面上的浏览器扩展，因此对于 X 已经暴露给登录用户的原生操作，默认不需要把产品设计成一个 X API 客户端。

核心原则：

> **Read the page. Filter locally. Act through the page.**

也就是说：

- 读取 X 页面：通过 Content Script / DOM Adapter
- FeedSieve 自己的 Hide / Collapse：完全本地完成
- X 原生 Mute / Block / Unmute / Unblock：通过用户当前已登录的 X 页面完成
- Community API：只负责 FeedSieve 自己的社区报告、评分、名单发布，不负责替用户调用 X
- 不把 X OAuth / X Developer API 作为核心依赖

FeedSieve 不需要获得用户的 X Access Token，也不需要存储用户的 X Cookie、密码或 OAuth Credential。

---

## 2. 为什么浏览器 Action Adapter 更合理

用户安装 FeedSieve 后，本来就在浏览器中登录并使用 X。

X 网页已经允许用户手动完成：

- Block
- Mute
- Unblock
- Unmute
- Not interested / Show fewer
- Follow / Unfollow
- Report

因此 FeedSieve 可以把这些原本需要多次点击的操作封装成更快、更清晰的浏览器交互。

例如用户看到垃圾账号时：

```text
用户点击「抬走」
      ↓
FeedSieve 本地立即隐藏
      ↓
是否顺手同步到 X？
      ↓
[不用]        [Mute]        [Block]
                             ↓
                    X Action Adapter
                             ↓
                      打开原生菜单
                             ↓
                       点击 Block
                             ↓
                        点击确认
                             ↓
                    等待页面成功反馈
```

这条链路不要求 X OAuth。

---

## 3. 两类动作必须严格分开

### A. FeedSieve Local Actions

这是核心能力，完全由插件掌控：

- `hide`
- `collapse`
- `show`
- `personal_block`
- `personal_allow`
- `community_rescue`

特点：

- 极快
- 可撤销
- 不修改用户 X 账号状态
- 不依赖网络
- 不依赖 X API
- X 原生功能变化时仍然可以工作

### B. X Native Actions

这是增强能力，通过页面交互帮助用户执行 X 原生动作：

- `mute_account`
- `unmute_account`
- `block_account`
- `unblock_account`
- `not_interested`
- 后续可评估 `report_account`

原则：

> **Native Action 是用户明确要求 FeedSieve 帮他完成的一组浏览器操作，不是 FeedSieve 过滤引擎的必要条件。**

即使全部 Native Action 失效，FeedSieve 的核心过滤仍然必须正常工作。

---

## 4. X Adapter 拆成 Reader 与 Actions

推荐包结构：

```text
packages/x-adapter/
├── src/
│   ├── reader/
│   │   ├── observer.ts
│   │   ├── post-extractor.ts
│   │   ├── account-extractor.ts
│   │   ├── timeline.ts
│   │   ├── replies.ts
│   │   └── search.ts
│   │
│   ├── actions/
│   │   ├── block.ts
│   │   ├── unblock.ts
│   │   ├── mute.ts
│   │   ├── unmute.ts
│   │   ├── not-interested.ts
│   │   └── shared.ts
│   │
│   ├── locators/
│   │   ├── post.ts
│   │   ├── menus.ts
│   │   ├── dialogs.ts
│   │   └── account.ts
│   │
│   ├── action-queue/
│   │   ├── queue.ts
│   │   ├── state-machine.ts
│   │   ├── executor.ts
│   │   └── persistence.ts
│   │
│   └── types.ts
```

`reader/` 只负责理解 X。

`actions/` 只负责操作 X。

`filter-engine/` 不允许直接 import X DOM selector。

---

## 5. 不依赖脆弱 CSS Class

X 的前端结构会变化，因此 Action Adapter 不应该大量依赖自动生成的 class name。

优先级建议：

1. 稳定的 `data-testid`
2. `role`
3. `aria-*`
4. DOM 相对结构
5. 文本匹配作为最后 fallback

不要：

```ts
document.querySelector('.css-1dbjc4n.r-18u37iz...')
```

更推荐由统一 Locator 层提供：

```ts
interface XLocators {
  findPostMenu(article: HTMLElement): HTMLElement | null;
  findMenuItem(action: XNativeAction): HTMLElement | null;
  findConfirmDialog(action: XNativeAction): HTMLElement | null;
}
```

如果 X 改版，只修 Locator，而不是修改整个 Filter Engine。

---

## 6. 页面点击策略

优先使用页面真实存在、用户本来可以点击的控件。

典型流程：

```text
找到目标 Post / Account
      ↓
找到真实菜单按钮
      ↓
.click()
      ↓
等待 Dropdown 出现
      ↓
找到 Block / Mute MenuItem
      ↓
.click()
      ↓
如存在确认 Dialog，点击确认
      ↓
观察 DOM / Toast / 状态变化
      ↓
返回 ActionResult
```

第一实现优先使用 `HTMLElement.click()`。

如果某些组件要求更完整的事件链，可由统一 Event Helper 发送浏览器事件，但目标依然必须是页面真实 UI 控件。

FeedSieve 不应该实现绕过验证码、绕过平台安全检查、隐藏自动化痕迹等机制。

平台要求用户重新确认、出现 Challenge 或无法继续时，应停止队列并提示用户。

---

## 7. Action Result

所有 X 原生动作必须返回统一结果：

```ts
type XNativeAction =
  | 'mute_account'
  | 'unmute_account'
  | 'block_account'
  | 'unblock_account'
  | 'not_interested';

type XActionResult = {
  action: XNativeAction;
  targetAccountId?: string;
  targetHandle: string;
  status: 'success' | 'failed' | 'needs_user' | 'cancelled';
  reason?: string;
  startedAt: number;
  finishedAt: number;
};
```

失败原因示例：

- `target_not_found`
- `menu_not_found`
- `action_not_found`
- `confirm_dialog_not_found`
- `timeout`
- `x_ui_changed`
- `user_intervention_required`

不要悄悄失败。

---

## 8. Native Action Queue

单个账号的 Block/Mute 很简单，但社区名单可能有几十、几百甚至更多账号。

因此批量同步不能写成：

```text
for every account -> click immediately
```

应该建立一个可暂停、可恢复、可观察的 Native Action Queue。

### Queue State

```ts
type QueueItem = {
  id: string;
  action: XNativeAction;
  handle: string;
  accountId?: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  attempts: number;
  error?: string;
};
```

队列默认单任务串行执行：

```text
pending
   ↓
running
   ↓
等待 X 页面反馈
   ↓
success / failed
   ↓
next
```

不是为了模拟“真人节奏”，而是因为 X UI 是有状态的：Dropdown、Dialog、路由和 DOM 更新不能安全地并行操作。

---

## 9. 批量同步的产品体验

Community Pack 例如包含 387 个 Strong Spam Accounts。

用户点击：

> **同步到 X 黑名单**

必须先展示：

```text
将帮助你在 X 上 Block 387 个账号。

FeedSieve 会通过当前浏览器中的 X 页面依次完成操作。
你可以随时暂停或取消。

[取消] [开始大扫除]
```

执行界面：

```text
福滤娃正在大扫除

37 / 387

@spam001     已抬走
@spam002     已抬走
@spam003     失败，可重试
@spam004     正在处理

[暂停] [停止]
```

用户需要始终知道插件正在修改其 X 原生 Block/Mute 状态。

---

## 10. Community List 与 X Native Block 的关系

社区 Filter List 默认不应该等于 X 原生 Block List。

推荐默认行为：

```text
Community YAML/JSON
       ↓
Extension Local Cache
       ↓
FeedSieve Local Hide
```

这个动作可以瞬间完成。

X 原生 Block/Mute 只有用户明确选择时才运行：

```text
Community List
       ↓
User clicks "Sync to X"
       ↓
Native Action Queue
       ↓
X Browser UI
```

因此 FeedSieve 有两层：

### 一键启用社区清单

- 快
- 本地
- 默认推荐
- 可瞬间撤销

### 同步到 X

- 可选
- 修改 X 账号自身状态
- 使用 Action Queue
- 必须有明确进度和用户控制

---

## 11. 页面上下文与执行窗口

Action Adapter 依赖 X 页面，因此需要明确执行上下文。

推荐：

- 插件检测当前是否存在可用 `x.com` Tab
- 如没有，可提示用户打开一个 X Tab
- 批量队列在指定工作 Tab 中执行
- Action Queue 与普通用户浏览行为隔离，避免用户滚动页面导致菜单上下文丢失

后续可以设计专门的“清扫工作页”：

```text
x.com 页面
+
FeedSieve Queue Panel
```

但不要创建隐藏的远程浏览器或要求用户额外登录。

---

## 12. 幂等与状态检查

Action Adapter 在执行 Block/Mute 前，最好尽可能确认当前状态。

例如：

- 已 Block → `block_account` 可以直接返回 success/already_done
- 已 Mute → 不重复执行
- 账号不存在 / Suspended → 标记 skipped / unavailable

避免不必要的 UI 操作。

统一结果可扩展：

```ts
status: 'success' | 'already_done' | 'failed' | 'needs_user' | 'cancelled'
```

---

## 13. 重试原则

只重试“可能因为页面加载失败而产生”的错误，例如：

- Dropdown 加载超时
- Dialog 尚未出现
- SPA Navigation 正在进行

不要无限重试。

建议默认最大尝试次数很低，并在连续失败后暂停整个 Queue：

```text
连续多个 x_ui_changed
      ↓
暂停任务
      ↓
提示：X 页面可能已经改版，福滤娃先不乱点。
```

这比继续盲目点击安全得多。

---

## 14. 国际化问题

FeedSieve 不应该主要靠英文 `Block @xxx` 文本定位菜单。

因为 X 页面可能是中文、英文、日文等不同语言。

Locator 优先使用：

- data-testid
- role
- aria metadata
- 结构关系

文本只作为 fallback，并集中维护 i18n action dictionary。

---

## 15. 安全与隐私边界

Action Adapter 明确禁止：

- 上传 X Cookie
- 保存 X Password
- 导出 Access Token
- 向 FeedSieve 后端传递登录凭证
- 注入凭证窃取逻辑

Community API 只接收 FeedSieve 自己的数据：

```text
account / reason / evidence / anonymous reporter identity / timestamp
```

X Native Action 在用户浏览器本地执行。

因此架构边界非常清楚：

```text
X Session
   ↓
Only browser-local Action Adapter

FeedSieve Community Server
   ↓
Never needs X session credentials
```

---

## 16. 测试策略

X Action Adapter 是最容易因为 X 改版失效的模块，必须单独测试。

推荐：

```text
fixtures/x/
├── timeline/
├── post-menu/
├── block-dialog/
├── mute-state/
└── account-page/
```

测试分三层：

### Unit

- Locator 对 fixture 能否找到目标
- 状态机转换
- Queue retry / pause / cancel

### Integration

- Extension + mock X DOM
- 点击流程
- Dialog 确认

### Manual Smoke Test

每个 Release 至少检查：

- 单账号 Mute
- 单账号 Block
- Unmute / Unblock
- Queue 5-item run
- 中文 / 英文 X UI

---

## 17. 与 Filter Engine 的接口

Filter Engine 只能产生过滤决定，不直接点 X：

```ts
const decision = filterEngine.evaluate(item);
```

例如：

```ts
{
  action: 'hide',
  source: 'community',
  category: 'bot_spam',
  confidence: 0.94
}
```

用户随后可以额外触发：

```ts
xActions.enqueue({
  action: 'block_account',
  handle: item.author.handle,
});
```

这样 Filter Engine 与 X Native Action 永远解耦。

---

## 18. 最终架构定位

```text
                    FeedSieve
                        │
        ┌───────────────┴────────────────┐
        │                                │
   Filter Engine                  X Browser Adapter
        │                                │
        │                      ┌─────────┴─────────┐
        │                      │                   │
        │                   Reader              Actions
        │                      │                   │
        │                 Timeline             Block
        │                 Replies              Mute
        │                 Account              Unblock
        │                 Search               Unmute
        │                                      Not interested
        │                                          │
        │                                   Native Action Queue
        │
        ├── Personal Rules
        ├── Community Reputation
        ├── Content Fingerprints
        ├── Domain Reputation
        └── Optional AI
```

一句话：

> **Hide 是 FeedSieve 自己的能力；Block / Mute 是 FeedSieve 帮用户操作 X 的能力。两者都不要求把 FeedSieve 变成 X API 客户端。**
