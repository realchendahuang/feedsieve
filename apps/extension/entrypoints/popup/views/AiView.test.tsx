// @vitest-environment happy-dom
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountFromUrl, AiView } from './AiView';
import { AiDisplaySettings } from './settings/AiDisplaySettings';
import { openOfficialPage } from '../../../src/lib/platform/site-links';

// 「查看全部 AI 号」只验证跳转目标，不真开标签页
vi.mock('../../../src/lib/platform/site-links', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/platform/site-links')>();
  return { ...actual, openOfficialPage: vi.fn(async () => undefined) };
});

const tabUrl = 'https://x.com/Alice';
let lookup: unknown;
let records: unknown[];
let sessionStored: Record<string, unknown>;
let localStored: Record<string, unknown>;
const mounted: Array<{ unmount: () => void }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  lookup = { remote: null, myVote: null, mine: null };
  records = [];
  sessionStored = {};
  localStored = {};
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
      local: {
        // 持久化拉黑队列（persistentBlockQueueV1）等按 key 读取
        get: vi.fn(async (key: string) => ({ [key]: localStored[key] })),
        set: vi.fn(async (items: Record<string, unknown>) => Object.assign(localStored, items)),
      },
    },
  };
});

afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount());
  document.body.innerHTML = '';
});

async function render(
  sendToXPage: Parameters<typeof AiView>[0]['sendToXPage'] = vi.fn(async () => ({ ok: true })),
  options: {
    aiEligible?: Array<{ handle: string; score: number | null }>;
    aiListCount?: number;
    notify?: (message: string | null) => void;
  } = {},
) {
  const host = document.createElement('div');
  host.className = 'popup-content';
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);
  mounted.push(root);
  await act(async () => {
    root.render(
      <AiView
        language="zh"
        notify={options.notify ?? (() => undefined)}
        sendToXPage={sendToXPage}
        onOpenSettings={vi.fn()}
        aiEligible={options.aiEligible ?? []}
        aiListCount={options.aiListCount ?? 1}
      />,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return { host, root, sendToXPage };
}

/** 按键名/文案找「社区伪人名单」区块里的按钮（官方跳转图标靠 aria-label 区分） */
function aiListSection(host: HTMLElement): HTMLElement {
  const section = host.querySelector<HTMLElement>('section[aria-label="社区伪人名单"]');
  if (!section) throw new Error('community ai list section not found');
  return section;
}

function aiBlockButton(host: HTMLElement): HTMLButtonElement {
  const button = [...aiListSection(host).querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => !candidate.getAttribute('aria-label')?.startsWith('查看全部'),
  );
  if (!button) throw new Error('ai block button not found');
  return button;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function aiQueueFixture(source: 'ai-batch' | 'community-batch'): Record<string, unknown> {
  return {
    id: 'queue-1',
    source,
    status: 'running',
    createdAt: 1,
    updatedAt: 2,
    tasks: [
      { handle: 'aislop_one', category: 'ai_slop', status: 'success' },
      { handle: 'aislop_two', category: 'ai_slop', status: 'failed', failureCode: 'no-id' },
      { handle: 'aislop_three', category: 'ai_slop', status: 'pending' },
    ],
  };
}

const AI_ELIGIBLE = [
  { handle: 'aislop_one', score: 0.91 },
  { handle: 'aislop_two', score: null },
];

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
    expect(host.textContent).toContain('3 人认为是 AI · 1 人认为是真人 · 已进社区伪人名单');
    expect(host.querySelector('.ai-votes .is-selected')?.textContent).toBe('是 AI');
    // 「我测过的」默认折叠：标题行显示数量，展开后才渲染记录行
    const historyToggle = host.querySelector<HTMLButtonElement>('.block-head-toggle');
    expect(historyToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(historyToggle?.textContent).toContain('1');
    expect(host.querySelector('.ai-row')).toBeNull();
    await act(async () => historyToggle?.click());
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

  it('显示设置收进齿轮页：AI 味页不再有识别范围，开关改完写本机', async () => {
    const { host } = await render();
    expect(host.textContent).not.toContain('识别范围');

    const settingsHost = document.createElement('div');
    settingsHost.className = 'popup-content';
    document.body.appendChild(settingsHost);
    const settingsRoot = ReactDOM.createRoot(settingsHost);
    mounted.push(settingsRoot);
    await act(async () => {
      settingsRoot.render(<AiDisplaySettings language="zh" />);
      await new Promise((r) => setTimeout(r, 0));
    });

    const input = settingsHost.querySelector<HTMLInputElement>(
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

describe('AiView › 社区伪人名单', () => {
  it('显示名单总数与可屏蔽数，按钮可用', async () => {
    const { host } = await render(undefined, {
      aiEligible: AI_ELIGIBLE,
      aiListCount: 128,
    });
    const section = aiListSection(host);
    expect(section.textContent).toContain('社区伪人名单');
    expect(section.textContent).toContain('已收录 128 个 · 可屏蔽 2 个');
    expect(aiBlockButton(host).textContent).toBe('一键屏蔽');
    expect(aiBlockButton(host).disabled).toBe(false);
  });

  it('没有可屏蔽账号：按钮禁用并显示暂无可屏蔽账号', async () => {
    const { host } = await render(undefined, { aiEligible: [], aiListCount: 128 });
    const button = aiBlockButton(host);
    expect(button.textContent).toBe('暂无可屏蔽账号');
    expect(button.disabled).toBe(true);
  });

  it('点「查看全部 AI 号」打开官网 AI 号广场', async () => {
    const { host } = await render(undefined, {
      aiEligible: AI_ELIGIBLE,
      aiListCount: 128,
    });
    const link = aiListSection(host).querySelector<HTMLButtonElement>(
      'button[aria-label="查看全部 AI 号"]',
    );
    expect(link).not.toBeNull();
    await act(async () => link!.click());
    expect(openOfficialPage).toHaveBeenCalledWith('https://feedsieve.win/ai');
  });

  it('一键屏蔽需二次确认：首点只进入确认态，再点才发出 ai-block-start', async () => {
    const notify = vi.fn();
    const sendToXPage = vi.fn(async () => ({
      status: 'started',
      id: 'queue-1',
      count: AI_ELIGIBLE.length,
    }));
    const { host } = await render(sendToXPage, {
      aiEligible: AI_ELIGIBLE,
      aiListCount: 128,
      notify,
    });

    await act(async () => aiBlockButton(host).click());
    await flush();
    // 第一次点击：不发送消息，文案变成确认态
    expect(sendToXPage).not.toHaveBeenCalled();
    expect(aiBlockButton(host).textContent).toBe('再点一次：屏蔽 2 个');

    await act(async () => aiBlockButton(host).click());
    await flush();
    expect(sendToXPage).toHaveBeenCalledTimes(1);
    expect(sendToXPage).toHaveBeenCalledWith({
      type: 'feedsieve:ai-block-start',
      items: [
        { handle: 'aislop_one', category: 'ai_slop' },
        { handle: 'aislop_two', category: 'ai_slop' },
      ],
    });
    expect(notify).toHaveBeenCalledWith('已加入拉黑队列（2 个）');
  });

  it('队列进度只显示 source=ai-batch 的队列', async () => {
    // 社区黑名单批量队列正在跑：伪人页不应该把它的进度画到自己头上
    localStored.persistentBlockQueueV1 = aiQueueFixture('community-batch');
    const community = await render(undefined, {
      aiEligible: AI_ELIGIBLE,
      aiListCount: 128,
    });
    await flush();
    expect(community.host.querySelector('.queue-panel')).toBeNull();

    // 同样是 running 队列，换成 ai-batch 才显示进度（3 条：1 成功 1 失败 1 待执行）
    localStored.persistentBlockQueueV1 = aiQueueFixture('ai-batch');
    const ai = await render(undefined, { aiEligible: AI_ELIGIBLE, aiListCount: 128 });
    await flush();
    const panel = ai.host.querySelector('.queue-panel');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('进度 2 / 3');
  });
});
