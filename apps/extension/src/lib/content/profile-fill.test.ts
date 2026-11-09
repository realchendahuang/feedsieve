// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROFILE_FILL_COOLDOWN_MS,
  PROFILE_FILL_MAX_MS,
  PROFILE_FILL_STOP_CLASS,
  createProfileFill,
  isProfilePath,
} from './profile-fill';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
  // happy-dom 的 document.hidden 在原型上，删掉实例上的覆盖就能恢复
  Reflect.deleteProperty(document, 'hidden');
});

let articleSeq = 0;

function addArticles(count: number): void {
  for (let i = 0; i < count; i++) {
    const article = document.createElement('article');
    article.setAttribute('data-testid', 'tweet');
    const link = document.createElement('a');
    link.setAttribute('href', `/alice/status/${++articleSeq}`);
    article.appendChild(link);
    document.body.appendChild(article);
  }
}

describe('profile-fill', () => {
  it('只在博主主页根路径上生效', () => {
    expect(isProfilePath('/alice', 'alice')).toBe(true);
    expect(isProfilePath('/Alice/', 'alice')).toBe(true);
    expect(isProfilePath('/alice/with_replies', 'alice')).toBe(false);
    expect(isProfilePath('/bob', 'alice')).toBe(false);
  });

  it('直接滚到底，没有新帖子就停', async () => {
    history.replaceState(null, '', '/alice');
    addArticles(2);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    let round = 0;
    const sleep = vi.fn(async () => {
      round += 1;
      // 前三步各加载一条，之后不再增长
      if (round <= 3) addArticles(1);
    });
    const fill = createProfileFill({ sleep });
    const result = await fill.fill('alice');
    expect(result).toEqual({ ok: true, added: 3, stopped: 'stagnant' });
    expect(scrollTo).toHaveBeenCalled();
    for (const call of scrollTo.mock.calls) {
      expect(call[0]).toMatchObject({ behavior: 'smooth' });
    }
  });

  it('调用 stop 后下一步就退出', async () => {
    history.replaceState(null, '', '/alice');
    addArticles(1);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const sleep = vi.fn(async () => {
      fill.stop();
    });
    const fill = createProfileFill({ sleep });
    const result = await fill.fill('alice');
    expect(result.stopped).toBe('user');
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('补全期间页面上常驻停止按钮，点一下就能停', async () => {
    history.replaceState(null, '', '/alice');
    addArticles(1);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const labels: string[] = [];
    const sleep = vi.fn(async () => {
      labels.push(document.querySelector(`.${PROFILE_FILL_STOP_CLASS}`)?.textContent ?? '');
      // 第二拍点停止：面板可能已经关了，页面上这个按钮是唯一入口
      if (sleep.mock.calls.length === 2) {
        document.querySelector<HTMLButtonElement>(`.${PROFILE_FILL_STOP_CLASS}`)!.click();
      }
      addArticles(1);
    });
    const fill = createProfileFill({ sleep });
    const result = await fill.fill('alice');
    expect(result.stopped).toBe('user');
    expect(labels[0]).toContain('停止补全');
    // 停下后按钮跟着撤掉，不在页面上留死按钮
    expect(document.querySelector(`.${PROFILE_FILL_STOP_CLASS}`)).toBeNull();
  });

  it('停止按钮显示本轮已经收进多少条，语言跟随界面', async () => {
    history.replaceState(null, '', '/alice');
    addArticles(1);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    // 第一次 sleep 加载两条后被看到，第二次 sleep 挂住，测试此时检查按钮再点停止
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let call = 0;
    const sleep = vi.fn(async () => {
      call += 1;
      if (call === 1) addArticles(2);
      else await gate;
    });
    const fill = createProfileFill({ sleep, getLanguage: () => 'en' });
    const running = fill.fill('alice');
    await vi.waitFor(() => {
      expect(document.querySelector(`.${PROFILE_FILL_STOP_CLASS}`)?.textContent).toBe(
        'Stop completing+2',
      );
    });
    fill.stop();
    release();
    expect((await running).stopped).toBe('user');
    expect(document.querySelector(`.${PROFILE_FILL_STOP_CLASS}`)).toBeNull();
  });

  it('status 报告是否在跑、跑到哪一条', async () => {
    history.replaceState(null, '', '/alice');
    addArticles(1);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const statuses: Array<{ running: boolean; handle: string | null; added: number }> = [];
    const fill = createProfileFill({
      sleep: async () => addArticles(1),
      onStatus: (status) => statuses.push(status),
    });
    expect(fill.status()).toMatchObject({ running: false, handle: null, last: null });
    void fill.fill('alice');
    await vi.waitFor(() => expect(statuses.some((s) => s.running)).toBe(true));
    expect(fill.status()).toMatchObject({ running: true, handle: 'alice' });
    fill.stop();
    await vi.waitFor(() => expect(fill.status().running).toBe(false));
    expect(fill.status().last?.stopped).toBe('user');
  });

  it('不在这个博主的主页时不滚动', async () => {
    history.replaceState(null, '', '/bob');
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const fill = createProfileFill({ sleep: async () => undefined });
    const result = await fill.fill('alice');
    expect(result).toEqual({ ok: false, added: 0, stopped: 'not-profile' });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('页面一直有新帖也最多滚 10 分钟', async () => {
    history.replaceState(null, '', '/alice');
    addArticles(1);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    let time = 5_000_000;
    const fill = createProfileFill({
      sleep: async () => {
        // 每步都有新帖，永远不会进入 stagnant
        time += 60_000;
        addArticles(1);
      },
      now: () => time,
    });
    const result = await fill.fill('alice');
    expect(result.stopped).toBe('limit');
    expect(time - 5_000_000).toBeGreaterThanOrEqual(PROFILE_FILL_MAX_MS);
  });

  it('中途离开这个博主的主页就停手', async () => {
    history.replaceState(null, '', '/alice');
    addArticles(1);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    let callsAtNav = -1;
    let round = 0;
    const fill = createProfileFill({
      sleep: async () => {
        round += 1;
        if (round === 2) {
          callsAtNav = scrollTo.mock.calls.length;
          history.replaceState(null, '', '/bob');
        }
      },
      now: () => 0,
    });
    const result = await fill.fill('alice');
    expect(result.ok).toBe(false);
    expect(result.stopped).toBe('not-profile');
    // 切到 /bob 之后不再滚动新页面
    expect(scrollTo.mock.calls.length).toBe(callsAtNav);
  });

  it('同一个博主 3 分钟内只补全一次', async () => {
    history.replaceState(null, '', '/alice');
    addArticles(1);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    let time = 1_000_000;
    const fill = createProfileFill({ sleep: async () => undefined, now: () => time });
    expect((await fill.fill('alice')).ok).toBe(true);
    const again = await fill.fill('alice');
    expect(again).toEqual({
      ok: false,
      added: 0,
      stopped: 'cooldown',
      retryAfterMs: PROFILE_FILL_COOLDOWN_MS,
    });
    // 冷却期内不滚动
    const calls = scrollTo.mock.calls.length;
    time += PROFILE_FILL_COOLDOWN_MS;
    expect((await fill.fill('alice')).ok).toBe(true);
    expect(scrollTo.mock.calls.length).toBeGreaterThan(calls);
  });

  it('页面在后台时不滚动，切回前台再继续', async () => {
    history.replaceState(null, '', '/alice');
    addArticles(1);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    let hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    const fill = createProfileFill({ sleep: async () => undefined, now: () => 0 });
    let scrollWhileHidden = -1;
    // 10ms 后切回前台
    const back = window.setTimeout(() => {
      scrollWhileHidden = scrollTo.mock.calls.length;
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
    }, 10);
    const result = await fill.fill('alice');
    window.clearTimeout(back);
    expect(result.ok).toBe(true);
    // 后台期间一次都没滚
    expect(scrollWhileHidden).toBe(0);
    expect(scrollTo).toHaveBeenCalled();
  });
});
