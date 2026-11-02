// @vitest-environment happy-dom
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WriteView } from './WriteView';
import { COMPOSE_DRAFT_MESSAGE } from '../../../src/lib/compose/compose-schedule';
import { SCHEDULE_ASSIGNMENTS_KEY } from '../../../src/lib/compose/schedule-store';
import { DEFAULT_SCHEDULE_SETTINGS } from '../../../src/lib/compose/schedule-slots';

let storageSet: ReturnType<typeof vi.fn>;
let sendToXPage: ReturnType<typeof vi.fn>;
let sessionStored: Record<string, unknown>;
const mounted: Array<{ unmount: () => void }> = [];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  for (const root of mounted.splice(0)) root.unmount();
  document.body.replaceChildren();
  storageSet = vi.fn().mockResolvedValue(undefined);
  sessionStored = {};
  sendToXPage = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('browser', {
    storage: {
      session: {
        get: vi.fn(async () => ({ ...sessionStored })),
        set: vi.fn(async (items: Record<string, unknown>) => Object.assign(sessionStored, items)),
      },
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: storageSet,
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
        sendToXPage: sendToXPage as unknown as (message: {
          type: string;
          text?: string;
          at?: number;
        }) => Promise<unknown>,
        onOpenCadence: vi.fn(),
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
  });
  return rootEl;
}

describe('发帖页排期', () => {
  it('按新节奏把队列里的第一条排到下一条，并先在本机占位', async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const createdAt = start.getTime();
    (browser.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (key: string) => {
        if (key === 'composeScheduleV1')
          return {
            composeScheduleV1: {
              ...DEFAULT_SCHEDULE_SETTINGS,
              windows: [
                {
                  id: 'w',
                  days: [0, 1, 2, 3, 4, 5, 6],
                  start: '00:00',
                  end: '23:59',
                  perHour: 2,
                },
              ],
              leadMinutes: 0,
              randomize: false,
              horizonDays: 14,
            },
          };
        if (key === 'composeDraftsV1')
          return { composeDraftsV1: [{ id: 'd1', text: 'hello', createdAt }] };
        return {};
      },
    );

    const rootEl = await renderWriteView();
    expect(rootEl.textContent).toContain('排下一条');

    const button = [...rootEl.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === '排下一条',
    );
    if (!button) throw new Error('schedule next button not found');
    await act(async () => {
      button.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(sendToXPage).toHaveBeenCalledWith(
      expect.objectContaining({ type: COMPOSE_DRAFT_MESSAGE, text: 'hello' }),
    );
    expect(sendToXPage.mock.calls[0]?.[0]).toMatchObject({ at: expect.any(Number) });
    expect(storageSet).toHaveBeenCalledWith({
      [SCHEDULE_ASSIGNMENTS_KEY]: [
        expect.objectContaining({ draftId: 'd1', textKey: 'hello', at: expect.any(Number) }),
      ],
    });
  });
});

describe('发帖页滚动位置', () => {
  it('切走再回来回到原来的位置', async () => {
    (browser.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (key: string) => {
        if (key === 'composeDraftsV1') {
          return { composeDraftsV1: [{ id: 'd1', text: '草稿', createdAt: Date.now() }] };
        }
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
            sendToXPage: sendToXPage as unknown as (message: {
              type: string;
              text?: string;
              at?: number;
            }) => Promise<unknown>,
            onOpenCadence: vi.fn(),
          }),
        );
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
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
