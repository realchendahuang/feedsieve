import { describe, expect, it } from 'vitest';
import { createMentionInvitationRule, MENTION_INVITATION_RULE_ID } from './mention-invitation';
import {
  normalizeKeywordPhrase,
  createKeywordHeuristics,
  DEFAULT_KEYWORD_RULE_SETTINGS,
} from './keyword-rules';
import { runDetectionPipeline } from './detection-pipeline';
import { BUNDLED_KEYWORD_PACK_CATALOG } from './keyword-packs';
import { communityVoteForDetection } from '../content/block-core';
const rule = createMentionInvitationRule(normalizeKeywordPhrase);
const text = '她太涩了qy 我真顶不住\n@belly308\n2o';
describe('paired third-party promotion', () => {
  it('marks the supplied Sarah sample as review, not the mentioned account and never a community vote', () => {
    const result = runDetectionPipeline({
      input: { handle: 'saraheeehuuu', displayName: 'Sarah Sam', text },
      community: null,
      builtinList: new Set(),
      keywordHeuristics: createKeywordHeuristics(DEFAULT_KEYWORD_RULE_SETTINGS),
      catalog: BUNDLED_KEYWORD_PACK_CATALOG,
      strength: 'standard',
      uiLanguage: 'zh',
    });
    expect(result.presentation).toBe('review');
    expect(result.detection?.handle).toBe('saraheeehuuu');
    expect(result.detection?.ruleId).toBe(MENTION_INVITATION_RULE_ID);
    expect(result.category).toBe('adult_gray_traffic');
    expect(communityVoteForDetection(result.detection?.source, result.detection?.ruleId)).toBe(
      false,
    );
    expect(
      createKeywordHeuristics({ ...DEFAULT_KEYWORD_RULE_SETTINGS, subscribedCategoryIds: [] }),
    ).not.toContainEqual(expect.objectContaining({ id: MENTION_INVITATION_RULE_ID }));
  });
  it.each([
    ['love_live_idol', '她太涩了jl 我真顶不住\n@kkilyc\n 2w'],
    ['MeSoHawny94', '她太涩了rc 我真顶不住 \n@belly308\n 9f'],
  ])('covers the additional live sibling %s', (handle, text) => {
    expect(rule.check({ handle, text })).not.toBeNull();
  });
  it('normalizes inserted emoji, traditional characters and full-width mention syntax', () => {
    expect(
      rule.check({ handle: 'author', text: '她太澀了💞 qy 我真頂不住 ＠belly308 2o' }),
    ).not.toBeNull();
  });
  it.each([
    '她太涩了qy 我真顶不住 2o',
    "How does Proton like? I've not used it",
    '我才不想让他们去看快手呀！！！',
    'proton从昨天开始就进不去了…还有什么加速器推荐么',
    '她太涩了qy 我真顶不住 @author 2o',
    '这个节点太慢了我真顶不住 @belly308',
    '她太强了我真顶不住 @belly308',
    '别信这种垃圾话术：她太涩了qy 我真顶不住 @belly308 2o',
    '“她太涩了qy 我真顶不住 @belly308 2o”',
    '这首歌的歌词是她太涩了我真顶不住 @belly308',
    '她太涩了qy 我真顶不住 mail@belly308 2o',
  ])('does not treat incomplete, quoted or unrelated content as promotion: %s', (text) => {
    expect(rule.check({ handle: 'author', text })).toBeNull();
  });
});
