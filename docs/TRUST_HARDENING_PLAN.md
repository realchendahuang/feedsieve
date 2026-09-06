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
| X adapter 需要能力边界 | 阶段二已落地能力快照 + popup 降级态 + 签名 kill switch |
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

## 阶段二（已完成）：X adapter 能力边界 + 降级

- `packages/x-adapter/src/status.ts` 能力快照：`sessionUsable / csrfAvailable / block / unblock /
  userIdResolution / timelineParsing`，状态 `unknown | working | degraded | failed | unsupported`。
  能力只来自非破坏性观测（ct0 可读性、最近真实操作的结构化结果 15 分钟窗口、扫描心跳），
  不预先执行破坏性动作探测；429/网络=degraded，认证类=failed，404/405/410=unsupported。
- 降级行为：检测 / 黄框 / 读取继续；`shouldPauseDestructive()` 判定时 popup 禁用全部拉黑入口，
  显示「拉黑接口暂不可用（X 变更或会话失效）；检测与标注不受影响」；队列对 `kill_switch` 暂停待恢复。
- 破坏性动作专属 kill switch：运营在部署配置设 `DESTRUCTIVE_KILL_SWITCH`（值为公开理由）即随
  已签名快照 body 下发——只能关闭拉黑，不能开启任何自动动作；开关翻转强制产生新版本，绝不复用旧 body。
- 分层指标已随阶段三落地（见阶段三「分层指标」节）。

## 阶段三（已完成）：队列统一 + 运行可靠性 + content 拆分

- `packages/block-queue` 成为唯一执行状态机：`failure.ts`（transient / pause / permanent / unsupported
  分类 + 指数退避 + Retry-After + 抖动）+ `runner.ts`（每次迭代重载状态、短 sleep 分片让 pause/cancel
  ≤250ms 生效）。扩展持久队列只注入「存储适配器 + 真实 Block 动作」，删除第二套循环语义。
  行为变化：429/网络/5xx 按任务退避重试，不再暂停整个队列；认证失效/缺 CSRF/官方暂停才暂停。
- `PageScanController`：脏集合 / revision 快照 / handle 倒排索引 / 去抖调度 / 分片执行 /
  MutationObserver / 健康心跳收敛为独立模块（content.ts 注入检测与装饰）；逐行对齐旧行为。
- `detection-pipeline.ts`：三阶段 detect + 社区条目/Campaign 增强 + 本地化理由 + classifyDetection
  分层 + 分类推导，content 的 scanOne 只做簿记与装饰落点。
- **分层指标落地**：`detection-layer-corpus.test.ts` 8 例金标 —— 社区/内置=block-candidate（可批量）、
  关键词=review（只进人工确认）、指纹/域名标准档=ignore / 大扫除档=review、干净账号=ignore。

## 阶段四：规模化 + 切换

- 异步快照（已落地：脏标记 + 5 分钟 cron 合并发布）。
- **consensus v2 切换（数据闸门）**：影子模式已记录 `accounts.status_v2 / consensus_v2`，切换前必须用
  真实票数历史对比 v1/v2 产出差异（这正是影子模式的设计对价，不能跳过）。数据积累到位后，切换是一次
  只改三处的普通发布：
  1. `rating.ts deriveStatus`：入榜条件改为「status_v2 === 'strong'」口径（或直接以 status_v2 为准）；
  2. `snapshot.ts` 选区 SQL：`WHERE status_v2 = 'strong'`（替换 `report_count - rescue_count >= ?1`）；
  3. `reports.ts publicPolicy()`：把 `consensus_v2.status` 从 `'shadow'` 改为 `'live'` 并同步
     `community/policy/v3.yaml` 与 CHANGELOG。
  切换不改变部署机制（同一次发版），运营零动作。
- 真实历史误报样本（匿名化）补充进 golden corpus（阶段三后 corpus 已有分层维度）。

## 验证边界

- 签名：篡改 / 降级 / 错 key / 无签名均拒绝并保持 last-known-good；快照与词库两侧都有攻击性测试。
- CI 无密钥、无部署配置即可全绿（community-api 签名用例按环境 skip，本地 .dev.vars 覆盖）。
- 使用期零新增步骤：扩展用户（黄框 → 拉黑）与运营后台（保存即发布）流程不变。