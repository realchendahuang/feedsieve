// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { extractFeedItem } from './reader';

/**
 * 结构仿真实 X DOM（data-testid 锚点、User-Name 双行、t.co 外链包装）。
 * 真实脱敏快照会进入 fixtures/x/，这里用最小可复现样本锁定 reader 行为。
 */
function renderTweet(inner: string): Element {
  document.body.innerHTML = `<article data-testid="tweet">${inner}</article>`;
  return document.querySelector('article')!;
}

const BASIC_TWEET = `
  <div>
    <div data-testid="User-Name">
      <div><a href="/spamking88"><span>King Spam</span></a></div>
      <div><a href="/spamking88"><span>@spamking88</span></a><span>·</span></div>
    </div>
    <a href="/spamking88/status/1720000000000000000"><time>2h</time></a>
    <a href="/i/web/status/1720000000000000000"></a>
    <div data-testid="tweetText">free crypto! claim now
      <a href="https://t.co/abc123">https://giveaway-coin.top</a>
    </div>
  </div>`;

describe('extractFeedItem', () => {
  it('extracts author, postId, text and external links', () => {
    const item = extractFeedItem(renderTweet(BASIC_TWEET), 'timeline');
    expect(item).not.toBeNull();
    expect(item?.author.handle).toBe('spamking88');
    expect(item?.author.displayName).toBe('King Spam');
    expect(item?.postId).toBe('1720000000000000000');
    expect(item?.text).toContain('claim now');
    expect(item?.context).toBe('timeline');

    const hrefs = item!.links.map((l) => l.href);
    // t.co 包装链接保留；x.com 站内 UI 链接被剔除
    expect(hrefs.some((h) => h.startsWith('https://t.co/'))).toBe(true);
    expect(hrefs.every((h) => !h.startsWith('https://x.com'))).toBe(true);

    // Reader 预解析 hostname，Detector 不做 URL 解析
    expect(item!.links.find((l) => l.hostname === 't.co')).toBeDefined();
  });

  it('returns null when the article has no recognizable author', () => {
    const article = renderTweet('<div data-testid="tweetText">ghost post</div>');
    expect(extractFeedItem(article)).toBeNull();
  });

  it('returns null for an empty article', () => {
    expect(extractFeedItem(renderTweet(''))).toBeNull();
  });

  it('keeps display name undefined when only the handle is present', () => {
    const article = renderTweet(`
      <div data-testid="User-Name">
        <div><a href="/lonewolf"><span>@lonewolf</span></a></div>
      </div>
      <a href="/lonewolf/status/999"><time>now</time></a>`);
    const item = extractFeedItem(article);
    expect(item).not.toBeNull();
    expect(item?.author.handle).toBe('lonewolf');
    expect(item?.author.displayName).toBeUndefined();
  });

  it('strips @handle from display name without eating the text', () => {
    const article = renderTweet(`
      <div data-testid="User-Name">
        <div><a href="/lonewolf"><span>@lonewolf</span></a></div>
        <div><a href="/lonewolf"><span>@lonewolf</span></a></div>
      </div>
      <a href="/lonewolf/status/998"><time>1m</time></a>`);
    const item = extractFeedItem(article);
    expect(item).not.toBeNull();
    // 名字只有 @handle 本身时清洗后为空 -> undefined，而不是残留空串
    expect(item?.author.displayName).toBeUndefined();
  });
});
