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
  维护者通过受 Cloudflare Access 保护的管理后台明确加入或撤销
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

`lists/` 是线上 Worker 快照的仓库镜像，由 [`../scripts/mirror-community-lists.sh`](../scripts/mirror-community-lists.sh) 下载全部 manifest 文件并逐个验证 SHA-256。GitHub Actions 每天 01:17 UTC 自动镜像一次（[`../.github/workflows/mirror-community-lists.yml`](../.github/workflows/mirror-community-lists.yml)，无变化不产生提交），发版前或名单大变化后也可手动运行。镜像不承诺实时：线上快照默认按“当日一版”发布（当天首次实质变化后 ≤1 小时公开），维护者后台 / Agent 显式发布产生的新版本跳过当日节流即时公开，因此同一天可能有多版；权威数据始终以 Worker API 为准。

**官方暂停开关（kill switch）的时效**：破坏性操作暂停与否以部署配置实时状态为准，扩展在任何破坏性动作执行前查询 `GET /v1/kill-switch`（no-store，不受快照日更节流）。快照里携带的 `kill_switch` 仅作存档与离线兜底，可能滞后到次日。

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

部署者为独立管理子域配置 Cloudflare Access，再打开：

```text
https://admin.你的 API 域名
```

维护者经邮箱一次性验证码登录。每次草稿保存、发布和回退都会写审计记录；维护者草稿只有显式“发布”才会更新公开名单。Worker 同时校验 Access JWT 的签名、Audience 和允许邮箱，公开 API 域不提供管理接口。

本地三票流程可用 `apps/community-api/scripts/seed.sh` 调试；脚本拒绝非 localhost 地址，不能用来向线上伪造社区共识。

## 词库（关键词包）怎么维护

公开词库 = 8 个行业包 778 条规则（`keyword-packs/official.json`，源与生成物都提交在仓库，`git diff` 即审计）。发布与审计：

- **日常改词走维护后台**：维护后台 → 关键词词库，先「导入公开词库」再用草稿表增删词条，保存即发布。Worker 对 manifest 用 Ed25519 签名（与名单快照同一把 release-1 私钥）后写入 R2 版本化产物；部署配置 `REQUIRE_SIGNED_KEYWORD_PACKS=1` 时密钥缺失会直接拒绝发布，不存在「无签名假发布」。用户在 X 页面最迟 15 分钟收敛到新规则，无需任何操作。
- **离线兜底**：仓库 `community/keyword-packs/source.json` + `pnpm keyword-packs:build / check / publish`（本机 `.secrets/` 密钥签名）。发布脚本拒绝本地版本 ≤ 远程已有版本的发布，防止把最新指针顶回客户端拒收（`rollback_rejected`）的旧版；内容变更但 `pack_version` 没升时 build 直接报错。
- **回滚语义**：后台「发布记录」回滚 = 把目标版本的内容以**新版本号**重新签名发布。客户端对已接受版本有防回滚，内容回滚必须以新版本号下发；草稿不回退，下一次保存会基于当前草稿再次发布。
- **撤词信号**：后台「反馈」页按规则聚合的误报申诉是撤词 / 改词的第一信号源；新词入库前先过一遍分层 corpus 回归，保 recall 不伤 precision。

## 公开白名单（金刚防护罩）怎么维护

白名单是黑名单的镜像：名单内账号**永远不会被标注或拉黑**，扩展对 `whitelist` 段一票否决，优先级高于一切检测来源（社区名单 / 指纹 / 域名 / 词库）。它不来自票数，而是维护者的公开背书，理由是透明的：

```text
verified   社区白名单：抢救净票 >= 3（误标申诉合意，随快照 verified 段下发）
whitelist  公开白名单：维护者在 GitHub 维护 whitelist.yaml，公开背书（随快照 whitelist 段下发）

任何来源命中 whitelist -> 不标注、不拉黑、不进黑名单 entries
```

白名单的唯一写入通道是公开仓库：

- **提交**：PR 修改 [`lists/whitelist.yaml`](lists/whitelist.yaml) 的 `entries`，每条必须带 4-240 字入册说明（note，公开问责）。
- **审核**：维护者人工审核合并。入册标准：误标申诉经核实、知名正常账号等；不接受匿名批量提交。
- **生效**：合并后运行 [`scripts/publish-community-whitelist.sh`](../scripts/publish-community-whitelist.sh)（`--check` 只校验预览；不带参数才写库）。脚本以「文件为唯一事实」整体同步：文件里删除的账号从白名单撤销。快照对白名单变化按「当日一版」节流发布，运营可在社区后台显式发布立即生效。
- **审计**：`whitelist.yaml` 的 git 历史就是白名单的完整变更记录；数据库另有 `maintainer_whitelist_audit` 审计表兜底。

白名单账号若同时有黑名单票数，黑名单条目自动让位（客户端对同 handle 双份条目会整份拒绝快照，服务端先保证互斥）。

## 治理红线

- 一人一账号一张当前票；同一安装的新选择覆盖旧选择。
- 维护者没有隐藏加权票，也没有永久否决票。
- 白名单豁免只来自公开背书（`whitelist.yaml` + git 历史全程审计），不是任何隐藏票。
- 维护者直接来源必须公开标注并给出说明。
- 名单命中和批量拉黑不产生新社区票。
- 观点、政治立场、价值观和兴趣差异不是垃圾证据。
- 最终拉黑权属于用户。
