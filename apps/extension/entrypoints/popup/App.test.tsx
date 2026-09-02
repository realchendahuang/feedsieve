// @vitest-environment happy-dom
// popup 渲染冒烟测试：防止「渲染期崩溃 → 白屏」再犯（曾因三态分支写错崩在 null.map）
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

beforeEach(() => {
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({ uiLanguage: 'zh' }),
        set: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1 }]),
      sendMessage: vi.fn().mockResolvedValue({ blocked: [], failed: [] }),
    },
  });
});

function renderApp(): HTMLElement {
  const rootEl = document.createElement('div');
  document.body.append(rootEl);
  ReactDOM.createRoot(rootEl).render(React.createElement(App));
  return rootEl;
}

function buttonWithText(root: HTMLElement, label: string): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`button not found: ${label}`);
  return button;
}

describe('popup App 渲染冒烟', () => {
  it('renders header and empty page-marked hint without throwing', async () => {
    const rootEl = renderApp();
    // 等 storage/tabs 异步 resolve 完成（加载态「…」过渡到空态提示）；
    // 全量 verify 高并发时 50ms 偶发不够，放宽到 150ms
    await new Promise((r) => setTimeout(r, 150));

    expect(rootEl.textContent).toContain('福滤娃');
    expect(rootEl.textContent).toContain('当前页面');
    expect(rootEl.textContent).toContain('当前页面没有高置信待处理账号');
    expect(rootEl.textContent).toContain('全部拉黑');
    expect(rootEl.textContent).toContain('今日概览');
    expect(rootEl.textContent).toContain('清理');
    expect(rootEl.textContent).toContain('名单');
    expect(rootEl.textContent).toContain('设置');

    await act(async () => buttonWithText(rootEl, '名单').click());
    expect(rootEl.textContent).toContain('拉黑记录');
    expect(rootEl.textContent).toContain('误标白名单');

    await act(async () => buttonWithText(rootEl, '设置').click());
    expect(rootEl.textContent).toContain('检测强度');
    expect(rootEl.textContent).toContain('关键词规则');
    expect(rootEl.textContent).toContain('官方预置词库');
    expect(rootEl.textContent).toContain('黄推 / 成人引流');
    expect(rootEl.textContent).toContain('未订阅');
    expect(rootEl.textContent).toContain('订阅此词库');
    expect(rootEl.textContent).not.toContain('误标较多时');
    expect(rootEl.textContent).not.toContain('标注不隐藏内容');
    expect(rootEl.textContent).not.toContain('X 页面清理');

    await act(async () => buttonWithText(rootEl, '订阅此词库').click());
    expect(rootEl.textContent).toContain('退订此词库');
    expect(rootEl.textContent).toContain('15/15');

    await act(async () => buttonWithText(rootEl, 'EN').click());
    expect(rootEl.textContent).toContain('FeedSieve');
    expect(rootEl.textContent).toContain('Detection level');
  });

  it('renders page-marked accounts after querying the active x.com tab', async () => {
    vi.stubGlobal('browser', {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ uiLanguage: 'zh' }),
          set: vi.fn().mockResolvedValue(undefined),
        },
        onChanged: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1 }]),
        // 页面黄框清单：内容脚本实时查询返回
        sendMessage: vi
          .fn()
          .mockResolvedValue([
            { handle: 'spamking88', category: 'copy_paste', reason: '3 人标记为重复刷屏' },
          ]),
      },
    });

    const rootEl = renderApp();
    await new Promise((r) => setTimeout(r, 150));

    expect(rootEl.textContent).toContain('@spamking88');
    expect(rootEl.textContent).toContain('3 人标记为重复刷屏');
    expect(rootEl.textContent).toContain('全部拉黑 · 1');
  });
});
