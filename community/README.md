# FeedSieve Community Lists

这里存放 FeedSieve 的公开社区过滤快照。

目标不是维护一个神秘的“封禁名单”，而是让社区能够看到、审计、讨论和 Fork 过滤结果。

## 当前目录

```text
community/
├── README.md
├── lists/
│   └── recommended.json
└── schema/
    └── account-list.schema.json
```

## recommended.json

`recommended.json` 是推荐过滤名单的公开快照。

第一阶段它可以作为浏览器插件下载和本地缓存的数据源。

每个条目应尽量包含：

- 稳定的 X User ID
- 当前 handle
- 分类
- status
- community score
- 有效报告数
- rescue 数
- 首次出现和更新时间
- 可选的公开 evidence post ids

## 原则

- 名单公开
- 算法公开
- 变更可追踪
- 允许 Rescue / Appeal / Removal
- 不公开举报者敏感信息
- 不用政治观点或单纯立场差异作为默认垃圾标签

详细治理规则见 [`../docs/OPEN_SOURCE_GOVERNANCE.md`](../docs/OPEN_SOURCE_GOVERNANCE.md)。
