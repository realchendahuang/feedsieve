# FeedSieve Community Lists

这里存放 FeedSieve 公开社区名单的**仓库镜像**与治理政策文档。

> 名单的权威来源是线上社区 API（`apps/community-api`，Worker + D1）：
> 上报在这里聚合、人工审核闸门在这里生效、快照在这里生成。
> 本目录由 `scripts/mirror-community-lists.sh` 从线上拉取并提交，**不要手改 lists/ 下的文件**。

核心原则不变：

> **连黑名单本身都应该晒在阳光下。**

## 名单从哪来（v0.2 起的真实链路）

```text
用户拉黑（主动动作）
      ↓ POST /v1/reports（匿名安装哈希，去重、限速）
Community API D1 聚合
      ↓ 自动只到 candidate（≥3 独立安装）
人工审核（admin CLI）
      ↓ recommended / strong 必须人工提升；dismissed = 驳回
generateSnapshot：确定性 JSON + manifest + sha256
      ↓ GET /v1/snapshots/latest
官方实例分发（主源）
      ├─→ 扩展运行时同步（manifest 比对 → 校验和 → last-known-good 本地索引）
      └─→ scripts/mirror-community-lists.sh 拉回本目录并提交
                └─→ GitHub diff = 公开审计日志；jsDelivr = 分发兜底源

公开关键词源（`keyword-packs/source.json`）
      ↓ 构建校验 + SHA-256
版本化 JSON + manifest（提交到仓库）
      ├─→ 发布到 Cloudflare R2
      └─→ GET /v1/keyword-packs/latest → 扩展每 15 分钟检查 / 手动同步
```

## 目录

```text
community/
├── README.md
├── lists/
│   ├── manifest.json          # 镜像：版本入口 + 每文件 sha256
│   ├── official.json          # 镜像：快照本体（扩展的 jsDelivr 兜底源）
│   └── recommended.json       # 内置兜底名单（构建期随扩展打包，当前为空）
├── keyword-packs/
│   ├── source.json             # 公开、人工可审阅的词库来源（唯一编辑入口）
│   ├── adult-high-recall.json  # 黄推 / 成人引流分类的高召回补充词
│   ├── official.json           # 由构建脚本生成，随扩展打包作离线兜底
│   └── manifest.json           # 版本 + SHA-256，和 R2 latest 保持同字节
├── policy/
│   └── v1.yaml                # 公开评分政策（阈值当前在 API 的 POLICY 常量，v0.3 迁入）
└── schema/
    └── account-list.schema.json
```

高召回补充词只是行业词包的数据源，不在产品里形成单独品牌或订阅项。更新 `source.json` 或分类数据文件后，提升 `pack_version`，重新构建、审阅并发布到 R2；扩展无需升级即可在下一次 15 分钟检查时取得新规则。

## 审计方式

- **看变更**：`git log -p community/lists/official.json` —— 每次名单变化都有 diff
- **看实时**：`curl https://feedsieve-api.chendahuang.com/v1/snapshots/latest`
- **质疑条目**：开 Issue，附 handle 与理由；维护者核实后 `admin.sh promote <handle> dismissed` 并发布新快照
- **自部署**：`apps/community-api/README.md` 有完整步骤，扩展设置可指向任意实例（协议相同）

## Account Identity v1

- `handle`: required（小写主键）
- `x_user_id`: optional（稳定 ID，handle 改名后仍可命中）
- `aliases`: v0.3

## 快照条目字段（official.json）

每条 entry 都回答「它为什么在名单里」：

| 字段                            | 含义                                                                       |
| ------------------------------- | -------------------------------------------------------------------------- |
| `handle` / `x_user_id`          | 身份                                                                       |
| `category`                      | 垃圾分类（bot_spam / scam_phishing / adult_gray_traffic / copy_paste / …） |
| `status`                        | candidate / recommended / strong（仅人工可授予后两者）                     |
| `report_count` / `rescue_count` | 独立安装上报数 / 误判挽回数                                                |
| `first_seen_at` / `updated_at`  | 进入与更新时间                                                             |
| `evidence_post_ids`             | 可选公开证据（≤5 条）                                                      |

## 不公开举报者侧数据

公开的是**标注与名单决策**，不是举报者隐私。

- 公开：聚合名单、分类、票数、状态、时间、可选证据、全部算法与阈值
- 不公开：原始 installation id（服务端只存加盐哈希）、IP、Cookie、X 凭证、浏览历史

## 治理红线

- 标注自动，拉黑永远用户显式触发
- 名单不是永久刑罚：Rescue / Removal 在 v0.3 落地，此前人工 dismissed 立即生效
- **Block garbage, not opinions.** 政治立场、价值观、兴趣偏好不进官方名单

详细文档见 [`../docs/`](../docs/)（TECHNICAL_SPEC / COMMUNITY_FILTERING / OPEN_SOURCE_GOVERNANCE）。
