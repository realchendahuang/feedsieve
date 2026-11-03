// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInsightDecorations } from './decorations';
import { createProfileInsight, PROFILE_LINE_CLASS, profileLineParts } from './profile-insight';
import { createTweetStatsStore } from './tweet-stats';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 30, 12);

const SUMMARY = {
  handle: 'alice',
  followers: 32_000,
  followingCount: 1_600,
  tier: 3,
  ratio: 0.05,
  baseline: { medianViews: 18_000, medianLikes: 120, sample: 40 },
  outlierRate: 0.12,
  postCount: 186,
};

function profileHeader(): void {
  document.body.innerHTML = `
    <div class="header">
      <div data-testid="UserName">Alice @alice</div>
      <div data-testid="UserDescription">bio</div>
      <div data-testid="UserProfileHeader_Items">Joined 2020</div>
      <div class="follow-counts">1,600 Following</div>
    </div>`;
}

beforeEach(() => {
  vi.useFakeTimers();
  profileHeader();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function setup(path = '/alice', summary: unknown = SUMMARY) {
  let currentPath = path;
  const request = vi.fn(async () => summary);
  const openPanel = vi.fn();
  const onBaselineChange = vi.fn();
  const insight = createProfileInsight({
    getLanguage: () => 'zh',
    isEnabled: () => true,
    request,
    openPanel,
    onBaselineChange,
    getPath: () => currentPath,
  });
  return {
    insight,
    request,
    openPanel,
    onBaselineChange,
    go: (next: string) => {
      currentPath = next;
    },
  };
}

describe('profile line', () => {
  it('summarises the creator under the profile header and opens the side panel on click', async () => {
    const { insight, request, openPanel, onBaselineChange } = setup();
    insight.start();
    await vi.advanceTimersByTimeAsync(1_600);
    expect(request).toHaveBeenCalledWith('alice');
    const line = document.querySelector<HTMLButtonElement>(`.${PROFILE_LINE_CLASS}`)!;
    expect(line.previousElementSibling?.getAttribute('data-testid')).toBe(
      'UserProfileHeader_Items',
    );
    expect([...line.children].map((node) => node.textContent)).toEqual([
      '新锐',
      '3.2万 粉丝',
      '关注比 0.05',
      '中位浏览 1.8万',
      '爆款率 12%',
      '已收 186 条',
    ]);
    expect(onBaselineChange).toHaveBeenCalled();
    expect(insight.baseline()).toEqual({ handle: 'alice', baseline: SUMMARY.baseline, sample: 40 });
    line.click();
    expect(openPanel).toHaveBeenCalledTimes(1);
    insight.stop();
  });

  it('retries quickly while the post library of a first-visited profile is not ready', async () => {
    let ready = false;
    const request = vi.fn(async () => (ready ? SUMMARY : null));
    const insight = createProfileInsight({
      getLanguage: () => 'zh',
      isEnabled: () => true,
      request,
      openPanel: vi.fn(),
      onBaselineChange: vi.fn(),
      getPath: () => '/alice',
    });
    insight.start();
    await vi.advanceTimersByTimeAsync(1_600);
    expect(document.querySelector(`.${PROFILE_LINE_CLASS}`)).toBeNull();
    ready = true;
    await vi.advanceTimersByTimeAsync(1_100);
    expect(document.querySelector(`.${PROFILE_LINE_CLASS}`)).not.toBeNull();
    // 取到之后回到 15 秒一次
    const calls = request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(request.mock.calls.length).toBe(calls);
    insight.stop();
  });

  it('puts the line back when X re-renders the header, and removes it off the profile', async () => {
    const { insight, go } = setup();
    insight.start();
    await vi.advanceTimersByTimeAsync(1_600);
    profileHeader();
    expect(document.querySelector(`.${PROFILE_LINE_CLASS}`)).toBeNull();
    // 页面巡检（page-ticker）每秒调一次 tick：X 重渲染资料卡后这一行要补回来
    insight.tick();
    expect(document.querySelector(`.${PROFILE_LINE_CLASS}`)).not.toBeNull();
    // 点进帖子详情：不是主页了
    go('/alice/status/123');
    insight.tick();
    expect(document.querySelector(`.${PROFILE_LINE_CLASS}`)).toBeNull();
    expect(insight.baseline()).toBeNull();
    insight.stop();
  });

  it('shows nothing while the popularity line is off', async () => {
    let enabled = false;
    const insight = createProfileInsight({
      getLanguage: () => 'zh',
      isEnabled: () => enabled,
      request: vi.fn(async () => SUMMARY),
      openPanel: vi.fn(),
      onBaselineChange: vi.fn(),
      getPath: () => '/alice',
    });
    insight.start();
    await vi.advanceTimersByTimeAsync(1_600);
    expect(document.querySelector(`.${PROFILE_LINE_CLASS}`)).toBeNull();
    // 打开开关：下一次巡检补上
    enabled = true;
    insight.tick();
    expect(document.querySelector(`.${PROFILE_LINE_CLASS}`)).not.toBeNull();
    // 关掉：下一次巡检移除
    enabled = false;
    insight.tick();
    expect(document.querySelector(`.${PROFILE_LINE_CLASS}`)).toBeNull();
    insight.stop();
  });

  it('shows only what it knows while the sample is small', () => {
    expect(
      profileLineParts(
        { ...SUMMARY, baseline: null, outlierRate: null, ratio: null, postCount: 6 },
        'en',
      ),
    ).toEqual(['Rising', '32K followers', '6 posts collected']);
  });
});

describe('multiple badge', () => {
  function tweetArticle(handle: string, postId: string): HTMLElement {
    const article = document.createElement('article');
    article.setAttribute('data-testid', 'tweet');
    article.innerHTML = `
      <div data-testid="User-Name"><div><a href="/${handle}">Name</a></div><div><a href="/${handle}">@${handle}</a><a href="/${handle}/status/${postId}">1h</a></div></div>
      <div class="top-right"><div class="grok"><button>grok</button></div><div><div><button data-testid="caret">…</button></div></div></div>
      <div role="group"><button data-testid="like">like</button></div>`;
    document.body.appendChild(article);
    return article;
  }

  it('marks the owner’s posts with their multiple of the median, before the velocity pill', () => {
    const store = createTweetStatsStore();
    store.recordTweet(
      { postId: '1', handle: 'alice', createdAt: NOW - 3 * DAY, views: 72_000 },
      NOW,
    );
    store.recordTweet(
      { postId: '2', handle: 'alice', createdAt: NOW - 3 * DAY, views: 36_000 },
      NOW,
    );
    store.recordTweet({ postId: '3', handle: 'bob', createdAt: NOW - 3 * DAY, views: 90_000 }, NOW);
    store.recordTweet(
      { postId: '4', handle: 'alice', createdAt: NOW - 60 * 60_000, views: 30_000 },
      NOW,
    );
    store.recordTweet(
      { postId: '5', handle: 'alice', createdAt: NOW - 3 * DAY, views: 9_000 },
      NOW,
    );
    let profile: { handle: string; baseline: typeof SUMMARY.baseline; sample: number } | null = {
      handle: 'alice',
      baseline: SUMMARY.baseline,
      sample: 40,
    };
    const decorations = createInsightDecorations({
      store,
      getLanguage: () => 'zh',
      now: () => NOW,
      profileBaseline: () => profile,
    });
    const articles = ['1', '2', '3', '4', '5'].map((id) =>
      tweetArticle(id === '3' ? 'bob' : 'alice', id),
    );
    decorations.refreshAll();
    const badge = (article: HTMLElement) => article.querySelector<HTMLElement>('.fs-multiple');
    expect(badge(articles[0]!)?.textContent).toBe('4.0×');
    expect(badge(articles[0]!)?.getAttribute('data-fs-level')).toBe('outlier');
    expect(badge(articles[1]!)?.textContent).toBe('2.0×');
    expect(badge(articles[1]!)?.getAttribute('data-fs-level')).toBe('normal');
    // 别人的帖子不标
    expect(badge(articles[2]!)).toBeNull();
    // 低于门槛（0.5×）不占地方
    expect(badge(articles[4]!)).toBeNull();
    // 刚发的帖子：按预计 24 小时浏览估算
    expect(badge(articles[3]!)?.textContent?.startsWith('~')).toBe(true);
    const velocity = articles[3]!.querySelector('.fs-velocity');
    expect(velocity && badge(articles[3]!)?.nextElementSibling).toBe(velocity);
    // 重复刷新不改 DOM 结构
    const before = badge(articles[0]!);
    decorations.refreshAll();
    expect(badge(articles[0]!)).toBe(before);
    // 离开主页：倍数撤掉
    profile = null;
    decorations.refreshAll();
    expect(document.querySelector('.fs-multiple')).toBeNull();
  });
});
