# FeedSieve X Action Adapter

> Implementation baseline for browser-native X actions.

## 1. 核心结论

FeedSieve 运行在 `x.com` 页面里，因此对 X 已经暴露给登录用户的原生操作，默认不需要把产品设计成 X API / OAuth 客户端。

核心原则：

> **Read the page. Filter locally. Act through the page.**

- 读取 X 页面：Content Script / Reader Adapter
- FeedSieve 标注：完全本地，永不隐藏内容
- X 原生 Block / Mute / Unblock / Unmute：通过当前已登录的 X 页面完成
- Community API：只处理 FeedSieve 的 Report / Rescue / Score / Snapshot
- 不要求 X Access Token
- 不读取用户 X Cookie

## 2. 为什么 Action Adapter 必须独立

X 页面会不断变化。

如果 Detector 直接写：

```ts
document.querySelector(...).click()
```

很快会变成不可维护代码。

正确边界：

```text
packages/x-adapter/
├── reader/
├── actions/
│   ├── block.ts
│   ├── mute.ts
│   ├── unblock.ts
│   ├── unmute.ts
│   ├── menu.ts
│   └── result.ts
├── selectors/
└── observer/
```

Detector 永远不知道 X 菜单长什么样。

## 3. v0.1 只做单账号 Action

第一版最重要的是稳定，而不是批量数量。

用户流程：

```text
黄框标注账号
     ↓
点击「顺手拉黑」
     ↓
Action Adapter
     ↓
打开 X 原生菜单
     ↓
找到 Block action
     ↓
点击
     ↓
处理 confirmation
     ↓
等待成功 UI / state
```

Block 失败时必须如实反馈失败原因，不假装成功。

v0.1 同时实现反向动作「放回来」（Unblock），Block / Unblock 是同等一等公民。

## 4. Action API

```ts
export type NativeActionType =
  | 'block'
  | 'mute'
  | 'unblock'
  | 'unmute';

export type NativeActionRequest = {
  type: NativeActionType;
  handle: string;
  source: 'tweet' | 'profile' | 'queue';
};

export type NativeActionResult =
  | {
      ok: true;
      handle: string;
      type: NativeActionType;
    }
  | {
      ok: false;
      handle: string;
      type: NativeActionType;
      code:
        | 'target_not_found'
        | 'menu_not_found'
        | 'action_not_found'
        | 'confirmation_not_found'
        | 'timeout'
        | 'auth_required'
        | 'unexpected_ui';
      message?: string;
    };
```

Action Adapter 必须返回真实结果，不允许“点了就算成功”。

## 5. Selector 策略

寻找动作的优先级：

1. stable `data-testid`
2. semantic `role=menuitem`
3. aria label
4. locale text fallback

文本 fallback 至少维护：

```text
zh-CN
zh-TW
en
```

不要仅使用 `innerText.includes('Block')` 作为唯一逻辑。

菜单通常是 portal 动态插入 DOM，因此 Action Adapter 需要：

```text
click trigger
-> waitFor(menu)
-> find action
-> click
-> waitFor(confirm or result)
```

## 6. 等待机制

禁止大量固定 `sleep(1000)` 拼接。

建议封装：

```ts
waitForElement(...)
waitForGone(...)
waitForTextOrTestId(...)
```

每一步有独立 timeout。

例如：

```text
open menu       2s
find action     2s
confirmation    2s
success state   4s
```

具体值以后通过真实测试调整。

## 7. 不优先使用 MAIN world

Content Script 默认 isolated world 已经可以读取和点击 DOM。

只有未来证明某个动作必须调用页面 JavaScript runtime 时，才单独建立最小化 MAIN-world bridge。

不要为了方便直接把整个扩展逻辑暴露在 host page world。

## 8. Block Queue

批量拉黑队列是 v0.1 的核心交付（见 [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) Phase 3），放在独立 package `block-queue`。

研究现有共享黑名单脚本后可以确认：

> **批量操作必须是可恢复的 Queue，不是 for-loop。**

结构：

```ts
export type NativeActionTask = {
  id: string;
  type: NativeActionType;
  handle: string;
  status:
    | 'pending'
    | 'running'
    | 'success'
    | 'failed'
    | 'cancelled';
  attempts: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
};
```

## 9. Manifest V3 Queue 设计

Service Worker 随时可能休眠，因此：

- 队列不能只在全局变量
- 每个 task 状态变化要持久化
- browser / extension 重启后能恢复 pending 状态

建议：

```text
chrome.storage.local
  - queue metadata
  - current run settings

chrome.storage.session
  - 当前短生命周期 running context

IndexedDB
  - 大型 queue history（需要时）
```

Content Script 负责真实 DOM Action，Service Worker 负责协调和持久化。

## 10. Queue Runner

批量 Native Sync 建议使用明确的 Runner 模式。

```text
User starts Native Sync
       ↓
Build diff tasks
       ↓
Queue persisted
       ↓
Runner has usable x.com tab
       ↓
Service Worker dispatches one task
       ↓
Content Script executes
       ↓
Result persisted
       ↓
Next task
```

如果没有可用 X 页面：

- 暂停
- 提示用户打开 X

不要偷偷在不可见上下文执行大量动作。

## 11. Batch 规则

必须：

- 用户显式启动
- 显示总数 / 已完成 / 失败
- Pause
- Resume
- Cancel
- 每一步确认页面状态
- 异常登录 / Challenge 立即暂停
- 失败 task 有明确原因

不要：

- 承诺某个固定批量数量一定安全
- 为绕过平台检测设计隐蔽行为
- 无提示持续后台操作

## 12. 标注与拉黑分离

名单命中与拉黑是两个独立步骤：

```text
Community Snapshot
-> local index
-> Detector 黄框标注（瞬时、可撤销、不隐藏内容）
```

用户另外选择：

> **一键批量拉黑**

才生成 Block Queue 任务。

标注与拉黑必须在 UI 和数据结构上分开。

## 13. 增量同步

Snapshot 有版本：

```text
v41 -> v42
```

Native Sync 不应该每次重新处理全名单。

本地保存：

```text
nativeSyncedHandles
lastSyncedSnapshotVersion
```

新版本只计算：

```text
new strong/recommended entries
- already synced
- 用户手动移除
= queue candidates
```

用户确认后再执行。

## 14. Unblock / Rollback

不能只支持“加进去”。Unblock 是 v0.1 的一等公民：

- 用户误操作 -> 「放回来」一键 Native Unblock
- 社区移除账号 / 用户 Rescue -> 提示用户，但不自动 Unblock（用户可能在 FeedSieve 之外也有自己的 Block 原因）

因此默认：

```text
Community removal
-> Detector 不再标注
-> Native Block remains until user explicitly chooses to undo
```

这是用户控制原则。

## 15. Action Fixture Tests

必须维护：

```text
fixtures/x/menus/block-en.html
fixtures/x/menus/block-zh-cn.html
fixtures/x/menus/block-zh-tw.html
fixtures/x/menus/confirm-block.html
```

测试：

- menu trigger
- action lookup
- confirmation
- result
- timeout
- locale fallback

CI 不允许对真实 X 账号执行 Block。

## 16. 实施顺序

### v0.1

- block current account
- unblock（一键放回）
- clear error result
- zh-CN + en fixture
- persistent block queue + progress UI

### v0.2+

- mute / unmute
- incremental community sync

### Future

- not interested
- follow / unfollow（只有明确产品需求再做）
- report（谨慎，避免自动化滥用）

## 17. 最终原则

X Action Adapter 的定位不是“模拟一个 API 客户端”。

它的定位是：

> **把用户本来需要在 X 页面上点很多次才能完成的操作，变成可理解、可暂停、可恢复的辅助动作。**

FeedSieve 的标注永远不依赖这些原生动作成功；拉黑结果必须如实反馈。
