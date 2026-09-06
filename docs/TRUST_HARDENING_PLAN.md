# FeedSieve 信任边界加固路线图

## 背景与评审结论

2026-09 对扩展运行时 / detector / 队列 / X adapter / 社区 API / 快照与名单分发路径做过一轮架构与安全评审。
主结论：产品主要瓶颈已经不是「再增加几条检测规则」，而是社区共识、远程规则分发、X 兼容性、
发布流程与可观测性这些信任边界。**使用期红线：任何改动都不能给扩展用户或运营后台用户增加操作步骤；
开发/发布期的一次性配置允许。**

逐条状态对照（2026-09-06）：

| 评审点 | 状态 |
|---|---|
| `installation_id` 可被 Sybil 伪造、trust 不参与权重 | 阶段一已建 consensus v2 影子，待真实数据积累后切换 |
| SHA-256 不能证明发布者身份 | 阶段一已加 Ed25519 manifest 签名 + anti-rollback |
| X adapter 需要能力边界 | 阶段二 |
| 队列固定 400ms、失败分类不细 | 阶段三 |
| 云端 CI（此前否决） | 折中落实：PR 验证 CI，发布仍本机 |
| `content.ts` 职责过载（~1488 行） | 阶段三 |
| detector 缺 golden corpus 与指标 | 阶段一已落地 corpus v1 + 分层指标 |
| 快照生成异步化 | 工作区脏标记 + 5 分钟 cron 已落地（未提交批次） |
| 文档「原生菜单」措辞 | 阶段一已修正为「X 登录会话的内部 Block 接口」 |

## 阶段一（已完成）：信任与测量基础

- 共享签名协议 `packages/community-lists/src/signing.ts`：确定性签名消息（域前缀 + 版本 + 生成时间 + 文件清单），
  `crypto.subtle` Ed25519，扩展 / Worker / 脚本三方共用，字节一致。
- 扩展内置公钥 `trusted-keys.ts`（key_id `release-1`，支持多 key 轮换）；快照与词库 manifest 都强制验签，
  版本元组单调比较防回滚（`rollback_rejected`），任何失败保持 last-known-good。
- 快照自动签名（Worker 内）：`generateSnapshot` 读到部署配置 `SIGNING_PRIVATE_KEY` 即对 manifest 签名落库；
  `REQUIRE_SIGNED_SNAPSHOTS=1` 时公开端点只服务已签名行。发布流程零改动。
- 词库自动签名（本地脚本）：`keygen.mjs` 一次性生成密钥；`build-keyword-packs.mjs` 检测 `.secrets/` 密钥即嵌入签名，
  `--check` 剥离签名比对 + 内置公钥验签（CI 无密钥也能跑）；`publish-keyword-packs.sh` 拒绝未签名 manifest。
- consensus v2 影子：票权重 = trust × 安装成熟度（7 天观察期爬升，下限 0.15）；入榜 = 加权净票 ≥ 2.5
  且（跨 ≥ 2 天 或 ≥ 2 独立安装的内容证据）。只写 `accounts.status_v2 / consensus_v2`，不参与入榜。
- detector golden corpus v1（26 例）+ 回归测试 + 聚合指标（precision/recall/fpr，`CORPUS_REPORT=1` 写 metrics.json）。
- PR 验证 CI（`verify.yml`）：lint / keyword 产物检查 / typecheck / 全量测试 / community-api workerd 测试 / 扩展构建 / 依赖审计。
- 文档措辞：所有「原生菜单」机制表述改为「X 登录会话的内部 Block 接口」。

### 签名设计取舍（如实记录）

评审建议「签名私钥放 Worker/R2 路径之外」。本项目运营者与部署权限是同一人，离线签名的额外保护不成立；
阶段一采用 Worker 侧自动签名（密钥在 gitignored 部署配置），阻断「存储/CDN 被替换」这一评审描述的主攻击。
若将来发布权与运营权分离，升级到离线签名服务（见阶段二 kill switch 一节，签名位可复用）。

## 阶段二：X adapter 能力边界 + 降级

- `packages/x-adapter` 增加能力快照：`session usable / csrf available / userIdResolution / block / unblock /
  timelineParsing`，状态 `unknown | working | failed | unsupported`。能力只来自非破坏性观测
  （能否读到 ct0、已有 GraphQL/XHR 是否可解析、实际用户操作的结果、返回体是否未知 schema、最近错误类型），
  不预先执行破坏性动作探测。
- 降级行为：block 失败时检测 / 黄框 / 阅读解析继续，批量 Block 暂停，popup 显示「检测正常但 Block 暂不可用」。
- 破坏性动作专属 kill switch：配置本身必须签名（复用 trusted-keys）；只能关闭破坏性动作，不能远程开启自动 Block。
- detection 管线从 content.ts 抽出后，把 golden corpus 的分层指标升级为「review 层 vs 批拉层」。

## 阶段三：队列统一 + 运行可靠性

- `packages/block-queue` 成为唯一状态机（失败分类：`auth_required / missing_csrf / rate_limited / network_error /
  http_5xx / unsupported / permanent_4xx / 不确定结果先 reconcile`），扩展侧注入持久化适配器
  （browser.storage），消除与 `block-queue-store.ts` 的两套并行模型。
- 自适应节奏替代固定 400ms：依据 429 / 近期延迟 / 连续失败 / 批大小退避（尊重 `Retry-After`，指数退避 + jitter）。
- `auth_required / missing_csrf` 暂停整个 job 并提示重新登录；`unsupported` 停止并提示版本兼容问题；
  网络不确定结果先查账号当前状态再决定是否重试（防破坏性动作重复发送）。
- `content.ts` 渐进拆分：ArticleReader / ScanScheduler / DecorationController / ActionController，
  接口与回归测试先行，避免破坏 X 虚拟列表行为。

## 阶段四：规模化 + 切换

- 异步快照（工作区已落地脏标记 + cron）：接口返回 `accepted / queued / last_published`；如规模再涨，
  换 D1 任务表 + lease + Cron，或 Cloudflare Queues。
- 基于真实数据对比 v1 / v2（管理端已透出 `status_v2 / consensus_v2`），积累足够样本后切换 consensus v2
  并同步公开 policy；切换是未来某次发布的代码变更，不需要运营介入。
- 真实历史误报样本（匿名化）补充进 golden corpus。
- 发布机器变更后的恢复：密钥丢失时 `keygen.mjs` 重发 → 新公钥随扩展版本发布（多 key 并存窗口）→ 切换签名。

## 验证边界

- 签名：篡改 / 降级 / 错 key / 无签名均拒绝并保持 last-known-good；快照与词库两侧都有攻击性测试。
- CI 无密钥、无部署配置即可全绿（community-api 签名用例按环境 skip，本地 .dev.vars 覆盖）。
- 使用期零新增步骤：扩展用户（黄框 → 拉黑）与运营后台（保存即发布）流程不变。