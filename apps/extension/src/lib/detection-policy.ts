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
 * 服务器最终账号名单可进入页面「全部拉黑」。
 * 指纹/域名是间接证据，只有大扫除档给黄框复核提示（review），其余档不出现在页面上。
 * 关键词（本地自定义 + 官方词库）永远是人工确认提示（review），不预选任何自动动作；
 * 页面上的黄框统一进入弹窗待处理清单，批量拉黑只由用户显式一键触发（拍板语义），
 * 且两类关键词命中都不回灌社区票（计票口径见 content.ts 的 communityVoteForDetection）。
 */
export function classifyDetection(input: DetectionPolicyInput): DetectionPresentation {
  const { detection, communityEntry } = input;
  if (detection.source === 'blocked') return 'review';
  if (detection.source === 'community-list') {
    // 快照只包含服务端已经判定的最终名单；扩展不得再偷偷发明第二套门槛。
    return communityEntry ? 'block-candidate' : 'review';
  }
  if (detection.source === 'builtin-list') {
    return 'block-candidate';
  }
  if (detection.source === 'fingerprint' || detection.source === 'domain') {
    return input.strength === 'deep_clean' ? 'review' : 'ignore';
  }
  if (detection.source === 'heuristic' && detection.ruleId?.startsWith('keyword:')) {
    return 'review';
  }
  return 'ignore';
}
