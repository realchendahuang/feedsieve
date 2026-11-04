// @vitest-environment happy-dom
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WriteView } from './WriteView';
import { OPEN_SCHEDULED_MESSAGE } from '../../../src/lib/compose/compose-schedule';

let sendToXPage: ReturnType<typeof vi.fn>;
let onOpenSettings: () => void;
let sessionStored: Record<string, unknown>;
const mounted: Array<{ unmount: () => void }> = [];

function tomorrowAt(hour: number, minute: number): number {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

function scheduledPosts(count = 3): Record<string, unknown> {
  const base = tomorrowAt(10, 0);
  return {
    account: 'demo_creator',
    syncedAt: Date.now() - 60_000,
    posts: Array.from({ length: count }, (_, index) => ({
      id: `post-${index + 1}`,
      executeAt: base + index * 30 * 60_000,
      text: `第 ${index + 1} 条排期`,
      media: index === 0 ? 2 : 0,
    })),
  };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  for (const root of mounted.splice(0)) root.unmount();
  document.body.replaceChildren();
  sessionStored = {};
  sendToXPage = vi.fn().mockResolvedValue({ ok: true });
  onOpenSettings = vi.fn() as unknown as () => void;
  vi.stubGlobal('browser', {
    storage: {
      session: {
        get: vi.fn(async () => ({ ...sessionStored })),
        set: vi.fn(async (items: Record<string, unknown>) => Object.assign(sessionStored, items)),
      },
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      create: vi.fn(),
      sendMessage: vi.fn(),
    },
    runtime: { onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
  });
});

async function renderWriteView(): Promise<HTMLElement> {
  const rootEl = document.createElement('div');
  document.body.append(rootEl);
  const root = ReactDOM.createRoot(rootEl);
  mounted.push(root);
  await act(async () => {
    root.render(
      React.createElement(WriteView, {
        language: 'zh' as const,
        notify: vi.fn(),
        sendToXPage: sendToXPage as unknown as (message: { type: string }) => Promise<unknown>,
        onOpenSettings,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return rootEl;
}

describe('发帖页只读排期台', () => {
  it('显示排期数量、条目和详情，不出现写帖/排队列按钮', async () => {
    (browser.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (key: string) => {
        if (key === 'scheduledPostsV1') return { scheduledPostsV1: scheduledPosts(3) };
        return {};
      },
    );

    const rootEl = await renderWriteView();
    expect(rootEl.querySelector('.write-view .count')?.textContent).toBe('3');
    expect(rootEl.textContent).toContain('第 1 条排期');
    expect(rootEl.textContent).toContain('第 3 条排期');
    expect(rootEl.textContent).toContain('2');
    expect(rootEl.textContent).not.toContain('写新帖');
    expect(rootEl.textContent).not.toContain('排下一条');
    expect(rootEl.textContent).not.toContain('配图');
    expect(rootEl.textContent).not.toContain('文案队列');

    const item = rootEl.querySelector<HTMLButtonElement>('.write-item.is-post');
    if (!item) throw new Error('scheduled item not found');
    await act(async () => item.click());
    expect(rootEl.querySelector('.write-detail')?.textContent).toContain('已排期');
    expect(rootEl.querySelector('.write-detail')?.textContent).toContain('在 X 里改时间');
    expect(rootEl.querySelector('.write-detail')?.textContent).toContain('第 1 条排期');
  });

  it('同步按钮只让 X 打开预排期页', async () => {
    const rootEl = await renderWriteView();
    const button = rootEl.querySelector<HTMLButtonElement>('[aria-label="同步预排期列表"]');
    if (!button) throw new Error('sync button not found');
    await act(async () => {
      button.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(sendToXPage).toHaveBeenCalledWith({ type: OPEN_SCHEDULED_MESSAGE });
  });

  it('齿轮打开发帖模块设置', async () => {
    const rootEl = await renderWriteView();
    const button = rootEl.querySelector<HTMLButtonElement>('[aria-label="落笔设置"]');
    if (!button) throw new Error('settings button not found');
    await act(async () => button.click());
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('可以翻到下一周', async () => {
    const rootEl = await renderWriteView();
    const before = rootEl.querySelector('.write-week-head')?.textContent;
    const next = rootEl.querySelector<HTMLButtonElement>('.write-week-arrow:not(.is-prev)');
    if (!next) throw new Error('next week button not found');
    await act(async () => next.click());
    const after = rootEl.querySelector('.write-week-head')?.textContent;
    expect(after).not.toBe(before);
  });
});

describe('发帖页滚动位置', () => {
  it('切走再回来回到原来的位置', async () => {
    (browser.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (key: string) => {
        if (key === 'scheduledPostsV1') return { scheduledPostsV1: scheduledPosts(30) };
        return {};
      },
    );
    async function mount(): Promise<{ host: HTMLDivElement; root: ReactDOM.Root }> {
      const host = document.createElement('div');
      host.className = 'popup-content';
      document.body.append(host);
      const root = ReactDOM.createRoot(host);
      mounted.push(root);
      await act(async () => {
        root.render(
          React.createElement(WriteView, {
            language: 'zh' as const,
            notify: vi.fn(),
            sendToXPage: sendToXPage as unknown as (message: { type: string }) => Promise<unknown>,
            onOpenSettings,
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
