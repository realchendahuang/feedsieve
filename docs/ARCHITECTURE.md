# FeedSieve Architecture

## 推荐实现

MVP 采用浏览器扩展。

推荐技术栈：

- WXT
- TypeScript
- React
- Manifest V3
- WebExtension Storage
- Optional OpenAI-compatible provider

## 模块

```text
X Page
  |
  v
Content Observer
  |
  v
Post Extractor
  |
  v
Feature Normalizer
  |
  +------> Allowlist
  |
  v
Local Rule Engine
  |
  +------> confident spam -> Hide
  |
  v
Optional AI Classifier
  |
  v
Decision
  |
  +------> keep
  +------> collapse
  +------> hide
  |
  v
Local Stats + Feedback
```

## 1. Content Observer

监听 X 的动态页面更新。

要求：

- 支持 SPA 路由
- 避免重复处理同一 DOM 节点
- 尽量在内容进入视野前判断
- X DOM 结构变化后容易维护

## 2. Post Extractor

提取尽量稳定的字段：

- tweet id
- author handle
- display name
- text
- links
- media presence
- reply / repost context
- page context
- visible metadata

不要依赖单个脆弱 CSS class。

## 3. Local Rule Engine

本地规则应支持：

- exact keyword
- regex
- account list
- domain list
- repeated content fingerprints
- user-generated rules
- filter packs

返回：

```ts
type Decision = {
  action: "keep" | "collapse" | "hide";
  reason: string;
  category?: string;
  confidence?: number;
};
```

## 4. AI Adapter

AI Provider 必须可插拔。

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

## 5. Storage

默认 Local-first：

- settings
- allowlist
- blocklist
- custom rules
- stats
- cached decisions

不要在 MVP 阶段强制账号系统或云同步。

## 6. UI

### Popup

- 今日过滤数量
- 开关
- 当前站点状态
- “今日战报”

### Options

- 过滤强度
- 黑白名单
- 规则
- AI Provider
- 隐私设置
- 数据重置

### Inline Placeholder

内容被折叠时只显示极简占位：

> 已滤，别看了 · 为什么？ · 我偏要看

## 7. 后续扩展

架构从一开始就给以下能力留接口：

- Firefox
- Safari
- 社区 Filter Packs
- 自定义 AI Provider
- 本地模型
- 规则导入导出
- 多语言
- Filter SDK
