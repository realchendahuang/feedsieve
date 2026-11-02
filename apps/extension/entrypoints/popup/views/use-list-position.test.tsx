// @vitest-environment happy-dom
// 长列表位置记忆：StrictMode 下挂载后紧接着的那次清理不能把刚读到的位置写成 0。
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useListPosition } from './use-list-position';

let sessionStored: Record<string, unknown>;

function List() {
  const ref = React.useRef<HTMLDivElement | null>(null);
  useListPosition({ storageKey: 'testPositionV1', pageKey: 'key', rootRef: ref, ready: true });
  return (
    <div className="view" ref={ref}>
      <p>list</p>
    </div>
  );
}

async function mount(strict: boolean): Promise<{ host: HTMLDivElement; root: ReactDOM.Root }> {
  const host = document.createElement('div');
  host.className = 'popup-content';
  document.body.append(host);
  const root = ReactDOM.createRoot(host);
  await act(async () => {
    root.render(
      strict ? (
        <React.StrictMode>
          <List />
        </React.StrictMode>
      ) : (
        <List />
      ),
    );
  });
  return { host, root };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.replaceChildren();
  sessionStored = {};
  vi.stubGlobal('browser', {
    storage: {
      session: {
        get: vi.fn(async () => ({ ...sessionStored })),
        set: vi.fn(async (items: Record<string, unknown>) => Object.assign(sessionStored, items)),
      },
    },
  });
});

describe('useListPosition', () => {
  it('StrictMode 下的首次清理不会覆盖已存的位置', async () => {
    const first = await mount(false);
    first.host.scrollTop = 100;
    await act(async () => {
      first.host.dispatchEvent(new Event('scroll'));
    });
    await act(async () => first.root.unmount());
    first.host.remove();

    const second = await mount(true);
    expect(second.host.scrollTop).toBe(100);
  });
});
