// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { createInsightDecorations } from './decorations';
import { createTweetStatsStore } from './tweet-stats';

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 29, 12);

// 结构仿 2026-10-30 真机：右上角是 [Grok 按钮, ... 按钮] 一组；User-Name 下第二行是 @handle
function tweetArticle(handle: string, postId: string, options: { caret?: boolean } = {}) {
  const article = document.createElement('article');
  article.setAttribute('data-testid', 'tweet');
  const caret =
    options.caret === false
      ? ''
      : `<div class="top-right"><div class="grok"><button>grok</button></div>
         <div><div><button data-testid="caret">…</button></div></div></div>`;
  article.innerHTML = `
    <div class="header">
      <div data-testid="User-Name">
        <div class="name-row"><a href="/${handle}">Name</a></div>
        <div class="handle-row"><div style="color: rgb(83, 100, 113);"><a href="/${handle}">@${handle}</a></div><a href="/${handle}/status/${postId}">1h</a></div>
      </div>
      ${caret}
    </div>
    <div data-testid="tweetText">text</div>
    <div role="group"><button data-testid="like">like</button></div>`;
  document.body.appendChild(article);
  return article;
}

function setup() {
  const store = createTweetStatsStore();
  const decorations = createInsightDecorations({ store, getLanguage: () => 'zh', now: () => NOW });
  return { store, decorations };
}

describe('createInsightDecorations', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    history.replaceState(null, '', '/');
  });

  it('puts the velocity pill left of the top-right buttons and the tier at the end of the handle row', () => {
    const { store, decorations } = setup();
    store.recordAuthor({ handle: 'alice', followers: 32_000, followingCount: 210 });
    store.recordTweet(
      { postId: '1', handle: 'alice', createdAt: NOW - 2 * HOUR, views: 500_000 },
      NOW,
    );
    const article = tweetArticle('alice', '1');
    decorations.decorate(article, { postId: '1', author: { handle: 'alice' } });

    const topRight = article.querySelector('.top-right')!;
    const pill = topRight.firstElementChild as HTMLElement;
    expect(pill.className).toBe('fs-velocity');
    // 页面上不出现汉字：图标 + 英文紧凑数字 + 破圈倍数
    // 只有图标和流速：破圈倍数、档位名都只在悬停卡片里
    expect(pill.textContent).toMatch(/^\d+(\.\d)?K\/h$/);
    expect(pill.querySelector('svg')?.getAttribute('data-fs-icon')).toBe('flame');
    expect(pill.getAttribute('data-fs-level')).toBe('rocket');
    expect(pill.getAttribute('data-fs-place')).toBe('top');
    expect(pill.hasAttribute('title')).toBe(false);

    const tier = article.querySelector('.handle-row > .fs-tier') as HTMLElement;
    expect(tier.getAttribute('data-fs-tier-level')).toBe('6');
    expect(tier.querySelector('svg')?.getAttribute('data-fs-icon')).toBe('award');
    expect(tier.textContent).toBe('32K');
    // 不上色：用这一行 X 自己的次要文字色
    expect(tier.style.color).toBe('rgb(83, 100, 113)');
  });

  it('keeps velocity at the top right on the post detail page too', () => {
    const { store, decorations } = setup();
    store.recordTweet({ postId: '9', handle: 'alice', createdAt: NOW - HOUR, views: 5_000 }, NOW);
    const article = tweetArticle('alice', '9');
    // 详情页的浏览数在时间那一行；流速不跟过去，仍在右上角
    article.insertAdjacentHTML(
      'beforeend',
      `<div class="meta"><a href="/alice/status/9/analytics">6,456 Views</a></div>`,
    );
    decorations.decorate(article, { postId: '9', author: { handle: 'alice' } });
    expect(article.querySelector('.top-right > .fs-velocity')).not.toBeNull();
    expect(article.querySelector('.meta .fs-velocity')).toBeNull();
    decorations.decorate(article, { postId: '9', author: { handle: 'alice' } });
    expect(article.querySelectorAll('.fs-velocity')).toHaveLength(1);
  });

  it('gives each tier its own icon and swaps it when the tier changes', () => {
    const { store, decorations } = setup();
    store.recordAuthor({ handle: 'alice', followers: 500 });
    const article = tweetArticle('alice', '1');
    decorations.decorate(article, { postId: '1', author: { handle: 'alice' } });
    expect(article.querySelector('.fs-tier svg')?.getAttribute('data-fs-icon')).toBe('sparkle');
    store.recordAuthor({ handle: 'alice', followers: 2_000_000 });
    decorations.decorate(article, { postId: '1', author: { handle: 'alice' } });
    expect(article.querySelectorAll('.fs-tier svg')).toHaveLength(1);
    expect(article.querySelector('.fs-tier svg')?.getAttribute('data-fs-icon')).toBe('crown');
    expect(article.querySelector('.fs-tier')?.getAttribute('data-fs-tier-level')).toBe('9');
  });

  it('buckets tweet widths for the narrow-screen styles', async () => {
    const { sizeBucket } = await import('./decorations');
    expect(sizeBucket(598)).toBe('wide');
    expect(sizeBucket(500)).toBe('mid');
    expect(sizeBucket(450)).toBe('narrow');
  });

  it('falls back to the action bar when there is no caret button', () => {
    const { store, decorations } = setup();
    store.recordTweet({ postId: '1', handle: 'alice', createdAt: NOW - HOUR, views: 5_000 }, NOW);
    const article = tweetArticle('alice', '1', { caret: false });
    decorations.decorate(article, { postId: '1', author: { handle: 'alice' } });
    const pill = article.querySelector('[role="group"] > .fs-velocity');
    expect(pill?.getAttribute('data-fs-level')).toBe('hot');
    expect(pill?.querySelector('.fs-v-rate')?.textContent).toMatch(/K\/h$/);
  });

  it('is idempotent and follows node recycling', () => {
    const { store, decorations } = setup();
    store.recordTweet({ postId: '1', handle: 'alice', createdAt: NOW - HOUR, views: 5_000 }, NOW);
    const article = tweetArticle('alice', '1');
    decorations.decorate(article, { postId: '1', author: { handle: 'alice' } });
    decorations.decorate(article, { postId: '1', author: { handle: 'alice' } });
    expect(article.querySelectorAll('.fs-velocity')).toHaveLength(1);

    // X 复用节点显示一条没有指标的推文：装饰撤掉，而不是留着上一条的数字
    decorations.decorate(article, { postId: '2', author: { handle: 'bob' } });
    expect(article.querySelector('.fs-velocity')).toBeNull();
    expect(article.querySelector('.fs-tier')).toBeNull();
  });

  it('shows modest velocity and hides only below the display threshold', () => {
    const { store, decorations } = setup();
    store.recordTweet(
      { postId: '1', handle: 'alice', createdAt: NOW - 10 * HOUR, views: 500 },
      NOW,
    );
    store.recordTweet({ postId: '2', handle: 'bob', createdAt: NOW - 50 * HOUR, views: 100 }, NOW);
    const a = tweetArticle('alice', '1');
    const b = tweetArticle('bob', '2');
    decorations.decorate(a, { postId: '1', author: { handle: 'alice' } });
    decorations.decorate(b, { postId: '2', author: { handle: 'bob' } });
    // 10 小时、500 浏览：此刻约 27/h，绿色趋势图标
    expect(a.querySelector('.fs-v-rate')?.textContent).toMatch(/^\d+\/h$/);
    expect(a.querySelector('.fs-velocity svg')?.getAttribute('data-fs-icon')).toBe('trending');
    expect(b.querySelector('.fs-velocity')).toBeNull();
  });

  it('clears everything when disabled and restores on enable', () => {
    const { store, decorations } = setup();
    store.recordAuthor({ handle: 'alice', followers: 50 });
    store.recordTweet({ postId: '1', handle: 'alice', createdAt: NOW - HOUR, views: 5_000 }, NOW);
    tweetArticle('alice', '1');
    decorations.refreshAll();
    expect(document.querySelectorAll('.fs-velocity, .fs-tier')).toHaveLength(2);

    decorations.setEnabled(false);
    expect(document.querySelectorAll('.fs-velocity, .fs-tier')).toHaveLength(0);
    decorations.refreshAll();
    expect(document.querySelectorAll('.fs-velocity, .fs-tier')).toHaveLength(0);

    decorations.setEnabled(true);
    expect(document.querySelectorAll('.fs-velocity, .fs-tier')).toHaveLength(2);
  });

  it('shows the profile multiple on the owner’s posts but not on their replies', () => {
    const store = createTweetStatsStore();
    const decorations = createInsightDecorations({
      store,
      getLanguage: () => 'zh',
      now: () => NOW,
      profileBaseline: () => ({
        handle: 'alice',
        baseline: { medianViews: 10_000, medianLikes: 100, sample: 12 },
        sample: 12,
      }),
    });
    const old = NOW - 48 * HOUR;
    store.recordTweet(
      { postId: '1', handle: 'alice', createdAt: old, views: 34_000, kind: 'original' },
      NOW,
    );
    store.recordTweet(
      { postId: '2', handle: 'alice', createdAt: old, views: 300, kind: 'reply' },
      NOW,
    );
    store.recordTweet(
      { postId: '3', handle: 'alice', createdAt: old, views: 400, kind: 'quote' },
      NOW,
    );
    store.recordTweet(
      { postId: '4', handle: 'alice', createdAt: old, views: 16_000, kind: 'original' },
      NOW,
    );
    const post = tweetArticle('alice', '1');
    const reply = tweetArticle('alice', '2');
    const quiet = tweetArticle('alice', '3');
    const slight = tweetArticle('alice', '4');
    decorations.decorate(post, { postId: '1', author: { handle: 'alice' } });
    decorations.decorate(reply, { postId: '2', author: { handle: 'alice' } });
    decorations.decorate(quiet, { postId: '3', author: { handle: 'alice' } });
    decorations.decorate(slight, { postId: '4', author: { handle: 'alice' } });

    expect(post.querySelector('.fs-multiple')?.textContent).toBe('3.4×');
    expect(reply.querySelector('.fs-multiple')).toBeNull();
    // 低于门槛的倍数不占地方：正常和扑街都只留流速
    expect(quiet.querySelector('.fs-multiple')).toBeNull();
    expect(slight.querySelector('.fs-multiple')?.textContent).toBe('1.6×');
  });

  it('does not repeat the tier chip on the owner’s profile page', () => {
    const { store, decorations } = setup();
    store.recordAuthor({ handle: 'alice', followers: 32_000 });
    store.recordTweet({ postId: '1', handle: 'alice', createdAt: NOW - HOUR, views: 5_000 }, NOW);
    const article = tweetArticle('alice', '1');
    history.replaceState(null, '', '/alice');
    decorations.decorate(article, { postId: '1', author: { handle: 'alice' } });
    // 资料卡已经写着粉丝数，帖子行不再重复
    expect(article.querySelector('.fs-tier')).toBeNull();

    history.replaceState(null, '', '/');
    decorations.decorate(article, { postId: '1', author: { handle: 'alice' } });
    expect(article.querySelector('.fs-tier')).not.toBeNull();
  });

  it('writes the multiple once in the hover text', async () => {
    const { multipleHover } = await import('./decorations');
    const profile = {
      handle: 'alice',
      baseline: { medianViews: 10_000, medianLikes: 100, sample: 12 },
      sample: 12,
    };
    expect(multipleHover({ value: 3.4, estimated: false }, profile, 'zh').rows[0]?.[1]).toBe(
      '浏览是 @alice 帖子中位数的 3.4 倍',
    );
    expect(multipleHover({ value: 3.4, estimated: false }, profile, 'en').rows[0]?.[1]).toBe(
      "3.4× @alice's median views",
    );
  });
});

describe('hover content', () => {
  it('keeps the relative multiple in the velocity hovercard', async () => {
    const { velocityHover } = await import('./decorations');
    const store = createTweetStatsStore();
    store.recordTweet(
      { postId: '1', handle: 'alice', createdAt: NOW - 2 * HOUR, views: 5_000 },
      NOW,
    );
    const hover = velocityHover(store.insight('1', NOW)!, 'zh', { value: 1.2, estimated: true });
    expect(hover.rows).toContainEqual(['相对表现', '~1.2×']);
  });

  it('explains velocity in the UI language', async () => {
    const { velocityHover, tierHover } = await import('./decorations');
    const store = createTweetStatsStore();
    store.recordAuthor({ handle: 'alice', followers: 3_000, followingCount: 3_100 });
    store.recordTweet(
      { postId: '1', handle: 'alice', createdAt: NOW - 0.5 * HOUR, views: 150, replies: 2 },
      NOW,
    );
    const zh = velocityHover(store.insight('1', NOW)!, 'zh');
    expect(zh.title).toBe('📈 当前流速');
    expect(zh.rows.map(([label]) => label)).toEqual(
      expect.arrayContaining(['当前流速', '预计 24h 浏览', '浏览', '回复']),
    );
    expect(zh.notes?.[0]).toContain('试水');
    const en = velocityHover(store.insight('1', NOW)!, 'en');
    expect(en.rows[0]?.[0]).toBe('Velocity');

    const tier = tierHover({ followers: 3_000, followingCount: 3_100 }, 2, 'zh', NOW);
    expect(tier.title).toBe('SPROUT · 新芽创作者 · 100–1 千粉');
    expect(tier.notes).toEqual(expect.arrayContaining([expect.stringContaining('互关号')]));
  });
});

describe('hover number format', () => {
  it('uses the popup 万 / K compact style for counts, and 1.2K/h for velocity', async () => {
    const { formatCount, formatVelocity } = await import('./format');
    // 弹窗 formatCount 的写法：中文到 1 万才进位成「万」，英文用 K；流速一律紧凑英文 + /h。
    expect(formatCount(50_000, 'zh')).toBe('5万');
    expect(formatCount(50_000, 'en')).toBe('50K');
    expect(formatCount(12_345, 'zh')).toBe('1.2万');
    expect(formatVelocity(1_234)).toBe('1.2K/h');

    const { velocityHover, tierHover } = await import('./decorations');
    const store = createTweetStatsStore();
    store.recordAuthor({ handle: 'alice', followers: 50_000, followingCount: 1_234 });
    store.recordTweet(
      { postId: '1', handle: 'alice', createdAt: NOW - 2 * HOUR, views: 50_000, likes: 12_345 },
      NOW,
    );
    const insight = store.insight('1', NOW)!;

    const zh = velocityHover(insight, 'zh');
    expect(zh.rows).toContainEqual(['浏览', '5万']);
    expect(zh.rows).toContainEqual(['点赞', '1.2万']);
    // 流速和页面胶囊、弹窗一样写 1.2K/h，不是「每小时 1,234 次浏览」
    const zhVelocity = zh.rows.find(([label]) => label === '当前流速')?.[1];
    expect(zhVelocity).toBe(formatVelocity(insight.velocity!));
    expect(zhVelocity).toMatch(/\/h$/);

    const en = velocityHover(insight, 'en');
    expect(en.rows).toContainEqual(['Views', '50K']);
    expect(en.rows).toContainEqual(['Likes', '12.3K']);

    const tier = tierHover({ followers: 50_000, followingCount: 1_234 }, 6, 'zh', NOW);
    expect(tier.rows).toContainEqual(['粉丝', '5万']);
    expect(tier.rows).toContainEqual(['关注', '1234']);
    expect(tier.rows).toContainEqual(['关注比', '0.02']);
  });
});
