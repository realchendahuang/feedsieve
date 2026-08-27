// @vitest-environment happy-dom
// fixtures/x 脱敏样本 → detector 联动：reader 产物喂给 detect，垃圾样本应命中
import { describe, expect, it } from 'vitest';
import { detect } from '@feedsieve/detector';
import { extractFeedItem } from '@feedsieve/x-adapter';
import { HOME_TIMELINE_HTML } from '../../../../fixtures/x/timeline/home-timeline';
import { SEARCH_F_LIVE_HTML } from '../../../../fixtures/x/timeline/search-f-live';

function detectAll(html: string): Array<{ handle: string; detection: ReturnType<typeof detect> }> {
  document.body.innerHTML = html;
  const articles = [...document.querySelectorAll('article[data-testid="tweet"]')];
  return articles.map((article) => {
    const item = extractFeedItem(article);
    const detection = detect(
      {
        handle: item?.author.handle ?? '',
        displayName: item?.author.displayName,
        text: item?.text ?? '',
        links: item?.links ?? [],
      },
      { list: new Set() },
    );
    return { handle: item?.author.handle ?? '', detection };
  });
}

describe('fixtures/x detector 联动', () => {
  it('home-timeline: flags giveaway & porn-bait samples, keeps normal clean', () => {
    const results = detectAll(HOME_TIMELINE_HTML);

    expect(results[0]?.detection).toBeNull(); // normaluser
    expect(results[1]?.detection?.ruleId).toBe('templated-text'); // spamking88 giveaway
    expect(results[2]?.detection?.ruleId).toBe('porn-bait-zh'); // cndon91
  });

  it('search-f-live: flags airdrop-bait sample, keeps normal clean', () => {
    const results = detectAll(SEARCH_F_LIVE_HTML);

    expect(results[0]?.detection).not.toBeNull(); // trxminer07 airdrop bait
    expect(results[1]?.detection).toBeNull(); // reallife42
  });
});