# FeedSieve Vision

## 核心定位

FeedSieve 的第一产品形态是 **浏览器扩展**，但浏览器扩展只是它最先落地的产品外壳。

真正应该长期维护的核心，是一个独立的 **Filter Engine（过滤引擎）**。

一句话：

> **产品形态：浏览器插件。技术本体：Filter Engine。第一战场：X。长期方向：用户自己的互联网注意力过滤层。**

## 为什么第一阶段是浏览器插件

FeedSieve 解决问题的最佳时机，是垃圾信息准备进入用户视野的那一刻。

用户不需要换掉 X，不需要复制链接到另一个 App，也不需要学习一个新的客户端。照常打开 `x.com`，FeedSieve 在原生页面上完成过滤即可。

这和品牌口号天然闭环：

> **不信你看。看不见就对了。**

浏览器扩展的优势：

- 直接作用于 X Home Timeline / Replies / Search
- 不要求用户迁移到第三方 X 客户端
- 可以在内容进入视野前折叠或隐藏
- 本地规则延迟低、隐私友好
- 安装成本低，适合开源传播
- 可以逐步扩展到 Chrome / Edge / Firefox / Safari

## 真正的技术本体

核心过滤逻辑不应该写死在 X DOM 或 Chrome Extension 中。

建议拆分为：

```text
FeedSieve
│
├── Filter Engine
│   ├── Keyword / Regex Rules
│   ├── Account Rules
│   ├── Community Reputation
│   ├── Spam / Duplicate Detector
│   ├── Optional AI Classifier
│   └── User Preference
│
├── X Adapter
│   ├── Timeline
│   ├── Replies
│   └── Search
│
├── Browser Extension
│   ├── Popup
│   ├── Options
│   └── Inline UI
│
├── Community Filter Network
│   ├── Reports
│   ├── Trust Score
│   ├── Shared Lists
│   └── Filter Packs
│
└── Share
    └── 福滤娃今日战报
```

## 长期方向

今天 FeedSieve 先解决 X 的垃圾信息。

未来同一套 Filter Engine 可以适配更多信息流和评论区，而不需要重做过滤核心。

因此长期定位可以理解为：

> **Personal Attention Filter — 属于用户自己的互联网注意力过滤层。**

但对外传播第一阶段不要讲得太大。

第一枪只讲：

> **福滤娃 FeedSieve：把 X 的垃圾抬走。**

先把一个问题做到非常好，再向外扩展。
