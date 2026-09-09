/**
 * 快照条目分类推理（纯函数）。
 *
 * 分类不再原样采用「票面多数」：v0.8.2 前，社区名单命中拉黑也会反向给社区加票，
 * 票面分类继承条目自身分类 —— 'other' 给自己投票形成回声，存量名单 97% 被钉在
 * 「其他」。这里按证据强度推导展示分类，优先级：
 *
 * 1. 外链域名证据（≥2 独立安装一致上报同一域名）→ scam_phishing；
 *    域名比话术难伪装，是单账号上最强的分类信号
 * 2. 具体类票面判断：排除回声票（detection_source=community-list）后，任何
 *    具体类（非 other）票都压过无信息的 'other' 票；多类并列取票数多者，
 *    再并列取字典序（产出确定）
 * 3. 话术模板证据（≥2 独立安装一致上报同一指纹）→ copy_paste
 * 4. 以上皆无 → other
 *
 * 维护者人工分类由快照合并层在推理结果之上覆盖（maintainer 优先级最高）。
 * 本函数只影响「为什么标注」（展示/解释），不影响「谁在名单里」（入榜仍是净票公式）。
 */

export interface CategoryVoteRow {
  reason: string;
  /** v0.7.6+ 客户端上报；旧客户端为 null（照常计票，无法识别是否回声） */
  detectionSource: string | null;
  count: number;
}

export interface CategoryInferenceInput {
  /** 当前 blocked 票面分布（每行 = 一个 reason × detection_source 组合的票数） */
  votes: readonly CategoryVoteRow[];
  /** ≥2 独立安装一致上报同一外链域名（与快照 domains 下发门槛同源） */
  hasDomainEvidence: boolean;
  /** ≥2 独立安装一致上报同一内容指纹（与快照 fingerprints 下发门槛同源） */
  hasFingerprintEvidence: boolean;
}

/** 回声票来源：社区名单命中拉黑是「采用既有结论」，对分类没有信息量。 */
export const ECHO_VOTE_SOURCE = 'community-list';

export function inferCategory(input: CategoryInferenceInput): string {
  if (input.hasDomainEvidence) {
    return 'scam_phishing';
  }
  const counts = new Map<string, number>();
  for (const vote of input.votes) {
    if (vote.detectionSource === ECHO_VOTE_SOURCE || vote.reason === 'other') {
      continue;
    }
    counts.set(vote.reason, (counts.get(vote.reason) ?? 0) + vote.count);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (top) {
    return top[0];
  }
  if (input.hasFingerprintEvidence) {
    return 'copy_paste';
  }
  return 'other';
}
