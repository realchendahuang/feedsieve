import type { HeuristicRule } from '@feedsieve/detector';
export const MENTION_INVITATION_RULE_ID = 'keyword:profile:mention-invitation';
/** Paired body evidence: sexual endorsement followed by a different account mention. Review only. */
export function createMentionInvitationRule(normalize: (text: string) => string): HeuristicRule {
  return {
    id: MENTION_INVITATION_RULE_ID,
    check(input) {
      const raw = input.text;
      if (!raw || raw.length > 240 || /[“”「」『』«»"‘’]/u.test(raw)) return null;
      const text = raw.normalize('NFKC');
      const mentions = [...text.matchAll(/(?<![a-z0-9_@])@([a-z0-9_]{1,15})(?![a-z0-9_])/gi)];
      if (!mentions.some((m) => m[1]!.toLowerCase() !== input.handle.toLowerCase())) return null;
      // Remove the account before normalization: do not turn handle fragments into content signals.
      const body = normalize(
        text.replace(/(?<![a-z0-9_@])@[a-z0-9_]{1,15}(?![a-z0-9_])/gi, ''),
      ).replace(/[\p{P}\p{S}\s]/gu, '');
      if (/引用|这句话|话术|广告|垃圾|举报|反诈|骗子|别信|不要信|谎称|造谣|辟谣/.test(body))
        return null;
      // Full-body pattern bounds inserted ASCII noise and excludes ordinary discussion/context.
      if (
        !/^(?:她|他)(?:也|真)?太[涩色骚]了[a-z0-9]{0,6}我(?:真|真的|实在)?(?:顶不住|受不了)[a-z0-9]{0,6}$/u.test(
          body,
        )
      )
        return null;
      return '命中官方规则：擦边招徕表述 + 第三方账号提及 · 正文';
    },
  };
}
