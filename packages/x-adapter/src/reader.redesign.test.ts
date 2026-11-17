// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REDESIGN_TWEET_HTML } from '../../../fixtures/x/timeline/redesign';
import {
  extractFeedItem,
  extractTweetIdentity,
  extractTweetTime,
  findTweetAvatarImg,
} from './reader';
import { menuSelectors, tweetSelectors } from './selectors/selectors';

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

  it('excludes X Article read-view <article> even when it embeds tweets with like actions', () => {
    document.body.innerHTML = `
      <article data-testid="tweet" id="outer">
        <div data-testid="User-Name"><a href="/author">Author</a></div>
        <a href="/author/status/1900000000000000001"><time datetime="2026-11-17T00:00:00Z">1h</time></a>
        <article data-testid="twitterArticleReadView" id="readview">
          ${REDESIGN_TWEET_HTML}
        </article>
        <div role="group"><button data-testid="like">1</button></div>
      </article>`;
    const matched = [...document.querySelectorAll(tweetSelectors.article)].map((n) => n.id || 'embedded');
    expect(matched).toEqual(['outer', 'embedded']);
  });

  it('finds own author avatar on redesign without Tweet-User-Avatar and ignores quote/emoji imgs', () => {
    const article = render();
    article
      .querySelector('.x-avatar')!
      .insertAdjacentHTML('beforeend', '<img src="https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png" />');
    article
      .querySelector('.whitespace-pre-wrap')!
      .insertAdjacentHTML('beforeend', '<img alt="🌸" src="https://abs-0.twimg.com/emoji/v2/svg/1f338.svg" />');
    const quote = document.createElement('div');
    quote.setAttribute('role', 'link');
    quote.innerHTML = `
      <a href="/other"><img src="https://pbs.twimg.com/profile_images/1/quoted.jpg" /></a>
      <a href="/other/status/1800000000000000009">1h</a>`;
    article.prepend(quote);
    expect(findTweetAvatarImg(article)?.getAttribute('src')).toContain('default_profile_images');
  });

  it('matches XDS and semantic role=menu dropdowns without data-testid="Dropdown"', () => {
    document.body.innerHTML = `
      <div data-slot="xds-menu-content" id="xds"><div role="menuitem">Share</div></div>
      <div role="menu" id="aria"><div role="menuitem">Copy</div></div>`;
    const matched = [...document.querySelectorAll(menuSelectors.dropdown)].map((n) => n.id);
    expect(matched).toEqual(['xds', 'aria']);
  });
});
