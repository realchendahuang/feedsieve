# FeedSieve Community Policy

[`v3.yaml`](v3.yaml) 是当前公开政策，也是 API 常量测试的事实源。

## 决定是否进入最终名单的唯一公式

```text
net_votes = block_votes - false_positive_votes
community source is active when net_votes >= 3
```

每个匿名安装对每个账号只有一个当前标签，因此不能同时贡献正负票；后一次明确选择覆盖前一次。`community_score` 是解释社区证据强弱的辅助数值，不负责入榜，不允许客户端把它变成第二套门槛。

## 维护者来源

维护者条目是独立来源，不是加权社区票：

- 只通过服务端 `ADMIN_TOKEN` 保护的管理接口修改；
- 快照公开显示 `sources: [maintainer]` 和 `maintainer_note`；
- 不改变社区票数；
- 每次变更写审计表；
- 与社区来源取并集生成一张最终名单。

政策更新必须同步修改 YAML、API 的 `POLICY` / `publicPolicy()`、协议测试和面向用户的说明。
