// @vitest-environment happy-dom
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MuteView from './MuteView';
import type { MuteSettings } from '../../../src/lib/mute/mute-store';

let root: ReactDOM.Root;
let container: HTMLElement;
let stored: Record<string, unknown>;
let listeners: Array<(changes: Record<string, unknown>, area: string) => void>;

function settings(patch: Partial<MuteSettings> = {}): MuteSettings {
  return { enabled: true, nativeSync: false, rules: [], ...patch };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  stored = { keywordMutesV1: settings() };
  listeners = [];
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: stored[key] })),
        set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(stored, patch)),
      },
      onChanged: {
        addListener: (listener: (typeof listeners)[number]) => listeners.push(listener),
        removeListener: vi.fn(),
      },
    },
  });
  document.body.innerHTML = '<div id="root"></div>';
  container = document.querySelector<HTMLElement>('#root')!;
  root = ReactDOM.createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function render(
  sendToXPage: (message: { type: string; keyword?: string; ids?: string[] }) => Promise<unknown> = vi.fn(
    async () => ({ ok: true, data: [] }),
  ),
): Promise<void> {
  await act(async () => {
    root.render(<MuteView language="zh" notify={() => {}} sendToXPage={sendToXPage} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function setInput(value: string): void {
  const input = container.querySelector<HTMLInputElement>('.mute-add-form input')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function submitAdd(): Promise<void> {
  await act(async () => {
    container
      .querySelector<HTMLFormElement>('.mute-add-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('屏蔽页', () => {
  it('本地添加一个词，立即出现在列表里并写入 storage', async () => {
    await render();
    expect(container.textContent).toContain('还没有屏蔽词');

    await act(async () => setInput('加微信'));
    await submitAdd();

    expect(container.textContent).toContain('加微信');
    expect(container.textContent).toContain('仅本机');
    const saved = (stored.keywordMutesV1 as MuteSettings).rules;
    expect(saved.map((rule) => rule.phrase)).toEqual(['加微信']);
  });

  it('词库是候选，点加入后才进入我的列表', async () => {
    await render();
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>('.segmented button')]
        .find((button) => button.textContent?.trim() === '词库')!
        .click();
    });
    const add = container.querySelector<HTMLButtonElement>('.mute-pack-item button')!;
    await act(async () => {
      add.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>('.segmented button')]
        .find((button) => button.textContent?.trim() === '我的')!
        .click();
    });
    expect(container.querySelector('.mute-item')?.textContent).toContain('同城约');
  });

  it('开启原生同步后导入 X 已有静音词', async () => {
    stored.keywordMutesV1 = settings({ nativeSync: true });
    const send = vi.fn(async () => ({
      ok: true,
      data: [
        {
          keyword: '加V',
          id: '9',
          surfaces: ['home_timeline', 'notifications'],
          options: [],
          validUntil: null,
        },
      ],
    }));
    await render(send);

    expect(send).toHaveBeenCalledWith({ type: 'feedsieve:mute-list' });
    expect(container.textContent).toContain('加V');
    expect(container.textContent).toContain('已同步 X');
    expect((stored.keywordMutesV1 as MuteSettings).rules[0]?.nativeId).toBe('9');
  });

  it('开启原生同步后添加词，会写一条到 X 并显示已同步', async () => {
    stored.keywordMutesV1 = settings({ nativeSync: true });
    const send = vi.fn(async (message: { type: string; keyword?: string }) => {
      if (message.type === 'feedsieve:mute-list') return { ok: true, data: [] };
      if (message.type === 'feedsieve:mute-create') {
        return {
          ok: true,
          data: {
            mute: {
              keyword: message.keyword,
              id: '77',
              surfaces: ['home_timeline', 'notifications', 'tweet_replies'],
              options: [],
              validUntil: null,
            },
            list: [],
          },
        };
      }
      return { ok: false, code: 'unexpected' };
    });
    await render(send);
    await act(async () => setInput('加微信'));
    await submitAdd();

    expect(container.textContent).toContain('已同步 X');
    const saved = (stored.keywordMutesV1 as MuteSettings).rules[0];
    expect(saved?.nativeId).toBe('77');
    expect(saved?.syncState).toBe('synced');
  });

  it('开启原生同步后，本地词可以逐条同步到 X', async () => {
    stored.keywordMutesV1 = settings({
      nativeSync: true,
      rules: [
        {
          id: 'r1',
          phrase: '加微信',
          enabled: true,
          origin: 'local',
          syncState: 'local',
          createdAt: 1,
        },
      ],
    });
    const send = vi.fn(async (message: { type: string; keyword?: string }) => {
      if (message.type === 'feedsieve:mute-list') return { ok: true, data: [] };
      if (message.type === 'feedsieve:mute-create') {
        return {
          ok: true,
          data: {
            mute: {
              keyword: message.keyword,
              id: '88',
              surfaces: ['home_timeline'],
              options: [],
              validUntil: null,
            },
            list: [],
          },
        };
      }
      return { ok: false, code: 'unexpected' };
    });
    await render(send);
    const sync = container.querySelector<HTMLButtonElement>('.mute-actions .text-button')!;
    expect(sync.textContent).toBe('同步到 X');
    await act(async () => {
      sync.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain('已同步 X');
    expect((stored.keywordMutesV1 as MuteSettings).rules[0]?.nativeId).toBe('88');
  });

  it('删除需要点两次确认', async () => {
    stored.keywordMutesV1 = settings({
      rules: [
        {
          id: 'r1',
          phrase: '加微信',
          enabled: true,
          origin: 'local',
          syncState: 'local',
          createdAt: 1,
        },
      ],
    });
    await render();
    const remove = container.querySelector<HTMLButtonElement>('.mute-actions .text-button')!;
    await act(async () => remove.click());
    expect(remove.textContent).toBe('确认删除');
    expect((stored.keywordMutesV1 as MuteSettings).rules).toHaveLength(1);

    await act(async () => remove.click());
    expect(container.querySelector('.mute-item')).toBeNull();
    expect((stored.keywordMutesV1 as MuteSettings).rules).toHaveLength(0);
  });
});
