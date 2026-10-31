// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReadTracker } from './read-tracker';

type Callback = (entries: Array<{ target: Element; isIntersecting: boolean }>) => void;

function stubObserver() {
  let callback: Callback = () => {};
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: Callback) {
        callback = cb;
      }
      observe() {}
    },
  );
  return (target: Element, isIntersecting: boolean) => callback([{ target, isIntersecting }]);
}

function article(postId: string): Element {
  const el = document.createElement('article');
  el.setAttribute('data-testid', 'tweet');
  el.innerHTML = `<div data-testid="User-Name"><a href="/alice">@alice</a></div>
    <a href="/alice/status/${postId}"><time datetime="2026-10-30T00:00:00Z">1h</time></a>`;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('createReadTracker', () => {
  it('marks a post read only after it stays on screen long enough', async () => {
    vi.useFakeTimers();
    const fire = stubObserver();
    const send = vi.fn().mockResolvedValue(undefined);
    const tracker = createReadTracker({ send, dwellMs: 2_000 });
    const quick = article('111');
    const slow = article('222');
    tracker.watch(quick);
    tracker.watch(slow);

    // 快速滑过：不到 2 秒就离开
    fire(quick, true);
    await vi.advanceTimersByTimeAsync(800);
    fire(quick, false);
    // 停下来看
    fire(slow, true);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toEqual(['222']);
  });

  it('marks the post of a detail page as read once', async () => {
    vi.useFakeTimers();
    stubObserver();
    const send = vi.fn().mockResolvedValue(undefined);
    const tracker = createReadTracker({ send });
    tracker.visit('/alice/status/333');
    tracker.visit('/alice/status/333/photo/1');
    tracker.visit('/home');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(send).toHaveBeenCalledWith(['333']);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('reports when a post first shows on screen, without waiting for the dwell', async () => {
    vi.useFakeTimers();
    const fire = stubObserver();
    const send = vi.fn().mockResolvedValue(undefined);
    const sendSeen = vi.fn().mockResolvedValue(undefined);
    let clock = 1_000;
    const tracker = createReadTracker({ send, sendSeen, now: () => clock });
    const a = article('444');
    const b = article('555');
    tracker.watch(a);
    tracker.watch(b);
    fire(a, true);
    clock = 1_300;
    fire(b, true);
    fire(a, false);
    fire(b, false);
    clock = 2_000;
    // 翻回来再看到：不重复报
    fire(a, true);
    fire(a, false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sendSeen).toHaveBeenCalledTimes(1);
    expect(sendSeen).toHaveBeenCalledWith([
      { postId: '444', at: 1_000 },
      { postId: '555', at: 1_300 },
    ]);
    // 快速滑过的不算已读
    await vi.advanceTimersByTimeAsync(5_000);
    expect(send).not.toHaveBeenCalled();
  });
});
