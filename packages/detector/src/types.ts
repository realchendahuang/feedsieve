/**
 * Detector 输出契约。
 *
 * 每个标注必须可解释：marked 为 true 时 reason 和 source 必须能说清「为什么标它」。
 */

/** 标注来源。社区名单优先，指纹/域名次之，启发式补充，AI 最后接入（见 IMPLEMENTATION_PLAN.md）。 */
export type DetectionSource =
  | 'community-list'
  | 'builtin-list'
  | 'heuristic'
  | 'fingerprint'
  | 'domain'
  | 'ai'
  /** 用户已拉黑的账号仍出现在 feed（X 服务端行为），由本地已拉黑名单标注 */
  | 'blocked';

export interface Detection {
  /** 归一化后的 handle，不带 @ 前缀，小写。 */
  handle: string;
  /** true 表示黄框标注；FeedSieve 标注绝不隐藏内容。 */
  marked: boolean;
  source: DetectionSource;
  /** 人可读的标注理由，如「名单命中」「启发式：默认名 + 随机数字」。 */
  reason: string;
  /** 命中的具体规则 ID，便于统计与调参（如 'list'、'default-name-digits'）。 */
  ruleId?: string;
}
