import type { Detection } from '@feedsieve/detector';
import type { CommunityEntry, MarkStrength } from '@feedsieve/community-lists';

/**
 * 扩展端的安全政策层。Detector 保留纯逻辑和规则单测，
 * 但「规则能跑」不等于「足以在用户页面上定罪」。
 */

export type DetectionPresentation = 'block-candidate' | 'review' | 'ignore';

export interface DetectionPolicyInput {
  detection: Detection;
  strength: MarkStrength;
  communityEntry?: CommunityEntry | null;
}

/**
 * 默认档只让账号级高置信名单进入页面「全部拉黑」。
 * 指纹/域名是间接证据，即使在大扫除档黄框提示，也不预选批量动作。
 * 任意内置算法的单关键词启发式不直接进入用户层；用户自己的关键词和
 * 可逐条关闭的官方词库例外，它们只作为人工确认提示，永远不进批量拉黑。
 */
export function classifyDetection(input: DetectionPolicyInput): DetectionPresentation {
  const { detection, communityEntry } = input;
  if (detection.source === 'blocked') return 'review';
  if (detection.source === 'community-list' || detection.source === 'builtin-list') {
    return communityEntry && isCommunityBlockEligible(communityEntry)
      ? 'block-candidate'
      : 'review';
  }
  if (detection.source === 'fingerprint' || detection.source === 'domain') {
    return input.strength === 'deep_clean' ? 'review' : 'ignore';
  }
  if (detection.source === 'heuristic' && detection.ruleId?.startsWith('keyword:')) {
    return 'review';
  }
  return 'ignore';
}

/**
 * 云端「一键清理」门槛要高于黄框：目前只放行 strong + >=3 独立正票
 * + 无抢救票的条目。待后端正式下发 block_eligible 后可替换此过渡规则。
 */
export function isCommunityBlockEligible(entry: CommunityEntry): boolean {
  return entry.status === 'strong' && entry.report_count >= 3 && entry.rescue_count === 0;
}
