# 需求文档：社区名单命中的确认拉黑不再重复计票

- **状态**：已实施（commit c93b389）；真机验收 5 项待装有开发包的 Chrome 复核
- **版本**：1.0（2026-09-07）
- **适用范围**：`apps/extension`（扩展端）；**不涉及** `apps/community-api` 后端
- **背景**：社区共建机制中，「采用既有结论」和「独立发现」必须分开；当前实现有一处不一致，导致名单内账号被重复背书。

---

## 1. 背景：社区共建机制（30 秒版）

- 用户对账号「标记并拉黑」时，只要动作是**本地新发现**，就作为 1 票上报服务端（匿名安装哈希，每安装每账号 1 票）。
- 服务端聚合：净票 = 拉黑票 − 抢救票 ≥ 3 → 进入公开名单，全网标注；< 3 → 候选池。
- **防自我放大原则**（现有设计意图，见 `apps/extension/src/lib/contribute.ts:391` 注释）：从社区名单下载后批量拉黑，只是「采用既有结论」，不是独立发现。若再上报，会形成「下发 → 批量拉黑 → 票数更高 → 留在名单里」的自我放大闭环。
- 因此「社区名单批量拉黑」（origin = `community-batch`）当前**不上报**（`communityVote: false`）。

## 2. 问题：两条上报路径没有对齐这条原则

当前所有拉黑路径的上报行为（`apps/extension/entrypoints/content.ts`）：

| 路径 | 触发 | origin | 分类 | 当前是否上报 |
|---|---|---|---|---|
| A | 黄框徽章「拉黑」按钮（检测命中：官方词库 / 指纹 / 域名 / **社区名单**） | `single-detection` | 检测推导分类 | ✅ 上报（含社区名单命中的） |
| B | 黄框徽章「拉黑」（**本地自定义关键词**命中，ruleId 以 `keyword:` 开头） | `single-detection` | 检测推导分类 | ❌ 不上报（个人偏好） |
| C | 无黄框 → 手动标记按钮 | `manual-spam` | `other` | ✅ 上报 |
| D | popup「一键拉黑」（页面全部黄框，即当前页所有检测命中） | `page-batch` | 各检测分类 | ✅ 上报（含社区名单命中的） |
| E | popup「社区名单批量拉黑」 | `community-batch` | 名单分类 | ❌ 不上报 |

**不一致点**：路径 A 和 D 对「社区名单命中」的账号也会上报。这些账号已在公开名单内，投票不改变成员资格，但会：

1. 让名单内账号票数虚高（「采用结论」被计成「新票」）；
2. 稀释候选池语义——候选池的「1 票 / 2 票」本应代表独立发现数量；
3. 与 `contribute.ts:391` 注释声明的防自我放大设计意图直接矛盾。

**注意**：该问题不改变名单成员（账号本来就在名单里），是数据语义 / 数据质量问题，不影响过滤功能正确性。

## 3. 需求：目标行为

### 3.1 判定规则（唯一标准）

**「来源是社区名单」的判定，一律以 `detection.source === 'community-list'` 为准。**

- 不能用「ruleId 不是 `keyword:` 开头」之类的间接推断（社区名单命中的 ruleId 为空，用间接推断会误伤指纹 / 域名 / 官方词库路径）。
- 数据来源：路径 A 的按钮闭包里有 `detection` 对象，直接读 `detection.source`；路径 D 的 pageMarked 条目，其 `evidence.detectionSource` 已在 `markCell` 写入 `detection.source`（见第 4 节），可直接读 `item.evidence.detectionSource`。

### 3.2 逐路径目标行为

| 路径 | 改动后行为 | 判定 |
|---|---|---|
| A 徽章拉黑（社区名单命中） | **不上报** `communityVote: false` | `detection.source === 'community-list'` |
| A 徽章拉黑（官方词库 / 指纹 / 域名） | 保持上报 | 非社区名单且非 `keyword:` 前缀 |
| B 徽章拉黑（本地自定义关键词） | 保持不上报 | `ruleId` 以 `keyword:` 开头 |
| C 手动标记 | 保持上报（`detection_source: 'manual'`，分类 `other`） | 不变 |
| D popup 一键拉黑（page-batch） | 条目来自社区名单命中 → **不上报**；其余条目保持上报 | `item.evidence.detectionSource === 'community-list'` |
| E 社区名单批量拉黑 | 保持不上报（已是正确行为） | 不变 |

**具体改动点**：

1. `apps/extension/entrypoints/content.ts` 徽章「拉黑」按钮（当前约 1038 行）：
   ```ts
   const communityVote = !detection.ruleId?.startsWith('keyword:');
   ```
   改为同时排除社区名单命中：
   ```ts
   const communityVote =
     detection.source !== 'community-list' && !detection.ruleId?.startsWith('keyword:');
   ```

2. `apps/extension/entrypoints/content.ts` popup 一键拉黑（`feedsieve:run-page-block`，当前约 216–227 行）：
   当前对全部 pageMarked 条目硬编码 `communityVote: true`，改为按条目来源计算：
   ```ts
   [...pageMarked.values()].map((item) => ({
     handle: item.handle,
     category: item.category,
     reason: item.reason,
     evidence: item.evidence,
     communityVote: item.evidence.detectionSource !== 'community-list',
   }))
   ```

3. 队列执行层 **不需要改动**：`executePersistentQueue` 已尊重任务自身的 `communityVote` 字段（约 1520 行：`task.communityVote ?? ...`），任务字段为 `false` 时不会上报。

**「不上报」为什么能闭环**（两道保险，均已有机制，无需新增）：

- 即时路径：`blockOne` 在 `communityVote !== false` 时才调用 `contributeBlocks`（约 1171 行）；
- 兜底路径：不上报的账号会以 `communityVote: false` 记入本地黑名单（`markBlocked`），`syncLocalLabels` 的 `collectLocalLabels` 会跳过这些条目（`contribute.ts:393`），因此升级补传 / 后台重试都不会把它们补上去。

### 3.3 服务端：明确不做

- 后端不做任何改动：不发新版本、不改表、不改公式。
- **不做**「服务端按 `detection_source = 'community-list'` 过滤上报」的兜底：当前已上架的旧包（0.7.5）上报里没有检测来源字段，服务端无法区分来源，兜底只能挡住新包、挡不住旧包，徒增复杂度。
- 过渡期说明（见第 6 节）：旧包用户仍会对名单命中账号重复背书，接受，因其不改变名单成员。

## 4. 技术要点索引

| 事项 | 位置 |
|---|---|
| 徽章拉黑按钮 + `communityVote` 计算 | `apps/extension/entrypoints/content.ts:1038` |
| 手动标记路径（不改） | `content.ts:943–946` |
| popup 一键拉黑（page-batch） | `content.ts:216–227` |
| community-batch 入口（不改） | `content.ts:242` |
| `blockOne` 上报条件 | `content.ts:1171` |
| 队列执行尊重任务 `communityVote`（不改） | `content.ts:1520` |
| `markCell` 写入 `evidence.detectionSource`（前置依赖，已存在） | `content.ts:991–997` |
| `BlockEvidence.detectionSource` 字段（已存在） | `content.ts:95–104` |
| 同步器跳过 `communityVote: false`（前置依赖，已存在） | `apps/extension/src/lib/contribute.ts:392–395` |
| 本地黑名单存储 `communityVote`（已存在） | `apps/extension/src/lib/blocked-accounts.ts` |

**前置依赖提醒**：`markCell` 写入 `evidence.detectionSource` 与 `BlockEvidence` 字段是最近一次改动（未发版），当前工作区代码已包含，开发时直接基于最新 main。

## 5. 测试要求

### 5.1 单元测试

- `apps/extension/src/lib/contribute-labels.test.ts`：
  - 新增/补充用例：本地黑名单条目带 `detectionSource: 'community-list'` 且 `communityVote: false` → 同步时**不**产生 `/v1/reports` 请求；条目带 `detectionSource: 'manual'` 且 `communityVote: true` → 上报且请求体含 `detection_source: 'manual'`。
- `apps/extension/src/lib/block-queue-store.test.ts`（如覆盖 page-batch 任务构建）：断言一键拉黑队列中社区名单命中条目的 `communityVote === false`。

### 5.2 真机验收（必须）

准备：装有最新开发包（`pnpm dev` 或本地构建包）的 Chrome，一个已进入公开名单的测试账号，打开 `https://x.com/search?q=*&f=live`。

| # | 步骤 | 预期 |
|---|---|---|
| 1 | 让测试账号出现黄框（社区名单命中），点击徽章「拉黑」 | 拉黑成功；DevTools 网络面板**无**指向该账号的 `POST /v1/reports` 请求 |
| 2 | 造一个指纹 / 官方词库命中账号，点击徽章「拉黑」 | 拉黑成功；**有** `POST /v1/reports` 请求，`reason` 为检测分类 |
| 3 | 对一个无黄框账号点手动标记 | 拉黑成功；有 `POST /v1/reports`，`detection_source: 'manual'` |
| 4 | 页面放多个黄框账号（含名单命中），popup「一键拉黑」 | 拉黑全部成功；/v1/reports 只包含非名单命中账号 |
| 5 | 停用再启用社区功能，触发 `syncLocalLabels` 补传 | 名单命中账号不产生补传请求（同步状态幂等） |

验收清空测试数据：拉黑后手动撤销（popup 撤销入口），或清理本地 blockedAccounts。

## 6. 验收标准

1. 第 3.2 节行为表逐条成立；
2. `pnpm verify` 全绿（含新单测）；
3. 真机验收 1–5 全部通过；
4. 后端（community-api）无任何代码变更；已部署线上不受影响；
5. CHANGELOG.md 的 Unreleased 增加一行变更说明（建议文案：「社区名单已收录账号的确认拉黑不再重复计票，候选票数恢复为真实独立发现数。」）。

## 7. 发版与过渡期

- 随下一个 CWS 版本（v0.7.6+）发布，与「举报携带检测来源」改动同包；**不要求**后端同步部署。
- 过渡期（旧包 0.7.5 在架期间）：旧包用户仍会对名单命中账号重复背书，服务端不做兼容过滤（见 3.3）；上线后进入候选池的票数在该版本普及前会逐步趋于真实。
- 回滚：本改动纯客户端行为，回滚一个包即可；无数据回写。

## 8. 明确不做（范围边界）

- **不加权重**：不引入「手动标记权重更高 / 检测确认权重更高」之类的加权逻辑；服务端公式（净票 ≥3）与 `/v1/policy` 公开承诺保持不变。加权讨论待本次改动上线、`detection_source` 数据累积后再议。
- 不改 `community-batch`（E 路径）现有逻辑。
- 不改手动标记的分类（保持 `other`）——分类语义与来源语义分开，本次只处理来源。
- 不改后端阈值、信任分、额度或快照发布机制。