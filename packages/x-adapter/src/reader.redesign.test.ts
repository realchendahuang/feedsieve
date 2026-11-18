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
    const matched = [...document.querySelectorAll(tweetSelectors.article)].map(
      (n) => n.id || 'embedded',
    );
    expect(matched).toEqual(['outer', 'embedded']);
  });

  it('finds own author avatar on redesign without Tweet-User-Avatar and ignores quote/emoji imgs', () => {
    const article = render();
    article
      .querySelector('.x-avatar')!
      .insertAdjacentHTML(
        'beforeend',
        '<img src="https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png" />',
      );
    article
      .querySelector('.whitespace-pre-wrap')!
      .insertAdjacentHTML(
        'beforeend',
        '<img alt="🌸" src="https://abs-0.twimg.com/emoji/v2/svg/1f338.svg" />',
      );
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

  it('recognizes redesigned detail-page focal tweet where permalink sits below body and header is stacked', () => {
    document.body.innerHTML = `
      <article class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <a href="/focal_author"><div class="x-avatar"><img src="https://pbs.twimg.com/profile_images/1/focal.jpg" /></div></a>
            <div class="flex flex-col">
              <div><a href="/focal_author"><div class="font-bold">Focal Name</div></a></div>
              <div><a href="/focal_author"><span>@focal_author</span></a></div>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <button data-slot="xds-menu-trigger" aria-label="更多"></button>
          </div>
        </div>
        <div class="text-body whitespace-pre-wrap wrap-anywhere"><span>Main focal post body.</span></div>
        <div role="link">
          <a href="/quoted_user/status/1800000000000000002">2h</a>
          <div class="whitespace-pre-wrap wrap-anywhere"><span>Quoted text should not leak</span></div>
        </div>
        <div class="meta-row">
          <a href="/focal_author/status/1800000000000000777">上午5:25 · 2026年11月15日</a>
          <a href="/focal_author/status/1800000000000000777/analytics">10K 查看</a>
        </div>
        <div role="group">
          <div data-engagement-action="unlike"><button aria-label="取消点赞"></button></div>
        </div>
      </article>`;
    const article = document.querySelector(tweetSelectors.article)!;
    expect(article).not.toBeNull();
    expect(extractFeedItem(article, 'reply')).toEqual({
      source: 'x',
      postId: '1800000000000000777',
      author: { handle: 'focal_author', displayName: 'Focal Name' },
      text: 'Main focal post body.',
      links: [],
      context: 'reply',
    });
    expect(findTweetAvatarImg(article)?.getAttribute('src')).toContain('focal.jpg');
  });

  it('recognizes redesigned focal tweet when author displayName has Twemoji/affiliate imgs and excludes polls or post-permalink notes', () => {
    document.body.innerHTML = `
      <article class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <a href="/emoji_op"><div class="x-avatar"><img src="https://pbs.twimg.com/profile_images/1/op.jpg" /></div></a>
            <div class="flex flex-col">
              <div class="flex items-center gap-1">
                <a href="/emoji_op"><div class="font-bold">🌸甜心<img alt="🚀" src="https://abs-0.twimg.com/emoji/v2/svg/1f680.svg" /></div></a>
                <a href="/org_hq"><img src="https://pbs.twimg.com/profile_images/2/org.jpg" alt="Org" /></a>
              </div>
              <div><a href="/emoji_op"><span>@emoji_op</span></a></div>
            </div>
          </div>
        </div>
        <div class="text-body whitespace-pre-wrap wrap-anywhere"><span>Focal body text only.</span></div>
        <div role="radiogroup">
          <button type="button"><div class="whitespace-pre-wrap wrap-anywhere"><span>Poll option A</span></div></button>
        </div>
        <div class="meta-row">
          <a href="/emoji_op/status/1800000000000000888">上午9:10 · 2026年11月18日</a>
        </div>
        <div class="community-note">
          <div class="whitespace-pre-wrap wrap-anywhere"><span>Community note warning: giveaway scam</span></div>
        </div>
        <div role="group">
          <div data-engagement-action="like"><button aria-label="点赞"></button></div>
        </div>
      </article>`;
    const article = document.querySelector(tweetSelectors.article)!;
    expect(extractFeedItem(article, 'reply')).toEqual({
      source: 'x',
      postId: '1800000000000000888',
      author: { handle: 'emoji_op', displayName: '🌸甜心🚀' },
      text: 'Focal body text only.',
      links: [],
      context: 'reply',
    });
    expect(findTweetAvatarImg(article)?.getAttribute('src')).toContain('op.jpg');
  });

  it('extracts redesigned promoted posts that replace the timestamp permalink with a Promoted label', () => {
    document.body.innerHTML = REDESIGN_TWEET_HTML.replace(
      '<span><a class="x-link" href="/sample_user/status/1800000000000000001">1小时</a></span>',
      '<span>推广</span>',
    )
      .replaceAll('/sample_user/status/1800000000000000001/photo/1', '#')
      .replaceAll('/sample_user/status/1800000000000000001/analytics', '#');
    const article = document.querySelector(tweetSelectors.article)!;
    expect(extractFeedItem(article, 'timeline')).toEqual({
      source: 'x',
      postId: '1800000000000000001',
      author: { handle: 'sample_user', displayName: 'Sample Author' },
      text: 'Sample post body.',
      links: [],
      context: 'timeline',
    });

    // 若连回复动作里的 in_reply_to 也缺失，仍能提取作者与正文
    article.querySelector('[data-engagement-action="reply"] a')!.setAttribute('href', '#');
    expect(extractFeedItem(article, 'timeline')).toEqual({
      source: 'x',
      postId: undefined,
      author: { handle: 'sample_user', displayName: 'Sample Author' },
      text: 'Sample post body.',
      links: [],
      context: 'timeline',
    });
  });

  it('ignores /status/ links inside body text on redesigned focal and promoted posts', () => {
    vi.stubGlobal('location', new URL('https://x.com/focal_author/status/1800000000000000777'));
    document.body.innerHTML = `
      <article class="flex flex-col gap-3">
        <div class="flex items-center gap-2">
          <a href="/focal_author"><div class="x-avatar"><img src="https://pbs.twimg.com/profile_images/1/f.jpg" /></div></a>
          <div class="flex flex-col">
            <div><a href="/focal_author"><div class="font-bold">Focal Name</div></a></div>
            <div><a href="/focal_author"><span>@focal_author</span></a></div>
          </div>
        </div>
        <div class="text-body whitespace-pre-wrap wrap-anywhere">
          <span>See <a href="/other_user/status/1800000000000000555">previous post</a></span>
        </div>
        <div class="meta-row">
          <a href="/focal_author/status/1800000000000000777">上午5:25 · 2026年11月15日</a>
        </div>
        <div role="group"><div data-engagement-action="like"><button aria-label="点赞"></button></div></div>
      </article>`;
    const focal = document.querySelector(tweetSelectors.article)!;
    expect(extractFeedItem(focal, 'reply')).toEqual({
      source: 'x',
      postId: '1800000000000000777',
      author: { handle: 'focal_author', displayName: 'Focal Name' },
      text: 'See previous post',
      links: [],
      context: 'reply',
    });

    // 详情页推广主帖无 /status/ 时间戳链接，仅带 in_reply_to 且正文提及他人状态链接
    vi.stubGlobal('location', new URL('https://x.com/focal_ad/status/1800000000000000999'));
    document.body.innerHTML = `
      <article class="flex flex-col gap-3">
        <div class="flex items-center gap-2">
          <a href="/focal_ad"><div class="x-avatar"><img src="https://pbs.twimg.com/profile_images/1/ad.jpg" /></div></a>
          <div class="flex flex-col">
            <div><a href="/focal_ad"><div class="font-bold">Promoted OP</div></a></div>
            <div><a href="/focal_ad"><span>@focal_ad</span></a></div>
          </div>
        </div>
        <div class="text-body whitespace-pre-wrap wrap-anywhere">
          <span>Promo body <a href="/other_user/status/1800000000000000555">ref</a></span>
        </div>
        <div class="meta-row"><span>推广</span></div>
        <div role="group">
          <div data-engagement-action="reply"><a href="/compose/post?in_reply_to=1800000000000000999"></a></div>
          <div data-engagement-action="like"><button aria-label="点赞"></button></div>
        </div>
      </article>`;
    const promotedFocal = document.querySelector(tweetSelectors.article)!;
    expect(extractFeedItem(promotedFocal, 'reply')).toEqual({
      source: 'x',
      postId: '1800000000000000999',
      author: { handle: 'focal_ad', displayName: 'Promoted OP' },
      text: 'Promo body ref',
      links: [],
      context: 'reply',
    });
  });
});
