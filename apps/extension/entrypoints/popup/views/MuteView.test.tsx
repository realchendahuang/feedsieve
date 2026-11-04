// @vitest-environment happy-dom
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MuteView from './MuteView';
import type { MuteSettings, NativeMute } from '../../../src/lib/mute/mute-store';

let root: ReactDOM.Root;
let container: HTMLElement;
let stored: Record<string, unknown>;
let listeners: Array<(changes: Record<string, unknown>, area: string) => void>;
let notified: Array<string | null>;

interface FakeX {
  words: NativeMute[];
  nextId: number;
  calls: string[];
  fail: boolean;
}

function fakeX(words: NativeMute[] = []): FakeX {
  return { words, nextId: 100, calls: [], fail: false };
}

function mute(id: string, keyword: string): NativeMute {
  return { keyword, id, surfaces: ['home_timeline'], options: [], validUntil: null };
}

function sendFor(x: FakeX) {
  return vi.fn(async (message: { type: string; keyword?: string; ids?: string[] }) => {
    const call = message.type.replace('feedsieve:mute-', '');
    x.calls.push(
      message.keyword ? `${call}:${message.keyword}` : message.ids ? `${call}:${message.ids.join(',')}` : call,
    );
    if (x.fail) throw new Error('no x.com receiver');
    if (message.type === 'feedsieve:mute-list') return { ok: true, data: x.words };
    if (message.type === 'feedsieve:mute-create') {
      const created = mute(String(x.nextId++), message.keyword ?? '');
      x.words = [created, ...x.words];
      return { ok: true, data: { mute: created, list: x.words } };
    }
    if (message.type === 'feedsieve:mute-destroy') {
      const ids = new Set(message.ids ?? []);
      x.words = x.words.filter((entry) => !ids.has(entry.id));
      return { ok: true, data: x.words };
    }
    return null;
  });
}

function saved(): MuteSettings {
  return stored.keywordMutesV1 as MuteSettings;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  stored = { keywordMutesV1: { consented: false, rules: [] } };
  listeners = [];
  notified = [];
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

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function render(x: FakeX, language: 'zh' | 'en' = 'zh'): Promise<void> {
  const sendToXPage = sendFor(x);
  await act(async () => {
    root.render(<MuteView language={language} notify={(message) => notified.push(message)} sendToXPage={sendToXPage} />);
    await flush();
  });
}

function setInput(selector: string, value: string): void {
  const input = container.querySelector<HTMLInputElement>(selector)!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function buttonByText(selector: string, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>(selector)].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!button) throw new Error(`找不到按钮：${text}`);
  return button;
}

async function submitAdd(value: string): Promise<void> {
  await act(async () => {
    setInput('.mute-add-form input', value);
    container
      .querySelector<HTMLFormElement>('.mute-add-form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  });
}

describe('静音页（只管理 X 原生静音词）', () => {
  it('打开时从 X 拉取列表并显示镜像', async () => {
    const x = fakeX([mute('11', '免费空投')]);
    await render(x);

    expect(container.textContent).toContain('免费空投');
    expect(x.calls).toContain('list');
    expect(saved().rules.map((entry) => entry.phrase)).toEqual(['免费空投']);
    expect(saved().rules[0]?.nativeId).toBe('11');
  });

  it('不在 x.com 页面时给出提示，不落库', async () => {
    const x = fakeX();
    x.fail = true;
    await render(x);

    const alert = container.querySelector('.alert');
    expect(alert?.textContent).toContain('先在 x.com 页面打开弹窗');

    await submitAdd('加微信');
    expect(notified.some((message) => message?.includes('先在 x.com 页面打开弹窗'))).toBe(true);
    expect(saved().rules).toEqual([]);
  });

  it('首次添加先弹确认，确认后才写入 X', async () => {
    const x = fakeX();
    await render(x);

    await submitAdd('加微信');
    // 还没确认：不写 X，规则也没落库
    expect(container.querySelector('.mute-consent')?.textContent).toContain('把静音词写进 X 账号？');
    expect(x.calls.filter((call) => call.startsWith('create'))).toEqual([]);
    expect(saved().rules).toEqual([]);

    await act(async () => {
      buttonByText('.mute-consent .secondary-button', '开启写入').click();
      await flush();
    });

    expect(x.calls).toContain('create:加微信');
    expect(container.textContent).toContain('加微信');
    expect(saved().consented).toBe(true);
    expect(saved().rules.map((entry) => entry.phrase)).toEqual(['加微信']);
  });

  it('取消确认后不写入', async () => {
    const x = fakeX();
    await render(x);

    await submitAdd('加微信');
    await act(async () => {
      buttonByText('.mute-consent .text-button', '先不用').click();
      await flush();
    });

    expect(container.querySelector('.mute-consent')).toBeNull();
    expect(x.calls.filter((call) => call.startsWith('create'))).toEqual([]);
    expect(saved().rules).toEqual([]);
  });

  it('已确认过时直接写入，不再弹确认', async () => {
    stored.keywordMutesV1 = { consented: true, rules: [] };
    const x = fakeX();
    await render(x);

    await submitAdd('刷单');
    expect(container.querySelector('.mute-consent')).toBeNull();
    expect(x.calls).toContain('create:刷单');
    expect(notified).toContain('已添加');
    expect(saved().rules.map((entry) => entry.phrase)).toEqual(['刷单']);
  });

  it('编辑：先删 X 旧词再写新词，镜像同步更新', async () => {
    stored.keywordMutesV1 = {
      consented: true,
      rules: [{ id: 'a', phrase: '加微信', nativeId: '11', createdAt: 1 }],
    };
    const x = fakeX([mute('11', '加微信')]);
    await render(x);

    await act(async () => {
      buttonByText('.mute-actions .text-button', '编辑').click();
      await flush();
    });
    await act(async () => {
      setInput('.mute-edit-input', '加 V');
      buttonByText('.mute-actions .text-button', '保存').click();
      await flush();
    });

    expect(x.calls).toContain('destroy:11');
    expect(x.calls).toContain('create:加 V');
    expect(container.textContent).toContain('加 V');
    expect(saved().rules[0]).toMatchObject({ id: 'a', phrase: '加 V' });
  });

  it('还没确认写入账号时，编辑也要先确认', async () => {
    stored.keywordMutesV1 = {
      consented: false,
      rules: [{ id: 'a', phrase: '加微信', nativeId: '11', createdAt: 1 }],
    };
    const x = fakeX([mute('11', '加微信')]);
    await render(x);

    await act(async () => {
      buttonByText('.mute-actions .text-button', '编辑').click();
      await flush();
    });
    await act(async () => {
      setInput('.mute-edit-input', '加 V');
      buttonByText('.mute-actions .text-button', '保存').click();
      await flush();
    });

    expect(container.querySelector('.mute-consent')).not.toBeNull();
    expect(x.calls).not.toContain('destroy:11');

    await act(async () => {
      buttonByText('.mute-consent .secondary-button', '开启写入').click();
      await flush();
    });
    expect(x.calls).toContain('destroy:11');
    expect(x.calls).toContain('create:加 V');
    expect(saved().consented).toBe(true);
  });

  it('删除需要二次确认，完成后从 X 与镜像移除', async () => {
    stored.keywordMutesV1 = {
      consented: true,
      rules: [{ id: 'a', phrase: '加微信', nativeId: '11', createdAt: 1 }],
    };
    const x = fakeX([mute('11', '加微信')]);
    await render(x);

    await act(async () => {
      buttonByText('.mute-actions .text-button', '删除').click();
      await flush();
    });
    expect(x.calls).not.toContain('destroy:11');

    await act(async () => {
      buttonByText('.mute-actions .text-button', '确认删除').click();
      await flush();
    });
    expect(x.calls).toContain('destroy:11');
    expect(saved().rules).toEqual([]);
    expect(container.textContent).toContain('X 账号里还没有静音词');
  });

  it('词库点词直接写入 X（已确认时），加入后标记为已加入', async () => {
    stored.keywordMutesV1 = { consented: true, rules: [] };
    const x = fakeX();
    await render(x);

    await act(async () => {
      buttonByText('.segmented button', '词库').click();
      await flush();
    });
    const chip = container.querySelector<HTMLButtonElement>('.mute-chip')!;
    const word = chip.textContent ?? '';
    await act(async () => {
      chip.click();
      await flush();
    });

    expect(x.calls.some((call) => call.startsWith('create:'))).toBe(true);
    expect(saved().rules).toHaveLength(1);
    expect(word.length).toBeGreaterThan(0);
  });
});
