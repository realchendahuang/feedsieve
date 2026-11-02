// @vitest-environment happy-dom
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountFromUrl, AiView } from './AiView';

const tabUrl = 'https://x.com/Alice';
let lookup: unknown;
let records: unknown[];
let sessionStored: Record<string, unknown>;
const mounted: Array<{ unmount: () => void }> = [];

beforeEach(() => {
  lookup = { remote: null, myVote: null, mine: null };
  records = [];
  sessionStored = {};
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { browser: unknown }).browser = {
    tabs: {
      query: vi.fn(async () => [{ id: 1, url: tabUrl, active: true }]),
      update: vi.fn(async () => undefined),
      create: vi.fn(async () => undefined),
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: {
      sendMessage: vi.fn(async (msg: { type: string }) =>
        msg.type === 'feedsieve:ai-lookup'
          ? lookup
          : msg.type === 'feedsieve:ai-checks'
            ? records
            : null,
      ),
    },
    storage: {
      session: {
        get: vi.fn(async () => ({ ...sessionStored })),
        set: vi.fn(async (items: Record<string, unknown>) => Object.assign(sessionStored, items)),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
    },
  };
});

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  document.body.innerHTML = '';
});

async function render(sendToXPage = vi.fn(async () => ({ ok: true }))) {
  const host = document.createElement('div');
  host.className = 'popup-content';
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);
  mounted.push(root);
  await act(async () => {
    root.render(
      <AiView
        language="zh"
        notify={() => undefined}
        sendToXPage={sendToXPage}
        onOpenSettings={vi.fn()}
      />,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return { host, root, sendToXPage };
}

describe('AiView', () => {
  it('从主页、帖子详情取当前账号', () => {
    expect(accountFromUrl('https://x.com/Alice/with_replies')).toBe('alice');
    expect(accountFromUrl('https://x.com/bob/status/123')).toBe('bob');
    expect(accountFromUrl('https://x.com/home')).toBeNull();
    expect(accountFromUrl('https://example.com/alice')).toBeNull();
  });

  it('有结论：显示百分比、档位、票数；我测过的列表', async () => {
    lookup = {
      remote: {
        handle: 'alice',
        verdict: 'ai',
        score: 0.92,
        reply_count: 14,
        rhythm: { fast: 0.1, short: 0, cv: 0.5, median_gap: 300 },
        judged_at: 1,
        expires_at: 2,
        expired: false,
        votes: { ai_count: 3, human_count: 1, listed: true },
      },
      myVote: 'ai',
    };
    records = [{ handle: 'alice', verdict: 'ai', score: 0.92, judgedAt: 1, vote: 'ai' }];
    const { host } = await render();
    expect(host.querySelector('.ai-pct')?.textContent).toBe('90%');
    expect(host.querySelector('.ai-level')?.textContent).toBe('AI 感爆棚');
    expect(host.textContent).toContain('3 人认为是 AI · 1 人认为是真人 · 已进社区 AI 号名单');
    expect(host.querySelector('.ai-votes .is-selected')?.textContent).toBe('是 AI');
    expect(host.querySelector('.ai-row')?.textContent).toContain('@alice');
  });

  it('社区票数决出真人：显示社区结论，不再出现复核中', async () => {
    lookup = {
      remote: {
        handle: 'alice',
        verdict: 'human',
        score: null,
        reply_count: 0,
        rhythm: null,
        judged_at: 1,
        expires_at: 2,
        expired: false,
        public: true,
        pending: false,
        contested: false,
        votes: { ai_count: 1, human_count: 4, listed: false },
      },
      myVote: 'human',
    };
    const { host } = await render();
    expect(host.textContent).toContain('社区结论：真人（AI 1 · 真人 4）');
    expect(host.textContent).not.toContain('复核中');
    expect(host.querySelector('.ai-votes .is-selected')?.textContent).toBe('是真人');
  });

  it('社区票数持平：显示社区争议中，并允许继续投票', async () => {
    lookup = {
      remote: {
        handle: 'alice',
        verdict: null,
        score: null,
        reply_count: 0,
        rhythm: null,
        judged_at: 1,
        expires_at: 2,
        expired: false,
        public: false,
        pending: false,
        contested: true,
        votes: { ai_count: 3, human_count: 3, listed: false },
      },
      myVote: null,
    };
    const { host } = await render();
    expect(host.textContent).toContain('社区争议中：AI 3 · 真人 3');
    expect(host.querySelectorAll('.ai-votes button')).toHaveLength(2);
  });

  it('服务端没公开时显示自己测的结果，并标明只有本人能看到', async () => {
    lookup = {
      remote: {
        handle: 'alice',
        verdict: null,
        score: null,
        reply_count: 0,
        rhythm: null,
        judged_at: 1,
        expires_at: 2,
        expired: false,
        public: false,
        pending: true,
        votes: { ai_count: 0, human_count: 0, listed: false },
      },
      myVote: null,
      mine: {
        handle: 'alice',
        verdict: 'suspect',
        score: 0.55,
        judgedAt: 1,
        replyCount: 10,
        confirmed: false,
      },
    };
    const { host } = await render();
    expect(host.querySelector('.ai-pct')?.textContent).toBe('55%');
    expect(host.textContent).toContain('只有你能看到');
  });

  it('没测过：开始检测发给 X 页面', async () => {
    const { host, sendToXPage } = await render();
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === '开始检测')!;
    await act(async () => button.click());
    expect(sendToXPage).toHaveBeenCalledWith({
      type: 'feedsieve:ai-start',
      handle: 'alice',
      force: false,
    });
  });

  it('已关注账号打标是独立开关，默认关', async () => {
    const { host } = await render();
    const input = host.querySelector<HTMLInputElement>(
      'input[role="switch"][aria-label="标记已关注账号"]',
    )!;
    expect(input.checked).toBe(false);
    await act(async () => {
      input.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(input.checked).toBe(true);
    const browserMock = (
      globalThis as unknown as {
        browser: { storage: { local: { set: ReturnType<typeof vi.fn> } } };
      }
    ).browser;
    expect(browserMock.storage.local.set).toHaveBeenCalledWith({
      aiCheckSettingsV1: { mode: 'mark', scope: 'all', markFollowing: true },
    });
  });

  it('切走再回来回到记录列表原来的位置', async () => {
    records = Array.from({ length: 40 }, (_, i) => ({
      handle: `user${i}`,
      verdict: 'ai',
      score: 0.9,
      judgedAt: i,
      vote: 'ai',
    }));
    const first = await render();
    first.host.scrollTop = 640;
    await act(async () => {
      first.host.dispatchEvent(new Event('scroll'));
    });
    // 立刻切走：此时 DOM 已经换掉、scrollTop 归零，保存要靠滚动时记下的值
    await act(async () => first.root.unmount());
    first.host.remove();

    const second = await render();
    expect(second.host.scrollTop).toBe(640);
  });
});
