// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REDESIGN_TWEET_HTML } from '../../../fixtures/x/timeline/redesign';
import { extractFeedItem, extractTweetIdentity, extractTweetTime } from './reader';
import { tweetSelectors } from './selectors/selectors';

function render(): Element {
  document.body.innerHTML = REDESIGN_TWEET_HTML;
  return document.querySelector('article')!;
}

beforeEach(() => vi.stubGlobal('location', new URL('https://x.com/home')));
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('2026-11 X redesign without data-testid', () => {
  it('discovers the captured post but not unrelated article elements', () => {
    const article = render();
    document.body.insertAdjacentHTML('beforeend', '<article><p>Unrelated content</p></article>');
    expect(article.querySelector('[data-testid]')).toBeNull();
    expect([...document.querySelectorAll(tweetSelectors.article)]).toEqual([article]);
  });

  it('extracts identity, display name and body from the captured structure', () => {
    const article = render();
    expect(extractFeedItem(article, 'timeline')).toEqual({
      source: 'x',
      postId: '1800000000000000001',
      author: { handle: 'sample_user', displayName: 'Sample Author' },
      text: 'Sample post body.',
      links: [],
      context: 'timeline',
    });
    expect(extractTweetIdentity(article)).toEqual({
      postId: '1800000000000000001',
      author: { handle: 'sample_user' },
    });
    // The capture has no machine-readable timestamp: do not invent one from "1小时".
    expect(extractTweetTime(article)).toBeUndefined();
  });

  it('keeps the parent author/body/links when a quoted post occurs first', () => {
    const article = render();
    const quote = document.createElement('div');
    quote.setAttribute('role', 'link');
    quote.setAttribute('data-href', '/quoted_user/status/1800000000000000002');
    quote.innerHTML = REDESIGN_TWEET_HTML.replaceAll('sample_user', 'quoted_user')
      .replaceAll('1800000000000000001', '1800000000000000002')
      .replaceAll('Sample post body.', 'Quoted giveaway. <a href="https://t.co/quoted">quoted</a>');
    article.prepend(quote);
    const body = article.querySelectorAll('.whitespace-pre-wrap')[1]!;
    body.insertAdjacentHTML('beforeend', '<img alt="🌸"><a href="https://t.co/own"> own link</a>');
    const item = extractFeedItem(article);
    expect(item?.postId).toBe('1800000000000000001');
    expect(item?.author.handle).toBe('sample_user');
    expect(item?.text).toBe('Sample post body.🌸 own link');
    expect(item?.links.map((link) => link.href)).toEqual(['https://t.co/own']);
  });

  it('does not treat a clickable outer timeline wrapper as a quoted post', () => {
    const article = render();
    const wrapper = document.createElement('div');
    wrapper.setAttribute('role', 'link');
    article.replaceWith(wrapper);
    wrapper.append(article);
    article.querySelector('a[href$="/1800000000000000001"]')!.innerHTML =
      '<time datetime="2026-11-16T08:00:00Z">1小时</time>';
    expect(extractTweetTime(article)).toBe(Date.parse('2026-11-16T08:00:00Z'));
    expect(extractFeedItem(article)?.text).toBe('Sample post body.');
  });

  it('fails closed when a redesign header does not match its post author', () => {
    const article = render();
    article
      .querySelector('a[href$="/1800000000000000001"]')!
      .setAttribute('href', '/different_user/status/1800000000000000001');
    expect(extractFeedItem(article)).toBeNull();
    expect(extractTweetIdentity(article)).toBeNull();
  });
});
