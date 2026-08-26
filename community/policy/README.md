# FeedSieve Community Scoring Policy

`v1.yaml` 是社区信誉的公开可执行配置。

## 1. 基础变量

对一个目标账号：

```text
weighted_reports = Σ(report reporter_trust × report_weight)
weighted_rescues = Σ(rescue reporter_trust × rescue_weight)
```

当前 v1：

```text
report_weight = 1.0
rescue_weight = 1.25
```

Rescue 稍微更重，目的是让明显误判更容易退出高等级名单。

## 2. Temporal Spread Bonus

只有在不同自然日持续收到 Report 才增加 spread bonus。

```text
extra_days = max(distinct_report_days - 1, 0)
spread_bonus = min(
  extra_days × temporal_spread_bonus_per_extra_day,
  temporal_spread_bonus_max
)
```

v1：

```text
0.5 per extra day
max 1.5
```

这样可以降低“短时间群体围攻”直接获得高分的概率。

## 3. Burst Penalty

当一个账号已经至少出现 Candidate 级别 Report，并且超过配置比例的 Report 集中在 `burst_window_minutes` 内：

```text
burst_penalty = configured burst_penalty
```

否则：

```text
burst_penalty = 0
```

v1：

```text
window = 30 minutes
ratio threshold = 0.70
penalty = 2.0
```

这是一个冷启动反滥用规则，以后可以继续改进。

## 4. Effective Score

```text
effective_score
= weighted_reports
- weighted_rescues
+ spread_bonus
- burst_penalty
```

第一版不要引入黑盒 ML。

## 5. Public Community Score

公开名单里的 `community_score` 必须是 `0..1`。

v1 使用：

```text
community_score
= 1 - exp(-max(effective_score, 0) / normalization_scale)
```

当前：

```text
normalization_scale = 8.0
```

最终输出四舍五入到 4 位小数。

`community_score` 用于：

- UI 展示
- 排序
- 社区解释

**账号状态仍以 `effective_score + distinct days + rescue ratio` 的 Policy 条件决定。**

不要只看 `community_score` 一个数字升级状态。

## 6. Rescue Ratio

```text
rescue_ratio
= independent_rescue_voters
/ max(independent_reporters + independent_rescue_voters, 1)
```

## 7. Status v1

### Candidate

```text
independent_reports >= 5
```

### Recommended

同时满足：

```text
effective_score >= 8

distinct_report_days >= 2

rescue_ratio <= 0.25
```

### Strong

同时满足：

```text
effective_score >= 20

distinct_report_days >= 3

rescue_ratio <= 0.15
```

若不再满足当前状态条件，重新计算后允许降级。

## 8. Reporter Trust

v1：

```text
default = 1.0
min = 0.25
max = 1.5
```

第一版 Trust 不需要复杂：

- 新 installation：1.0
- 异常 burst / 大量机械举报：逐步下降
- 长期高质量贡献：逐步上升
- 经常被 Rescue 推翻：逐步下降

具体 Trust 更新算法可以独立版本化，但必须保持公开。

## 9. 实现要求

后端必须提供一个纯函数形式的 scorer：

```ts
scoreAccount(input, policy) -> {
  effectiveScore,
  communityScore,
  rescueRatio,
  status,
  reasons
}
```

并提供固定 fixture 测试。

Policy 更新不能只改后端常量，必须先更新公开 YAML。

## 10. 未来调整

v1 只是冷启动协议。

以后可以加入：

- time decay
- evidence quality
- entity relationship
- campaign confidence
- trusted reviewer

但任何新信号都应该满足：

- 可解释
- 可公开
- 可测试
- 可重算
