import { describe, expect, it, vi } from 'vitest';
import { createPageTicker, PAGE_TICK_MS } from './page-ticker';

function harness() {
  const state = { hidden: false };
  const timers = new Map<number, () => void>();
  let nextId = 1;
  const events = new Map<string, Set<() => void>>();
  const doc = {
    get visibilityState() {
      return state.hidden ? 'hidden' : 'visible';
    },
    addEventListener(type: string, fn: () => void) {
      let set = events.get(type);
      if (!set) {
        set = new Set();
        events.set(type, set);
      }
      set.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      events.get(type)?.delete(fn);
    },
  } as unknown as Document;
  const ticker = createPageTicker({
    document: doc,
    setInterval: (fn) => {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    clearInterval: (id) => {
      timers.delete(id);
    },
  });
  const fire = (): void => {
    for (const fn of [...timers.values()]) fn();
  };
  const setHidden = (hidden: boolean): void => {
    state.hidden = hidden;
    for (const fn of [...(events.get('visibilitychange') ?? [])]) fn();
  };
  return { ticker, fire, setHidden, timers };
}

describe('createPageTicker', () => {
  it('每秒跑一次注册的巡检，启动时立即补一次', () => {
    const { ticker, fire } = harness();
    const listener = vi.fn();
    ticker.add(listener);
    ticker.start();
    expect(listener).toHaveBeenCalledTimes(1);
    fire();
    fire();
    expect(listener).toHaveBeenCalledTimes(3);
    ticker.stop();
  });

  it('页面隐藏时停掉定时器，切回来立即补跑', () => {
    const { ticker, fire, setHidden, timers } = harness();
    const listener = vi.fn();
    ticker.add(listener);
    ticker.start();
    expect(ticker.isRunning()).toBe(true);

    setHidden(true);
    expect(ticker.isRunning()).toBe(false);
    expect(timers.size).toBe(0);
    fire();
    expect(listener).toHaveBeenCalledTimes(1); // 只算了启动那一次

    setHidden(false);
    expect(ticker.isRunning()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2); // 切回来立刻补一次
    ticker.stop();
  });

  it('单个巡检抛错不影响其它巡检', () => {
    const { ticker, fire } = harness();
    const second = vi.fn();
    ticker.add(() => {
      throw new Error('boom');
    });
    ticker.add(second);
    ticker.start();
    fire();
    expect(second).toHaveBeenCalledTimes(2);
    ticker.stop();
  });

  it('stop 之后不再跑，也不再听可见性变化', () => {
    const { ticker, fire, setHidden } = harness();
    const listener = vi.fn();
    ticker.add(listener);
    ticker.start();
    ticker.stop();
    fire();
    setHidden(true);
    setHidden(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(ticker.isRunning()).toBe(false);
  });

  it('周期是一秒', () => {
    expect(PAGE_TICK_MS).toBe(1_000);
  });
});
