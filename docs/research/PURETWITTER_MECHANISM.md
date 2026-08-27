# PureTwitter 机制拆解（逆向笔记）

> 来源：Chrome 商店分发的编译产物 `nflidllhiamnebgbgoemadhhfdpbbpbi/2.1.0_0`（本机可解包）。
> 2026-08-27 用 js-beautify 反解后逐函数分析。仅记录机制供借鉴；不复制其代码（无开源许可）。

## 架构总览

三层结构，比我们原设想的「纯 DOM 方案」多了一个关键层：

```text
injected.js  (MAIN world)    XHR 钩子：拦截 X 自己的 GraphQL JSON 响应
     │  CustomEvent
     v
content.js   (ISOLATED)      消费结构化数据 + DOM 标注 + 调拉黑 API
     │  chrome.runtime.sendMessage
     v
background.js                远程名单同步 + storage 管理 + 消息路由
```

## 核心发现（按价值排序）

### 1. 数据源不是 DOM，是网络响应（最重要的启发）

`injected.js` 劫持 `XMLHttpRequest.prototype.open/send/setRequestHeader`，对响应按 URL 特征分发解析：

| URL 包含 | 解析函数 | 拿到什么 |
| --- | --- | --- |
| `TweetDetail` | parseTwitterResponserInfo(x, "detail") | 推文详情/回复串 |
| `HomeTimeline` / `HomeLatestTimeline` | 同上 "homeLine" | 主时间线 |
| `ListLatestTweetsTimeline` | 同上 "tweetstimeline" | 列表时间线 |
| `/ListMembers` | parseModalDetailFun | 成员 rest_id + screen_name + blocking |
| `settings.json` | 直取 screen_name | 当前登录账号 |
| `/Following` | parseFollowingListFun | 关注列表 |

每条推文可稳定拿到：`rest_id`（用户数字 ID！）、`screen_name`、`name`、`description`（简介）、`full_text`、`lang`、`following`、头像。**比 DOM 刮取稳一个数量级，且拿到了 DOM 拿不到的 rest_id 和简介。**

解析细节：
- `TweetWithVisibilityResults.__typename` 包一层 → 取 `.tweet`
- 转推取 `legacy.retweeted_status_result.result` 内层
- `conversationthread-` entry 的回复在 `content.items[].item.itemContent`
- `promoted-tweet` entryId 单独归为广告类

### 2. 拉黑不点菜单，直接调 Web API

```js
fetch("https://x.com/i/api/1.1/blocks/create.json", {
  headers: {
    Authorization: "Bearer AAAAAA%3D1Zv7...",  // X 网页端公开 client token
    "X-Twitter-Auth-Type": "OAuth2Session",
    "X-Twitter-Active-User": "yes",
    "X-Csrf-Token": getCookie("ct0"),
  },
  body: `user_id=${restId}`,
  method: "POST",
})
```

`ct0` 从 `document.cookie` 读（非 httpOnly，ISOLATED world 可读）。**TBWL（MIT）用完全相同的端点**——两个成熟项目独立收敛到同一方案，即生产验证的标准答案。我们的「打开菜单→找 Block→点确认」DOM 流程是脆弱的下位替代，只配做 fallback。

### 3. 关键词匹配字段覆盖四位

`full_text` → `description` → `name` → `screen_name` 依次匹配。**我们只查正文；简介/昵称垃圾（最常见于黄推号）会漏。**

### 4. 白名单最高优先级

黑名单命中后仍查白名单，命中即洗白（`isPorn = false`）。对应我们的 Personal Allowlist 必须做在 Detector 管线最末端一票否决。

### 5. UI 借鉴点

- 高亮：`data-user-tag` 属性 + CSS 属性选择器，`border: 5px solid #fbbc05` 打在 `cellInnerDiv`（无底色——background 被它自己注释掉了，踩过坑）
- 批量进度：`position:fixed` 底部通知挂 `#layers` 门户；全屏 loader 遮罩显示状态
- 按钮样式模仿 X 自己的按钮类（取 parent.classList[0] 借字体）

### 6. 远端配置与名单

`puretwitter.ikeyly.cn:5006` 提供 `/blacklist`、`/keyword`、`/todoblacklist`（上报）。本地 chrome.storage 缓存 + 按天刷新。用户数据（屏蔽列表）回传其服务器——**这是我们不学它的部分**（隐私红线：FeedSieve 上报仅显式触发）。

### 7. 已知缺陷（我们引以为戒）

- 批量 Block 是 `for` 循环 fire-and-forget（`H.forEach(j)`），无队列、无进度持久化、无暂停恢复——正是我们 Block Queue 设计要超越的
- 屏蔽数据明文回传第三方服务器
- 无测试、无类型（编译产物混淆）

## 对 FeedSieve 的落地映射

| PureTwitter 机制 | FeedSieve 落点 | 状态 |
| --- | --- | --- |
| XHR 钩子 + GraphQL 解析 | `x-adapter/src/api/parse.ts` + `xhr-bridge.content.ts`（MAIN world 最小桥，规格 §3.1 允许） | 本轮落地 |
| blocks/create.json | `x-adapter/src/actions/block.ts` | 本轮落地（Phase 2 接线） |
| 四字段匹配（含 bio） | detector DetectInput 增加 bio 来源 | 本轮接线 |
| 白名单一票否决 | detector 管线（Phase 1.x） | 待做 |
| data-tag + 纯边框标注 | content.ts（已采用） | 已落地 |
| Queue 批量 | block-queue 包（我们更强） | Phase 3 |
