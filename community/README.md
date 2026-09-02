# FeedSieve 公开黑名单

这里保存线上最终黑名单的仓库镜像、公开政策、机器协议和关键词包。

核心原则：

> 连黑名单本身都应该晒在阳光下；执行拉黑仍然必须由用户明确点击。

## 最终名单怎么产生

最终名单只有两个透明来源：

```text
community
  每个安装对每个账号只有一个当前选择
  净票数 = 拉黑票 - 误标票
  净票数 >= 3 时进入；低于 3 时自动退出

maintainer
  维护者通过服务端 /maintainer 页面明确加入或撤销
  不计入社区票，不伪装成社区共识

final blocklist = community ∪ maintainer
```

同一个账号可能同时显示两个来源。撤销维护者来源后，如果社区净票仍达到 3，账号仍留在名单；社区降到 3 以下时，如果维护者来源仍有效，账号也仍留在名单。

从社区名单执行的一键批量拉黑不会生成新票，避免名单自我放大。关注账号、个人白名单和已经拉黑的账号在本机被排除；扩展只在用户点击后逐个调用 X 原生 Block。

## 给人看与给机器看

- [`lists/blocklist.yaml`](lists/blocklist.yaml)：当前公开名单的人类可读版本，适合 GitHub 阅读、Diff 和审计。
- [`lists/official.json`](lists/official.json)：内容相同的机器版本，供扩展校验后建立本地索引。
- [`lists/manifest.json`](lists/manifest.json)：版本、政策版本、条目数和两个文件的 SHA-256。
- [`policy/v3.yaml`](policy/v3.yaml)：唯一阈值、计票与维护者来源的公开政策。
- [`schema/account-list.schema.json`](schema/account-list.schema.json)：JSON 快照协议。

`lists/` 是线上 Worker 快照的仓库镜像，由 [`../scripts/mirror-community-lists.sh`](../scripts/mirror-community-lists.sh) 下载全部 manifest 文件并逐个验证 SHA-256。镜像变更应作为普通 Git diff 提交。

## 快照条目

每条 entry 都必须回答“为什么它在名单里”：

| 字段                               | 含义                                     |
| ---------------------------------- | ---------------------------------------- |
| `handle` / `x_user_id` / `aliases` | 账号身份与已知改名                       |
| `category`                         | 垃圾类型                                 |
| `sources`                          | `community`、`maintainer` 或两者         |
| `maintainer_note`                  | 维护者来源存在时必须公开的说明           |
| `report_count`                     | 当前独立拉黑票数                         |
| `rescue_count`                     | 当前独立误标票数                         |
| `net_votes`                        | 两者之差；仅作解释，客户端不重算入榜资格 |
| `evidence_post_ids`                | 可选公开证据推文 ID                      |

公开快照不包含安装哈希、IP、Cookie、X 凭证、浏览历史或原始推文文本。

## 维护者怎么快速维护

部署者在 Cloudflare 中设置 `ADMIN_TOKEN`，然后打开：

```text
https://你的 API 域名/maintainer
```

令牌只输入到该标签页并保存在 `sessionStorage`，不会写入仓库、扩展包或页面源码。每次加入、更新、撤销都会写入 `maintainer_blocklist_audit`，并立即发布新快照。管理页面代码本身是公开的，权限边界只在服务端 Bearer 校验。

本地三票流程可用 `apps/community-api/scripts/seed.sh` 调试；脚本拒绝非 localhost 地址，不能用来向线上伪造社区共识。

## 治理红线

- 一人一账号一张当前票；同一安装的新选择覆盖旧选择。
- 维护者没有隐藏加权票，也没有永久否决票。
- 维护者直接来源必须公开标注并给出说明。
- 名单命中和批量拉黑不产生新社区票。
- 观点、政治立场、价值观和兴趣差异不是垃圾证据。
- 最终拉黑权属于用户。
