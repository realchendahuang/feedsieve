import { describe, expect, it } from 'vitest';
import { LocalCampaignIndex, hasLongNumericPayload, campaignTemplate } from './local-campaign';
import { normalizeKeywordPhrase } from './keyword-rules';

const a = '那一夜你👆没有拒绝我🤝🏻 💪不是人机 7 🌲';
const b = '那一夜你👆没有拒绝我😁 🧒不是人机 🌲 😚';
const c = '那一夜你👆没有拒绝我😁 🧒不是人机 1789266426152';
const eligible = () => true;
describe('local template association', () => {
  it('requires two distinct direct seeds AND candidate corroboration, independent of observation order', () => {
    expect(campaignTemplate(c, normalizeKeywordPhrase)).toBe(
      campaignTemplate(a, normalizeKeywordPhrase),
    );
    const index = new LocalCampaignIndex(normalizeKeywordPhrase);
    index.observe('candidate', c, false);
    index.observe('first', a, true);
    index.observe('FIRST', a, true);
    expect(index.match('candidate', c, eligible)).toBe(0);
    expect(index.observe('second', b, true)).toContain('candidate');
    expect(index.match('candidate', c, eligible)).toBe(2);
    expect(index.match('normal_lyric_quote', '那一夜你没有拒绝我', eligible)).toBe(0);
  });
  it('covers the supplied Regena case without numbers only after two direct seeds, never from repetition alone', () => {
    const text = '那一夜你没有拒绝我😨 🙄不是人机';
    const index = new LocalCampaignIndex(normalizeKeywordPhrase);
    index.observe('regenalawiweub', text, false);
    expect(index.match('regenalawiweub', text, eligible)).toBe(0);
    index.observe('first', a, true);
    expect(index.match('regenalawiweub', text, eligible)).toBe(0);
    expect(index.observe('second', b, true)).toContain('regenalawiweub');
    expect(index.match('regenalawiweub', text, eligible)).toBe(2);
    expect(index.match('regenalawiweub', text, (h) => h !== 'first')).toBe(0);
    expect(index.match('quote', '“那一夜你没有拒绝我不是人机”', eligible)).toBe(0);
    expect(index.match('warning', '垃圾话术：那一夜你没有拒绝我不是人机', eligible)).toBe(0);
    index.observe('first', a, false);
    expect(index.match('regenalawiweub', text, eligible)).toBe(0);
  });
  it('inferred accounts never amplify seed counts', () => {
    const index = new LocalCampaignIndex(normalizeKeywordPhrase);
    index.observe('first', a, true);
    for (let n = 0; n < 30; n++) index.observe(`inferred${n}`, c, false);
    expect(index.match('candidate', c, eligible)).toBe(0);
  });
  it('excludes protected seeds and retracts evidence after a direct seed changes', () => {
    const index = new LocalCampaignIndex(normalizeKeywordPhrase);
    index.observe('first', a, true);
    index.observe('second', b, true);
    expect(index.match('candidate', c, (handle) => handle !== 'first')).toBe(0);
    expect(index.observe('first', a, false)).toContain('second');
    expect(index.match('candidate', c, eligible)).toBe(0);
  });
  it('does not spread matches into unrelated text or short repeated phrases', () => {
    const index = new LocalCampaignIndex(normalizeKeywordPhrase);
    index.observe('first', a, true);
    index.observe('second', b, true);
    expect(index.match('normal', '快递查询请使用订单编号1789266426152', eligible)).toBe(0);
    index.observe('first', '早上好', true);
    index.observe('second', '早上好', true);
    expect(index.match('normal', '早上好1789266426152', eligible)).toBe(0);
  });
  it('expires and bounds the template history', () => {
    let now = 0;
    const index = new LocalCampaignIndex(normalizeKeywordPhrase, () => now);
    index.observe('first', a, true);
    index.observe('second', b, true);
    now = 16 * 60 * 1000;
    expect(index.match('candidate', c, eligible)).toBe(0);
    for (let n = 0; n < 513; n++)
      index.observe(
        'other',
        '这是另外一个足够长的独立模板' + String.fromCodePoint(0x4e00 + n),
        true,
      );
    expect(index.match('candidate', c, eligible)).toBe(0);
    index.clear();
    expect(index.match('candidate', c, eligible)).toBe(0);
  });
  it('counts neither URL IDs nor ordinary single digits as numeric payload', () => {
    expect(hasLongNumericPayload('https://x.com/user/status/1789266426152')).toBe(false);
    expect(hasLongNumericPayload('不是人机 7')).toBe(false);
    expect(hasLongNumericPayload('１７８ ９２６６ ４２６１５２')).toBe(true);
  });
});
