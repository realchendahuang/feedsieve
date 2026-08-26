/**
 * 启发式规则 v1（IMPLEMENTATION_PLAN.md Phase 1）。
 *
 * 每条规则必须保守、可解释：宁可漏判也不误标（误杀有 Unblock 兜底，
 * 但噪音会摧毁「黄框值得信任」这个产品根基）。
 *
 * 规则只消费 Reader 能稳定提供的字段：handle / displayName / text / links。
 */

import type { DetectInput } from './detect';

/** 单条启发式的命中结论。null 表示未命中。 */
export interface HeuristicRule {
  id: string;
  check(input: DetectInput): string | null;
}

/** X 新号常见形态：「User123456789」/「用户 9527」。 */
const DEFAULT_NAME_RE = /^(?:user|用户)[\s\u00a0]*\d{5,}$/i;
/** handle 形态：极短字母前缀 + 长数字尾巴（如 ab12345678），经典批量注册产物。 */
const DIGIT_TAIL_HANDLE_RE = /^[a-z]{1,10}\d{5,}$/;

const defaultNameDigits: HeuristicRule = {
  id: 'default-name-digits',
  check(input) {
    const displayName = input.displayName?.trim();
    if (displayName && DEFAULT_NAME_RE.test(displayName)) {
      return '默认名 + 随机数字，疑似批量注册账号';
    }
    if (
      DIGIT_TAIL_HANDLE_RE.test(input.handle) &&
      (!displayName || DEFAULT_NAME_RE.test(displayName))
    ) {
      return 'handle 为短前缀长数字，且无有效昵称';
    }
    return null;
  },
};

/**
 * 垃圾推广链接的域名特征词。
 *
 * v0.1 先用确定性关键词而非封禁域名单（维护成本高、易误伤正常站点）；
 * 后续由社区名单的 Domain 实体（v0.4）接管真实黑名单。
 * 不要求词边界：垃圾域名惯用 myfreecrypto.xxx 这类嵌入式命名；
 * 多字词组合误命中正常域名的概率极低，且标注需用户确认才会拉黑。
 */
const SPAM_HOST_HINT_RE =
  /(?:giveaway|airdrop|freecrypto|freegift|claimrewards?)/i;

const spamLinkHint: HeuristicRule = {
  id: 'spam-link-hint',
  check(input) {
    for (const link of input.links ?? []) {
      if (!link.hostname) {
        continue;
      }
      if (SPAM_HOST_HINT_RE.test(link.hostname)) {
        return `链接指向可疑推广域名（${link.hostname}）`;
      }
    }
    return null;
  },
};

/** 模板化文本：高频垃圾话术。每条 pattern 的 label 会直接成为标注理由。 */
const TEMPLATED_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?:加|私)(?:我)?(?:微信|QQ|扣扣)|带单(?:老师)?|内部(?:群|渠道)|包赚|稳赚不赔/i, '中文引流 / 带单话术'],
  [
    /\b(?:dm|pm)\s+(?:me|us)\b[\s\S]{0,40}\b(?:invest|crypto|profit|earn|signal)/i,
    '英文 DM 引流 + 变现关键词',
  ],
  [/free\s+(?:crypto|bitcoin|eth|nft|gift\s?cards?)\b/i, '「免费加密货币/礼品卡」模板'],
];

const templatedText: HeuristicRule = {
  id: 'templated-text',
  check(input) {
    if (!input.text) {
      return null;
    }
    for (const [pattern, label] of TEMPLATED_PATTERNS) {
      if (pattern.test(input.text)) {
        return `模板化垃圾话术：${label}`;
      }
    }
    return null;
  },
};

/** 默认启发式集合，按优先级排列（前面的先命中先解释）。 */
export const DEFAULT_HEURISTICS: readonly HeuristicRule[] = [
  defaultNameDigits,
  spamLinkHint,
  templatedText,
];
