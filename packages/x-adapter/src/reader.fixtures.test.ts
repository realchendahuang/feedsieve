// @vitest-environment happy-dom
// fixtures/x 脱敏样本 → reader 契约测试：selector 改动必须过这关
import { describe, expect, it } from 'vitest';
import { extractFeedItem } from './reader';
import { contextFromPath } from './handle';
import { HOME_TIMELINE_HTML } from '../../../fixtures/x/timeline/home-timeline';
import { SEARCH_F_LIVE_HTML } from '../../../fixtures/x/timeline/search-f-live';
import { THREAD_HTML } from '../../../fixtures/x/replies/thread';
import { PROFILE_TIMELINE_HTML } from '../../../fixtures/x/profile/profile';

/** 把 fixture 里的 article 逐个取出。 */
function articles(html: string): Element[] {
  document.body.innerHTML = html;
  return [...document.querySelectorAll('article[data-testid="tweet"]')];
}

describe('fixtures/x reader 契约', () => {
  it('home-timeline: parses 3 tweets with correct author/text/links', () => {
    const items = articles(HOME_TIMELINE_HTML).map((a) =>
      extractFeedItem(a, contextFromPath('/home')),
    );

    expect(items.map((i) => i?.author.handle)).toEqual([
      'normaluser',
      'spamking88',
      'cndon91',
    ]);
    expect(items[1]?.text).toContain('500 USDT Giveaway');
    expect(items[1]?.links.map((l) => l.hostname)).toContain('t.co');
    expect(items[1]?.links.every((l) => !l.href.startsWith('https://x.com'))).toBe(true);
    expect(items[0]?.context).toBe('timeline');
  });

  it('search-f-live: search context and variant spelling preserved', () => {
    const items = articles(SEARCH_F_LIVE_HTML).map((a) =>
      extractFeedItem(a, contextFromPath('/search?q=trx&f=live')),
    );

    expect(items.map((i) => i?.author.handle)).toEqual(['trxminer07', 'reallife42']);
    expect(items[0]?.text).toContain('#Giweaway'); // 拼写变体原文保留，交给 detector
    expect(items[0]?.context).toBe('search');
  });

  it('replies/thread: root and reply both parse; @mention links excluded', () => {
    const items = articles(THREAD_HTML).map((a) =>
      extractFeedItem(a, contextFromPath('/threadroot/status/1720000000000000201')),
    );

    expect(items.map((i) => i?.author.handle)).toEqual(['threadroot', 'replyguy2']);
    // 站内 @mention 是相对路径链接（生产环境 origin 是 x.com，reader 会剔除）；
    // 测试环境 origin 是 localhost，这里只锁定 t.co 外链保留
    const replyLinks = items[1]!.links.map((l) => l.href);
    expect(replyLinks.some((h) => h.startsWith('https://t.co/'))).toBe(true);
    expect(items[0]?.context).toBe('reply');
  });

  it('profile: same author across pinned tweets, profile context', () => {
    const items = articles(PROFILE_TIMELINE_HTML).map((a) =>
      extractFeedItem(a, contextFromPath('/pinnedauthor')),
    );

    expect(items.map((i) => i?.author.handle)).toEqual(['pinnedauthor', 'pinnedauthor']);
    expect(items.every((i) => i?.context === 'profile')).toBe(true);
  });
});