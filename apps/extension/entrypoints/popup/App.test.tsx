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
        get: vi.fn().mockResolvedValue({}),
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
  it('renders header and empty page-marked hint without throwing', async () => {
    const rootEl = renderApp();
    // 等 storage/tabs 异步 resolve 完成（加载态「…」过渡到空态提示）；
    // 全量 verify 高并发时 50ms 偶发不够，放宽到 150ms
    await new Promise((r) => setTimeout(r, 150));

    expect(rootEl.textContent).toContain('福滤娃');
    expect(rootEl.textContent).toContain('页面黄框');
    expect(rootEl.textContent).toContain('一键拉黑');
    expect(rootEl.textContent).toContain('已拉黑');
    expect(rootEl.textContent).toContain('🟡 0');
  });

  it('renders page-marked accounts after querying the active x.com tab', async () => {
    vi.stubGlobal('browser', {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
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
        sendMessage: vi.fn().mockResolvedValue([
          { handle: 'spamking88', category: 'copy_paste', reason: '已知垃圾模板' },
        ]),
      },
    });

    const rootEl = renderApp();
    await new Promise((r) => setTimeout(r, 150));

    expect(rootEl.textContent).toContain('@spamking88');
    expect(rootEl.textContent).toContain('已知垃圾模板');
    expect(rootEl.textContent).toContain('一键拉黑（页面 1 个）');
  });
});