import { describe, expect, it } from 'vitest';
import {
  collectContentEvidence,
  collectLinkDomains,
  isSelfDomain,
} from './detection-evidence';

describe('collectLinkDomains', () => {
  it('去自家域名、去重并封顶 5 个', () => {
    const links = [
      { hostname: 't.co', href: 'https://t.co/1' },
      { hostname: 'cdn.twimg.com', href: 'https://cdn.twimg.com/a' },
      { hostname: 'spam.example.com', href: 'https://spam.example.com' },
      { hostname: 'SPAM.example.com', href: 'https://spam.example.com/2' },
      { hostname: 'phish.example.com', href: 'https://phish.example.com' },
      { hostname: 'bait.example.com', href: 'https://bait.example.com' },
      { hostname: 'extra.example.com', href: 'https://extra.example.com' },
    ];
    expect(collectLinkDomains(links)).toEqual([
      'spam.example.com',
      'phish.example.com',
      'bait.example.com',
      'extra.example.com',
    ]);
  });

  it('全是自家域名时返回 undefined', () => {
    expect(collectLinkDomains([{ hostname: 'x.com' }, { hostname: 't.co' }])).toBeUndefined();
    expect(collectLinkDomains([{}])).toBeUndefined();
  });
});

describe('isSelfDomain', () => {
  it('匹配 X 自家及子域名', () => {
    expect(isSelfDomain('x.com')).toBe(true);
    expect(isSelfDomain('www.twitter.com')).toBe(true);
    expect(isSelfDomain('notx.com')).toBe(false);
  });
});

describe('collectContentEvidence', () => {
  it('收集指纹与外链域名；无内容时两者皆空', () => {
    const withContent = collectContentEvidence({
      handle: '@a',
      displayName: 'a',
      links: [{ href: 'https://spam.example.com', hostname: 'spam.example.com' }],
      text: '免费刷量 加微信 12345',
    });
    expect(withContent.contentFingerprint).toBeTruthy();
    expect(withContent.linkDomains).toEqual(['spam.example.com']);

    const bare = collectContentEvidence({
      handle: '@a',
      displayName: 'a',
      text: '',
    });
    expect(bare.contentFingerprint).toBeUndefined();
    expect(bare.linkDomains).toBeUndefined();
  });
});
