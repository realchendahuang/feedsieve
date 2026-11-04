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
  setValue(container.querySelector<HTMLInputElement>('.mute-add-form input')!, value);
}

function setValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function actionButton(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>('.mute-actions .text-button')]
    .find((item) => item.textContent?.trim() === text);
  if (!button) throw new Error(`找不到按钮：${text}`);
  return button;
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

  it('右上角齿轮进入屏蔽设置，返回回到列表', async () => {
    await render();
    const gear = container.querySelector<HTMLButtonElement>('.toolbar-end .icon-button')!;
    await act(async () => gear.click());
    expect(container.textContent).toContain('屏蔽设置');
    expect(container.textContent).toContain('启用屏蔽');

    const back = container.querySelector<HTMLButtonElement>('.back-button')!;
    await act(async () => back.click());
    expect(container.querySelector('.mute-add-form')).not.toBeNull();
    expect(container.querySelector('.toolbar-end')).not.toBeNull();
  });

  it('关闭屏蔽时工具栏显示已关闭，点它进入设置', async () => {
    stored.keywordMutesV1 = settings({ enabled: false });
    await render();
    const off = [...container.querySelectorAll<HTMLButtonElement>('.mute-off-chip')][0]!;
    expect(off.textContent).toBe('已关闭');
    await act(async () => off.click());
    expect(container.textContent).toContain('屏蔽设置');
  });

  it('词库是候选，点加入后才进入我的列表', async () => {
    await render();
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>('.segmented button')]
        .find((button) => button.textContent?.trim() === '词库')!
        .click();
    });
    const add = container.querySelector<HTMLButtonElement>('.mute-chip')!;
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

  it('词库连续点多个词时，按队列逐条同步，不阻塞下一次点击', async () => {
    stored.keywordMutesV1 = settings({ nativeSync: true });
    const send = vi.fn(async (message: { type: string; keyword?: string }) => {
      if (message.type === 'feedsieve:mute-list') return { ok: true, data: [] };
      if (message.type === 'feedsieve:mute-create') {
        return {
          ok: true,
          data: {
            mute: {
              keyword: message.keyword,
              id: message.keyword === '同城约' ? '101' : '102',
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
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>('.segmented button')]
        .find((button) => button.textContent?.trim() === '词库')!
        .click();
    });
    const chips = [...container.querySelectorAll<HTMLButtonElement>('.mute-chip')];
    await act(async () => {
      chips[0]!.click();
      chips[1]!.click();
      for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const saved = (stored.keywordMutesV1 as MuteSettings).rules;
    expect(saved.map((rule) => rule.phrase)).toEqual(['上门服务', '同城约']);
    expect(saved.every((rule) => rule.syncState === 'synced')).toBe(true);
    expect(container.textContent).toContain('已加入 2 / 48');
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
    const remove = actionButton('删除');
    await act(async () => remove.click());
    expect(remove.textContent).toBe('确认删除');
    expect((stored.keywordMutesV1 as MuteSettings).rules).toHaveLength(1);

    await act(async () => remove.click());
    expect(container.querySelector('.mute-item')).toBeNull();
    expect((stored.keywordMutesV1 as MuteSettings).rules).toHaveLength(0);
  });

  it('编辑本机词：改完写回 storage，列表显示新词', async () => {
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
    await act(async () => actionButton('编辑').click());

    const input = container.querySelector<HTMLInputElement>('.mute-edit-input')!;
    expect(input.value).toBe('加微信');
    await act(async () => setValue(input, '领福利'));
    await act(async () => {
      actionButton('保存').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('领福利');
    expect(container.textContent).not.toContain('加微信');
    expect((stored.keywordMutesV1 as MuteSettings).rules[0]?.phrase).toBe('领福利');
  });

  it('编辑成重复词时提示，不改动列表', async () => {
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
        {
          id: 'r2',
          phrase: '加V',
          enabled: true,
          origin: 'local',
          syncState: 'local',
          createdAt: 2,
        },
      ],
    });
    await render();
    const edit = [...container.querySelectorAll<HTMLButtonElement>('.mute-actions .text-button')]
      .filter((button) => button.textContent?.trim() === '编辑')[0]!;
    await act(async () => edit.click());
    const input = container.querySelector<HTMLInputElement>('.mute-edit-input')!;
    await act(async () => setValue(input, '加V'));
    await act(async () => {
      actionButton('保存').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('这个词已经在列表里了');
    expect(container.querySelector('.mute-edit-input')).not.toBeNull();
    expect((stored.keywordMutesV1 as MuteSettings).rules.map((rule) => rule.phrase)).toEqual([
      '加微信',
      '加V',
    ]);
  });

  it('编辑已同步词：先删 X 旧词，再排队写入新词', async () => {
    stored.keywordMutesV1 = settings({
      nativeSync: true,
      rules: [
        {
          id: 'r1',
          phrase: '加微信',
          enabled: true,
          origin: 'local',
          nativeId: '11',
          syncState: 'synced',
          createdAt: 1,
        },
      ],
    });
    const calls: Array<{ type: string; keyword?: string; ids?: string[] }> = [];
    const send = vi.fn(async (message: { type: string; keyword?: string; ids?: string[] }) => {
      calls.push(message);
      if (message.type === 'feedsieve:mute-list') {
        return {
          ok: true,
          data: [
            {
              keyword: '加微信',
              id: '11',
              surfaces: ['home_timeline'],
              options: [],
              validUntil: null,
            },
          ],
        };
      }
      if (message.type === 'feedsieve:mute-destroy') return { ok: true, data: [] };
      if (message.type === 'feedsieve:mute-create') {
        return {
          ok: true,
          data: {
            mute: {
              keyword: message.keyword,
              id: '99',
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
    await act(async () => actionButton('编辑').click());
    const input = container.querySelector<HTMLInputElement>('.mute-edit-input')!;
    await act(async () => setValue(input, '领福利'));
    await act(async () => {
      actionButton('保存').click();
      for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(calls.some((call) => call.type === 'feedsieve:mute-destroy' && call.ids?.[0] === '11')).toBe(
      true,
    );
    expect(
      calls.some(
        (call) => call.type === 'feedsieve:mute-create' && call.keyword === '领福利',
      ),
    ).toBe(true);
    const saved = (stored.keywordMutesV1 as MuteSettings).rules[0];
    expect(saved?.phrase).toBe('领福利');
    expect(saved?.nativeId).toBe('99');
    expect(saved?.syncState).toBe('synced');
  });

  it('超过 5 个词时出现搜索框，可以按词过滤', async () => {
    stored.keywordMutesV1 = settings({
      rules: Array.from({ length: 6 }, (_, index) => ({
        id: `r${index}`,
        phrase: `屏蔽词${index}`,
        enabled: true,
        origin: 'local' as const,
        syncState: 'local' as const,
        createdAt: index,
      })),
    });
    await render();
    const search = container.querySelector<HTMLInputElement>('.mute-search-field input');
    expect(search).not.toBeNull();
    await act(async () => setValue(search!, '屏蔽词3'));

    expect(container.querySelectorAll('.mute-item')).toHaveLength(1);
    expect(container.textContent).toContain('屏蔽词3');
    expect(container.textContent).toContain('1 个词 / 6 个词');
  });
});
