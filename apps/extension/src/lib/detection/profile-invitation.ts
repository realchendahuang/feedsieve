import type { HeuristicRule } from '@feedsieve/detector';

export const PROFILE_INVITATION_RULE_ID = 'keyword:profile:adult-invitation';

/** Nickname-only paired signals. Never infer solicitation from lyrics, age or emoji alone. */
export function createProfileInvitationRule(normalize: (text: string) => string): HeuristicRule {
  return {
    id: PROFILE_INVITATION_RULE_ID,
    check(input) {
      const raw = input.displayName;
      if (!raw || raw.length > 160) return null;
      const name = normalize(raw).replace(/[\p{P}\p{S}\s]+/gu, '');
      // Warnings and explicit refusals are not invitations.
      if (/警惕|谨防|举报|曝光|辟谣|反诈|不要信|别信|不要看|别看|拒绝|不找|不约|不招/.test(name))
        return null;
      const profileCta = /(?:看|见)(?:我)?(?:简介|主页|置顶)/.test(name);
      const partnerInvitation = /(?:找|招|寻|约)(?:个|位)?单(?:男|女)/.test(name);
      // Keep this evidence in the original text: NFKC turns 🈷 into the ordinary word 月.
      const codedInvitation = /🈷/u.test(raw);
      let pair: string | null = null;
      if (partnerInvitation && profileCta) pair = '招揽单男/单女 + 资料导流';
      else if (codedInvitation && /(?:真实|线下)(?:约见|见面)/.test(name)) {
        pair = '🈷暗号 + 真实/线下约见';
      } else if (codedInvitation && profileCta && /(?:想|求)月|月主人|真实月|线下月/.test(name)) {
        pair = '🈷招揽组合 + 资料导流';
      }
      return pair ? `命中官方规则：${pair} · 昵称` : null;
    },
  };
}
