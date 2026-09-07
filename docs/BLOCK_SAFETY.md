# 批量拉黑安全策略（Block Safety）

> 一句话原则：**扩展负责替用户守住「速度 + 日量 + 异常即停」，默认不增加操作步骤；大名单只进队列，不在一个晚上跑完。**

## 背景事实（调查结论）

- X **不公布 block 限额**。官方限额页只写关注 400/天；开发者论坛口径是 block 按账号级限制、可预期接近 follow。
- **风控是账号级、自适应的**：同一数字对不同账号含义不同——新号/刚锁定过的号远低于 400，信誉好的老号远高于 400；2026-05 后 X 按 rate-limit header 响应，个别账号能到 6000+/天。固定一个「安全数字」对所有人逐字适用是伪命题。
- 工具社区实测（Twitter-Block-Porn、Mass Blocker、mass-block-twitter、twikit 等交叉印证）：**约 400–500/24h 是常见安全线**；单 session 冲到 ~1000 必出 Arkose 人机验证；超 ~500 历史上会被强制登出要求重登。
- 网页端短窗 `blocks/create` 约 187 次/15min（twikit），再快就是 HTTP 429。
- 走网页原生端点（与手动点击同签名）只少一层「第三方 App」信号，**日量和爆发速度照样触发**强制登出 / 验证。
- 后果梯度：429 → 强制登出 → 人机验证 → 临时锁定（「检测到可疑行为」）；**单纯拉黑几乎不导致永久封号**。

## 设计原则

1. **签名安全 ≠ 速率安全**：页面同源接口也要守速率与日量。
2. **限的是账号，不是扩展**：按当前登录 X 账号计数；顺手拉黑 + 批量 + 撤销共用预算。
3. **429 是短窗，强制登出是日级**：Retry-After/退避挡不住日量。
4. **到量就停，队列保留，次日用户点继续**：自动停、手动续，不增加日常单次拉黑的确认框。
5. **默认保守，高级可调，永远不准「无限制」**。
6. **入队 ≠ 执行**：社区大名单同步只进待拉黑队列。

## 默认档位（预算起点，不是天花板）

| 档位 | 预算起点（24h 成功） | 成功间隔 | 适用 |
|---|---|---|---|
| Conservative | 200 | 1.2–2.5s 抖动 | 新号、刚锁定过、用户自选 |
| **Balanced（默认）** | **400** | **0.8–1.8s 抖动** | 绝大多数安装 |
| Aggressive | 500 | 0.6–1.4s 抖动 | 设置里显式选择 |
| 硬顶 | 800 | — | 输入框不允许超过 |

默认 400 而不是社区传说的 500/6000：400 对齐官方唯一可引用的「进攻性写操作」量级，商店页/README 更好写；顺手拉黑也占额度。**但 400 只是开箱起点**——响应式预算随账号实际反馈收缩与回补（见 Layer B），弱号不会硬冲到 500 才被锁，强号能吃到更宽松的响应。

窗口用**滚动 24 小时**，不用本地日历日（否则 23:50 打满、00:10 再打一轮仍是连续爆发）。`daily-stats` 继续做战报；安全账本单独一本。

## 三层安全阀

```text
Layer A  节奏阀     每次成功后的间隔 + 抖动；禁止并行
Layer B  额度阀     响应式预算：起点固定，信号收缩、稳定回补；到量 pause，队列保留
Layer C  异常阀     429 风暴 / 认证失败 / 挑战码 / kill switch → 立刻整队停 + 收缩预算
```

### Layer A：节奏（已落地）

- 成功间隔 = `base + random(0, jitter)`，默认 base 800ms、jitter 1000ms（见 `SAFETY_PRESETS.balanced`）。
- 禁止并行，保持现有单任务 runner。
- 每成功 80 次插入 45–75s 强制冷却（PR3，`cooldownEvery` 已落表）。
- 429：当前任务按 Retry-After 退避；连续 3 次 429 升级为 `rate_limit_storm`（见 Layer B/C）。

固定 400ms 的问题不只是快，还是**节拍器**——X 对规律自动化更敏感。

### Layer B：响应式预算（已落地）

本地账本（storage key `blockSafetyLedgerV1`）：

```ts
{
  accountKey: string;        // 当前 X user id（cookie auth_user_id/twid）；拿不到时匿名账本
  preset: 'balanced';        // 档位（PR3 设置页可改）
  dailyLimit: number;        // 预算起点（默认 400，硬顶 800）
  budget: number;            // 当前生效预算：信号收缩、无信号逐日回补，≤ 800
  cleanStreak: number;       // 连续无风控信号的自然日（信号日清零）
  lastSignalDay?: string;    // 最近风控信号日；lastCleanDay 做跨日回补幂等闸
  events: number[];          // 成功 block/unblock 的 Unix ms，只留滚动 24h
  lastPausedReason?: string;
  updatedAt: number;
}
```

**预算不是固定闸门**，机制是「400 只是起点 + 账号自己探红线」：

| 信号 | 预算动作 |
|---|---|
| 连续 3 次 429（`rate_limit_storm`） | **当日预算砍半**（400 → 200），整队 pause |
| 认证失效（401/403，登出/风控锁定） | **当日预算清零**，整队 pause |
| 人机挑战（Arkose / 登录墙，PR2 检测） | 当日预算清零（预留分支） |
| 连续 3 个无信号自然日 | 之后每天 **+50 回补**，封顶 800 |

规则：

- **只计成功的破坏性写操作**：失败 / no-id / 已拉黑跳过不计。
- 顺手拉黑与队列拉黑共用同一 `recordSafetyEvent()`（撤销在 PR2 并入）。
- 队列 perform 前查 `remainingQuota = budget − 滚动24h已用`，到量不发请求，返回 `{ ok: false, code: 'quota_exhausted' }` → runner 整队 pause。
- 单次顺手拉黑不做额度门禁（骚扰急用出口），但照样记账占用预算。
- 换账号：`accountKey` 变化换一本新账（按账号分槽存储），**旧账保留不混算**。
- 换浏览器：账本在 `browser.storage.local`，不跨设备；不值得为此做账号系统。
- 回补按自然日惰性执行（读账本时幂等迁移），存量账本无 `budget` 字段时无缝以 `dailyLimit` 起步。

### Layer C：异常即停

| 信号 | 动作 | pauseReason |
|---|---|---|
| 401/403、缺 ct0 | 整队 pause + 预算清零 | `auth_required` / `missing_csrf` |
| 连续 3 次 429 | 整队 pause + 预算砍半 | `rate_limit_storm` |
| Arkose / 登录墙 / 「looks automated」 | 整队 pause（PR2 检测） | `challenge` |
| 官方 kill switch | 已有 | `kill_switch` |
| 响应式预算用尽 | 整队 pause，队列保留 | `quota_exhausted` |
| 用户点暂停 | 已有 | `user` |

禁止在 auth / challenge 状态下自动猛重试；额度暂停不自动 resume，等用户次日手动点继续。

## 与现有代码的接法

```text
packages/block-queue/
  failure.ts     classifyFailure 增加 quota_exhausted → pause；新增 jitteredPaceMs(base, jitter)
  runner.ts      QueueSession.pauseReason；options.successPaceMs（成功后按注入节奏休眠，默认 400）

apps/extension/src/lib/
  block-safety.ts        新：账本 + 档位 + 纯函数（额度/节奏）+ storage 适配
  block-queue-store.ts   PersistentBlockQueueState.pauseReason 落盘
  daily-stats.ts         不动（战报继续用自然日）
  run-unblock-batch.ts   PR2 并入同一 pace + 额度

apps/extension/entrypoints/
  content.ts             队列 perform 前查额度；blockOne 成功记一笔；注入 successPaceMs；
                         手动暂停写 pauseReason='user'；resume 清除
  popup/App.tsx          顶部额度条；队列因额度暂停时给专属说明
  i18n.ts                中英文案
```

runner 保持纯逻辑包，不引用 browser.storage／DOM：额度判断由宿主 perform 返回 `quota_exhausted`，随现有 pause 分支走。

## UI / 文案（默认路径零新增步骤）

- 日常顺手拉黑：不弹窗、不打断；popup 顶部一行额度 `今日安全额度 120/400`。
- 队列额度暂停：队列面板给一句说明，不弹第二层确认。
- 不做「开启自动拉黑」；产品永远是用户触发。

## README / 商店页必须补的一段

> **批量拉黑请节制。** FeedSieve 走的是你已登录 X 会话的内部 Block 接口，和手动点屏蔽是同一条请求。X 不公布每日上限，但社区实测大约每天 400–500 个之后容易被强制登出或要求验证。扩展默认按 400/24h 自动停，剩余队列会留到你下次点继续。这不是永久封号，但连续硬打会把临时锁定拖长。大名单先入队，不要指望一个晚上跑完。

## 明确不做

- 间隔压到 400ms 以下「为了更快清完」
- 多 tab 并行队列（content script 已单实例，popup 也拒绝第二路 start）
- 用官方 Developer API 的 50/15min 当网页端配额
- 默认 Aggressive 或提供 Unlimited
- 额度重置后自动 resume（x.com 挂一夜会在用户睡着时开打）
- 安全账本上传社区 API
- 文档里写「和手动同签名所以没有风控风险」

## 验收标准

1. 响应式预算用尽（如 400/24h 用满）后，下一次不发网络请求，队列 `paused` + `pauseReason=quota_exhausted`；队列保留，次日手动继续。
2. 失败 / no-id 不计预算。
3. 顺手拉黑与队列拉黑共享同一账本（含同一预算）。
4. 成功间隔抽样不出现固定节拍（抖动生效）。
5. 401/缺 CSRF → pause（已有）+ 认证失效当天预算清零。
6. 连续 3 次 429 → 整队 `rate_limit_storm` pause + 当日预算砍半。
7. 连续 3 个无信号自然日后预算逐日 +50 回补，封顶 800；同一天重复读取幂等。
8. 换 `accountKey` 后预算从档位起点另计，旧账保留。
9. popup 能区分额度暂停 / 限流暂停 / 用户暂停。
10. 存量账本（无 `budget` 字段）无缝升级，不以 0 起步。
11. README 有风险说明；默认安装无新确认框。

## 落地顺序

- **PR1（已完成）**：`block-safety.ts` 静态额度 + runner 认 `quota_exhausted` + popup 额度条 + README 段；默认 400，间隔 800ms+抖动。
- **PR2（响应式预算已完成）**：预算从固定值升级为起点——`budget/cleanStreak/lastSignalDay` 状态机；连续 3 次 429 → `rate_limit_storm`（整队停 + 预算砍半）；认证失效清零预算；连续 3 个干净自然日起逐日 +50 回补封顶 800。

  **PR2 待做（先发新版，按生产环境数据再优化，代码已留 TODO 标记接线点）**：
  - **撤销批处理并入同一 pace+预算**：`run-unblock-batch.ts` 现仍 400ms 定速、不占安全账本——需改走 `block-safety` 的 `paceForPreset` 节奏 + `remainingQuota` 门禁 / `recordSafetyEvent` 记账（`PACE_MS` 处已留 TODO）。
  - **Arkose / 登录墙识别**：`applySignal` 已支持 `challenge`（当天清零）分支但尚未接线——需用真机验证 X 验证码响应特征（如 429+challenge 响应体、登录墙跳转）后在宿主侧检测并 `persistSignal(accountKey, 'challenge')`（`content.ts` perform 与 `block-safety.ts` 类型注释已留 TODO）。
  - 暂停原因完整文案（`challenge` / 认证失效等专属句）。
- **PR3**：设置三档 + 自定义上限（50–800）+ 超限文案；每 80 次强制冷却；额度用尽后的单条紧急出口提示；personal-config 导出档位。