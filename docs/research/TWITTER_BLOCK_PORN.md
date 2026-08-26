# Twitter-Block-Porn Competitor Research

> Research target: `daymade/Twitter-Block-Porn`

## 1. 为什么值得研究

Twitter-Block-Porn 是一个非常接近 FeedSieve 早期需求的开源项目：

- 共享黑名单
- 批量拉黑
- 关键词识别垃圾回复
- GitHub 公开名单
- 用户脚本 / 浏览器页面内执行

截至 2026-08，GitHub 约 2k stars，Greasy Fork 总安装量约 2 万以上。

它验证了两件事：

1. X 垃圾回复 / 色情诈骗账号确实存在强需求。
2. “共享名单 + 浏览器端批量操作”是一条真实可行的产品路径。

## 2. 当前实现思路

公开源码和文档显示，其实现包含：

- 从 GitHub raw 下载共享 JSON 名单
- 打开 X / Twitter List 成员页
- 提供“一键全部屏蔽”能力
- 读取当前浏览器登录态相关信息
- 调用页面环境 / Twitter 接口完成批量 Block
- 使用独立关键字项目识别黄推

它的公开名单 `lists/all.json` 是很直接的账号数组：

```json
[
  {
    "id_str": "...",
    "screen_name": "...",
    "name": "..."
  }
]
```

这是 FeedSieve 的重要前置案例。

## 3. 最值得学习的三个点

### 3.1 GitHub 本身就是名单分发系统

项目直接把列表放在仓库里，再由客户端读取。

FeedSieve 应继续这个方向，但进一步做成：

```text
YAML 可读源
-> CI validate
-> JSON 构建产物
-> checksum / version
-> extension local cache
```

### 3.2 批量动作必须做 Queue

Twitter-Block-Porn 文档明确提醒批量 Block 存在平台风控风险，它自己的 Roadmap 也计划：

- 记录上一次批量操作时间
- 短时间大量操作时提示
- 前端任务进入 queue
- 后台缓慢执行
- 显示进度
- 持续追踪名单增量

FeedSieve 应直接吸收这个经验。

因此：

> **Native Action Queue 是产品模块，不是一个 for-loop。**

### 3.3 Snapshot 增量比反复全量 Block 更合理

该项目计划追踪列表更新，只处理 offset 之后的新账号。

FeedSieve 应从协议层实现版本化 Snapshot：

```text
snapshot v41
-> snapshot v42
-> diff / new entries
```

Detector 直接切新索引做黄框标注；Block Queue 只生成尚未处理的增量任务。

## 4. 不建议照抄的地方

### 4.1 不要把内部 Twitter 请求当核心接口

Twitter-Block-Porn 历史实现中直接使用 Twitter 1.1 endpoint / cookie 相关请求。

这类内部路径可能随平台变化，也让权限、登录态和安全边界变复杂。

FeedSieve 默认路线：

> **浏览器页面 Action Adapter 优先。**

也就是利用用户当前打开且已登录的 X 页面，通过原生菜单完成 Block / Mute。

内部请求最多只能作为未来独立实验，不进入核心技术基线。

### 4.2 不要只有静态“是/否”黑名单

FeedSieve 应公开：

- category
- status
- community score
- reports
- rescues
- timestamps
- evidence（可选）

并支持 Candidate / Recommended / Strong。

### 4.3 批量 Block 必须队列化

Native Block 慢，并且平台行为可能变化。

FeedSieve 的批量拉黑应该是：

```text
Detector 黄框标注（瞬时、零风险、不修改 Block List）
-> 待拉黑列表（用户确认）
-> Block Queue 逐个执行原生 Block
```

Block 永远是用户显式触发的下一步动作，不是自动发生的“过滤”。

## 5. 对 FeedSieve 的直接技术影响

本轮研究后确认以下架构：

```text
Community Snapshot
       │
       ├── Detector 本地索引  <-- 核心：黄框标注，零风险
       │
       └── Block Queue Diff   <-- 用户显式触发
                  │
                  v
            Block Queue
                  │
              X Adapter
                  │
           Browser-native UI
```

Block Queue 必须：

- 用户显式启动
- 持久化
- 有进度
- 可暂停
- 可恢复
- 可取消
- 异常停止
- 不做风控绕过

## 6. FeedSieve 应该超越它的地方

Twitter-Block-Porn 证明了“共享名单有用”。

FeedSieve 要把这件事进一步标准化：

> **共享名单 → 开放信誉协议。**

最终实体不仅包括 Account，还包括：

```text
Account
Content Fingerprint
Domain
Campaign
```

最终生态不仅有一个全局名单，而是：

```text
Official Packs
Community Packs
Third-party Packs
用户本地待拉黑列表
```

这就是 FeedSieve 和传统 X 黑名单脚本真正拉开差距的地方。
