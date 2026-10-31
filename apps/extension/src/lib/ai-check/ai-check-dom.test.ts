// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiCheck } from './ai-check';

function tweet(handle: string, postId: string): string {
  return `<article data-testid="tweet">
    <div data-testid="User-Name"><div><a href="/${handle}">Name</a></div>
      <div><a href="/${handle}">@${handle}</a><a href="/${handle}/status/${postId}">1h</a></div></div>
    <div data-testid="tweetText">text ${postId}</div>
    <div role="group"><button data-testid="like">like</button></div>
  </article>`;
}

function setup(
  path: string,
  html: string,
  lookup: unknown = { remote: null, myVote: null, mine: null },
  stored: Record<string, unknown> = {},
) {
  history.replaceState(null, '', path);
  document.body.innerHTML = html;
  const send = vi.fn(async (msg: unknown) =>
    (msg as { type?: string }).type === 'feedsieve:ai-lookup' ? lookup : null,
  );
  (globalThis as unknown as { browser: unknown }).browser = {
    runtime: { onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
    storage: {
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      local: { get: vi.fn(async () => stored) },
    },
  };
  const ai = createAiCheck({
    getLanguage: () => 'zh',
    getSelfHandle: () => 'me',
    send,
    setInterval: () => 0,
  });
  return { ai, send, tick: () => ai.start() };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('评论区的 AI 图标', () => {
  it('只加在评论区：主帖、楼上祖先帖、主帖作者、自己、grok 都不加', () => {
    const { ai, tick } = setup(
      '/op/status/200',
      [
        tweet('ancestor', '100'),
        tweet('op', '200'),
        tweet('op', '201'),
        tweet('me', '202'),
        tweet('grok', '203'),
        tweet('replier', '204'),
      ].join(''),
    );
    tick();
    const articles = [...document.querySelectorAll('article')];
    const has = articles.map((a) => !!a.querySelector('[data-fs-action="ai"]'));
    expect(has).toEqual([false, false, false, false, false, true]);
    expect(articles[5]!.querySelector('[data-fs-action="ai"] svg')).not.toBeNull();
    ai.stop();
  });
});

describe('主页的「AI 味」Tab', () => {
  const tabs = (h: string) => `<div data-testid="primaryColumn"><nav><div role="tablist">
      <div role="presentation"><a role="tab" aria-selected="true" href="/${h}"><div><span>帖子</span></div></a></div>
      <div role="presentation"><a role="tab" aria-selected="false" href="/${h}/with_replies"><div><span>回复</span></div></a></div>
    </div></nav></div>`;

  it('照原生 Tab 的结构加在末尾；有结论时显示百分比', async () => {
    const { ai, tick } = setup('/Alice', tabs('Alice'), {
      remote: {
        handle: 'alice',
        verdict: 'ai',
        score: 0.93,
        reply_count: 12,
        rhythm: { fast: 0, short: 0, cv: 0.5, median_gap: 600 },
        judged_at: 1,
        expires_at: 2,
        expired: false,
        votes: { ai_count: 2, human_count: 0, listed: false },
      },
      myVote: null,
      mine: null,
    });
    tick();
    const tab = document.querySelector('[data-fs-ai-tab]')!;
    expect(tab.getAttribute('role')).toBe('presentation');
    expect(tab.textContent).toBe('AI 味');
    await vi.waitFor(() => expect(tab.textContent).toBe('AI 味95%'));
    // 有结论：点开直接出报告，不重新检测
    (tab.querySelector('a') as HTMLAnchorElement).click();
    expect(document.querySelector('#fs-ai-panel .fs-ai-level')?.textContent).toBe('AI 感爆棚');
    expect(document.querySelector('#fs-ai-panel')?.textContent).toContain('2 人认为是 AI');
    ai.stop();
    expect(document.querySelector('[data-fs-ai-tab]')).toBeNull();
  });
});

describe('回复详情页与评论区标记', () => {
  it('被打开的那条本身是回复时也有图标；原创主帖和原帖作者的回复没有（以接口数据为准）', async () => {
    const { ai, tick } = setup(
      '/growaiskills/status/300',
      [
        tweet('op', '100'),
        tweet('growaiskills', '300'),
        tweet('op', '301'),
        tweet('carol', '302'),
      ].join(''),
    );
    ai.ingest([
      { postId: '100', handle: 'op', text: '原帖' },
      {
        postId: '300',
        handle: 'growaiskills',
        text: '回复',
        inReplyToId: '100',
        inReplyToHandle: 'op',
      },
      {
        postId: '301',
        handle: 'op',
        text: '作者回',
        inReplyToId: '300',
        inReplyToHandle: 'growaiskills',
      },
      {
        postId: '302',
        handle: 'carol',
        text: '评论',
        inReplyToId: '300',
        inReplyToHandle: 'growaiskills',
      },
    ]);
    tick();
    const has = [...document.querySelectorAll('article')].map(
      (a) => !!a.querySelector('[data-fs-action="ai"]'),
    );
    expect(has).toEqual([false, true, false, true]);
    ai.stop();
  });

  it('社区名单里的号加「AI 味 N%」标签；设置为折叠时整条收起，点「显示」展开', async () => {
    const html = `<div data-testid="cellInnerDiv">${tweet('op', '400')}</div><div data-testid="cellInnerDiv">${tweet('farm', '401')}</div>`;
    const { ai, tick } = setup('/op/status/400', html, undefined, {
      aiListV1: { at: Date.now(), entries: [['farm', 0.92, 1]] },
      aiCheckSettingsV1: { mode: 'fold', scope: 'all' },
    });
    tick();
    await new Promise((r) => setTimeout(r, 0));
    // 名单是异步读的：读到之后的下一次扫描才会标记
    tick();
    const mark = document.querySelector('.fs-ai-mark');
    expect(mark?.textContent).toBe('AI 味 90%');
    const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    expect(cells[1]!.getAttribute('data-fs-ai-fold')).toBe('1');
    expect(cells[0]!.hasAttribute('data-fs-ai-fold')).toBe(false);
    (cells[1]!.querySelector('.fs-ai-foldbar button') as HTMLButtonElement).click();
    expect(cells[1]!.hasAttribute('data-fs-ai-fold')).toBe(false);
    ai.stop();
  });

  it('点评论区图标：已有结论直接出报告，不跳页面', async () => {
    const { ai, tick } = setup(
      '/op/status/500',
      [tweet('op', '500'), tweet('known', '501')].join(''),
      {
        remote: {
          handle: 'known',
          verdict: 'ai',
          score: 0.8,
          reply_count: 10,
          rhythm: null,
          judged_at: 1,
          expires_at: 9e12,
          expired: false,
          public: true,
          votes: { ai_count: 1, human_count: 0, listed: false },
        },
        myVote: 'ai',
        mine: null,
      },
    );
    tick();
    const button = document
      .querySelectorAll('article')[1]!
      .querySelector('[data-fs-action="ai"] button') as HTMLButtonElement;
    button.click();
    await vi.waitFor(() =>
      expect(document.querySelector('#fs-ai-panel .fs-ai-level')).not.toBeNull(),
    );
    expect(document.querySelector('#fs-ai-panel .fs-ai-voted')?.textContent).toBe('是 AI');
    // 下一次扫描（每秒一次）不能把详情页上打开的卡片收掉
    tick();
    expect(document.querySelector('#fs-ai-panel')).not.toBeNull();
    expect(location.pathname).toBe('/op/status/500');
    ai.stop();
  });
});

it('已关注的号：照样有检测图标，但不自动标记', async () => {
  history.replaceState(null, '', '/op/status/600');
  document.body.innerHTML = [tweet('op', '600'), tweet('friend', '601')].join('');
  (globalThis as unknown as { browser: unknown }).browser = {
    runtime: { onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
    storage: {
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      local: {
        get: vi.fn(async () => ({ aiListV1: { at: Date.now(), entries: [['friend', 0.9, 1]] } })),
      },
    },
  };
  const ai = createAiCheck({
    getLanguage: () => 'zh',
    getSelfHandle: () => 'me',
    isProtected: (h) => h === 'friend',
    send: vi.fn(async () => null),
    setInterval: () => 0,
  });
  ai.start();
  await new Promise((r) => setTimeout(r, 0));
  ai.start();
  const reply = document.querySelectorAll('article')[1]!;
  expect(reply.querySelector('[data-fs-action="ai"]')).not.toBeNull();
  expect(reply.querySelector('.fs-ai-mark')).toBeNull();
  ai.stop();
});
