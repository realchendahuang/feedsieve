import { describe, expect, it } from 'vitest';
import { runDetectionPipeline } from './detection-pipeline';
import { BUNDLED_KEYWORD_PACK_CATALOG } from './keyword-packs';
import {
  createKeywordHeuristics,
  DEFAULT_KEYWORD_RULE_SETTINGS,
  normalizeKeywordPhrase,
} from './keyword-rules';
import { createProfileInvitationRule, PROFILE_INVITATION_RULE_ID } from './profile-invitation';
import { communityVoteForDetection } from '../content/block-core';

const samples = [
  ['HollyOlexaapsz', '娇妻媚儿（❤️想找单男看我简介🍑', '那一夜你👆没有拒绝我🤝🏻 💪不是人机 7 🌲'],
  ['LisandraNa3bd', '冰冰🈷️（大三学生🍓真实约见👌', '那一夜你👆没有拒绝我😁 🧒不是人机 🌲 😚'],
  [
    'AldoDanielski',
    '线下🈷️舞蹈学院球球想🈷️看简介🍑',
    't我果👆然太涩了💞😎 有人想锐评一下我的福嘛 - 3',
  ],
  [
    'LeahTappenuf6',
    '真实🈷️幂幂（腰软 🈷️主人看简介🍑',
    '玩归玩闹归闹🗣️👩‍给你看福👆我不开玩笑 0 m q',
  ],
];
function run(displayName: string, text: string, subscribed = true, handle = 'ordinaryname') {
  return runDetectionPipeline({
    input: { handle, displayName, text },
    community: null,
    builtinList: new Set(),
    keywordHeuristics: createKeywordHeuristics({
      ...DEFAULT_KEYWORD_RULE_SETTINGS,
      subscribedCategoryIds: subscribed ? ['adult_gray_traffic'] : [],
    }),
    catalog: BUNDLED_KEYWORD_PACK_CATALOG,
    strength: 'standard',
    uiLanguage: 'zh',
  });
}
describe('nickname invitation evidence in the production pipeline', () => {
  it.each(samples)(
    'marks supplied sample %s as review without requiring a bio or random handle',
    (handle, name, text) => {
      const result = run(name!, text!, true, handle!);
      expect(result.presentation).toBe('review');
      expect(result.category).toBe('adult_gray_traffic');
      expect(result.detection?.ruleId).toBe(PROFILE_INVITATION_RULE_ID);
      expect(result.detection?.reason).toContain('昵称');
      expect(
        communityVoteForDetection(result.detection?.source, result.detection?.ruleId ?? undefined),
      ).toBe(false);
    },
  );
  it.each([
    '冰冰（大三学生🍓',
    '舞蹈学院球球',
    '冰冰🈷️',
    '摄影约拍看我简介',
    '冰冰9月真实约见',
    '活动🈷️线下讲座看简介',
    '交友想找单男',
    '想找单男但不要看我简介',
    '反诈：想找单男看我简介是垃圾话术',
    '不找单男看我简介',
    '冰冰🌙真实约见',
  ])('keeps incomplete or ordinary nickname %s unmarked', (name) => {
    const rule = createProfileInvitationRule(normalizeKeywordPhrase);
    expect(
      rule.check({ handle: 'normaluser', displayName: name, text: samples[0]![2] }),
    ).toBeNull();
  });
  it('does not apply nickname signals to quoted text or bio', () => {
    const rule = createProfileInvitationRule(normalizeKeywordPhrase);
    expect(
      rule.check({
        handle: 'normaluser',
        displayName: '普通博主',
        text: samples[0]![1],
        bio: samples[1]![1],
      }),
    ).toBeNull();
    expect(run('普通博主', samples[0]![2]!).presentation).toBe('ignore');
  });
  it('honors disabling adult filtering', () => {
    expect(run(samples[0]![1]!, samples[0]![2]!, false).presentation).toBe('ignore');
  });
  it('handles separators and zero-width characters in invitation anchors', () => {
    const rule = createProfileInvitationRule(normalizeKeywordPhrase);
    expect(
      rule.check({ handle: 'normaluser', displayName: '想找单\u200b男❤️看·我·简·介' }),
    ).toContain('昵称');
  });
});
