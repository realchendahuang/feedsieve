// @vitest-environment happy-dom
// popup 渲染冒烟测试：防止「渲染期崩溃 → 白屏」再犯（曾因三态分支写错崩在 null.map）
import React from 'react';
import ReactDOM from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

beforeEach(() => {
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({ pendingBlocks: [] }),
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

describe('popup App 渲染冒烟', () => {
  it('renders header and empty-list hint without throwing', async () => {
    const rootEl = renderApp();
    // 等 storage 异步 resolve 完成（加载态「…」过渡到空态提示）；
    // 全量 verify 高并发时 50ms 偶发不够，放宽到 150ms
    await new Promise((r) => setTimeout(r, 150));

    expect(rootEl.textContent).toContain('福滤娃');
    expect(rootEl.textContent).toContain('在 X 页面勾选黄框账号');
    expect(rootEl.textContent).toContain('一键拉黑');
    expect(rootEl.textContent).toContain('已拉黑');
    expect(rootEl.textContent).toContain('🟡 0');
  });

  it('renders pending accounts after storage resolves', async () => {
    vi.stubGlobal('browser', {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            pendingBlocks: [
              { handle: 'spamking88', addedAt: 0, markedReason: 'giveaway 模板' },
            ],
          }),
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

    const rootEl = renderApp();
    await new Promise((r) => setTimeout(r, 10));

    expect(rootEl.textContent).toContain('@spamking88');
    expect(rootEl.textContent).toContain('giveaway 模板');
  });
});