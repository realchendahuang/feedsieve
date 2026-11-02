// @vitest-environment happy-dom
// 清理清单两按钮回归：误标=加白名单且整行即离清单；移除=整行移除不碰名单。
// 兜底旧坑：白名单删除曾走内容脚本储库回调链路，条目残留直到全量重置。
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CleanView from './CleanView';
import type { PageMarkedItem } from './shared';

let storageSet: ReturnType<typeof vi.fn>;
let sessionStored: Record<string, unknown>;
const mountedRoots: Array<{ unmount: () => void }> = [];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  for (const root of mountedRoots.splice(0)) root.unmount();
  document.body.replaceChildren();
  storageSet = vi.fn().mockResolvedValue(undefined);
  sessionStored = {};
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  vi.stubGlobal('browser', {
    runtime: {
      getManifest: () => ({ version: '0.9.4' }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      session: {
        get: vi.fn(async () => ({ ...sessionStored })),
        set: vi.fn(async (items: Record<string, unknown>) => Object.assign(sessionStored, items)),
      },
      local: {
        get: vi.fn().mockResolvedValue({ uiLanguage: 'zh' }),
        set: storageSet,
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
});

function renderCleanView(
  pageMarked: PageMarkedItem[],
  refreshPageMarked = vi.fn().mockResolvedValue(undefined),
  sendToXPage = vi.fn().mockResolvedValue({}),
): HTMLElement {
  const rootEl = document.createElement('div');
  document.body.append(rootEl);
  const root = ReactDOM.createRoot(rootEl);
  mountedRoots.push(root);
  act(() => {
    root.render(
      React.createElement(CleanView, {
        language: 'zh' as const,
        notify: vi.fn(),
        sendToXPage,
        pageMarked,
        refreshPageMarked,
        pauseDestructive: false,
        killSwitchActive: false,
        communityEligible: [],
        communityLoading: false,
      }),
    );
  });
  return rootEl;
}

function buttonInRow(row: HTMLElement, label: string): HTMLButtonElement {
  const button = [...row.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`button not found in row: ${label}`);
  return button;
}

function removeButton(row: HTMLElement): HTMLButtonElement {
  const button = row.querySelector<HTMLButtonElement>('button[aria-label^="移除"]');
  if (!button) throw new Error('remove button not found');
  return button;
}

function rowOf(rootEl: HTMLElement, handle: string): HTMLElement {
  const row = [...rootEl.querySelectorAll<HTMLElement>('.marked-list li')].find((el) =>
    el.textContent?.includes(handle),
  );
  if (!row) throw new Error(`row not found: ${handle}`);
  return row;
}

function hasRow(rootEl: HTMLElement, handle: string): boolean {
  return [...rootEl.querySelectorAll('.marked-handle')].some((el) =>
    el.textContent?.includes(handle),
  );
}

const ITEMS: PageMarkedItem[] = [
  { handle: 'misfavored', category: 'bot_spam', reason: '关键词命中', snippet: '推文正文' },
  { handle: 'spampeye', category: 'bot_spam', reason: '关键词命中', snippet: '推文正文' },
];

describe('CleanView 误标', () => {
  it('写入个人白名单并触发清单刷新', async () => {
    const refreshPageMarked = vi.fn().mockResolvedValue(undefined);
    const rootEl = renderCleanView(ITEMS, refreshPageMarked);
    expect(hasRow(rootEl, 'misfavored')).toBe(true);
    await act(async () => buttonInRow(rowOf(rootEl, 'misfavored'), '误标').click());
    expect(storageSet).toHaveBeenCalledWith(
      expect.objectContaining({
        allowlist: expect.arrayContaining([expect.objectContaining({ handle: 'misfavored' })]),
      }),
    );
    const patch = storageSet.mock.calls.find(([value]) => value.allowlist)?.[0];
    expect(
      Object.entries(patch).find(([key]) => key.startsWith('trainingSamplePending:'))?.[1],
    ).toMatchObject({ action: 'false-positive', handle: 'misfavored', text: '推文正文' });
    expect(refreshPageMarked).toHaveBeenCalled();
  });

  it('误标后整行立即离开清理列表', async () => {
    const rootEl = renderCleanView(ITEMS);
    await act(async () => {
      buttonInRow(rowOf(rootEl, 'misfavored'), '误标').click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(hasRow(rootEl, 'misfavored')).toBe(false);
    expect(hasRow(rootEl, 'spampeye')).toBe(true);
  });

  it('剩全部移除后列表归零且批量拉黑按钮禁用', async () => {
    const rootEl = renderCleanView(ITEMS);
    await act(async () => {
      buttonInRow(rowOf(rootEl, 'misfavored'), '误标').click();
      await new Promise((r) => setTimeout(r, 0));
      removeButton(rowOf(rootEl, 'spampeye')).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(rootEl.textContent).toContain('已全部移除');
    expect(rootEl.querySelector<HTMLButtonElement>('.primary-button')).toBeNull();
  });
});

describe('CleanView 移除', () => {
  it('整行移除、不写白名单、不触发刷新', async () => {
    const refreshPageMarked = vi.fn().mockResolvedValue(undefined);
    const rootEl = renderCleanView(ITEMS, refreshPageMarked);
    expect(hasRow(rootEl, 'spampeye')).toBe(true);
    await act(async () => removeButton(rowOf(rootEl, 'spampeye')).click());
    expect(hasRow(rootEl, 'spampeye')).toBe(false);
    expect(refreshPageMarked).not.toHaveBeenCalled();
    expect(storageSet).not.toHaveBeenCalledWith(
      expect.objectContaining({ allowlist: expect.anything() }),
    );
  });

  it('全部移除后批量拉黑按钮禁用', async () => {
    const rootEl = renderCleanView(ITEMS, vi.fn().mockResolvedValue(undefined));
    await act(async () => {
      removeButton(rowOf(rootEl, 'misfavored')).click();
      await new Promise((r) => setTimeout(r, 0));
      removeButton(rowOf(rootEl, 'spampeye')).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(rootEl.querySelector<HTMLButtonElement>('.primary-button')).toBeNull();
  });

  it('移除后批量拉黑只发剩下列表中的账号', async () => {
    const sendToXPage = vi.fn().mockResolvedValue({ status: 'started', count: 1 });
    const rootEl = renderCleanView(ITEMS, vi.fn().mockResolvedValue(undefined), sendToXPage);
    await act(async () => removeButton(rowOf(rootEl, 'spampeye')).click());
    const primary = rootEl.querySelector<HTMLButtonElement>('.primary-button');
    await act(async () => primary?.click());
    const msg = sendToXPage.mock.calls
      .map((call) => call[0])
      .find(
        (m) =>
          typeof m === 'object' &&
          m !== null &&
          (m as { type?: string }).type === 'feedsieve:run-page-block',
      ) as { handles?: string[] } | undefined;
    expect(msg?.handles).toEqual(['misfavored']);
  });
});

describe('CleanView 滚动位置', () => {
  it('切走再回来回到列表原来的位置', async () => {
    const many: PageMarkedItem[] = Array.from({ length: 40 }, (_, i) => ({
      handle: `spam_${i}`,
      category: 'bot_spam',
      reason: '关键词命中',
      snippet: '推文正文',
    }));
    async function mount(): Promise<{ host: HTMLDivElement; root: ReactDOM.Root }> {
      const host = document.createElement('div');
      host.className = 'popup-content';
      document.body.append(host);
      const root = ReactDOM.createRoot(host);
      mountedRoots.push(root);
      await act(async () => {
        root.render(
          React.createElement(CleanView, {
            language: 'zh' as const,
            notify: vi.fn(),
            sendToXPage: vi.fn().mockResolvedValue({}),
            pageMarked: many,
            refreshPageMarked: vi.fn().mockResolvedValue(undefined),
            pauseDestructive: false,
            killSwitchActive: false,
            communityEligible: [],
            communityLoading: false,
          }),
        );
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      return { host, root };
    }

    const first = await mount();
    first.host.scrollTop = 640;
    await act(async () => {
      first.host.dispatchEvent(new Event('scroll'));
    });
    // 立刻切走：此时 DOM 已经换掉、scrollTop 归零，保存要靠滚动时记下的值
    await act(async () => first.root.unmount());
    first.host.remove();

    const second = await mount();
    expect(second.host.scrollTop).toBe(640);
  });
});
