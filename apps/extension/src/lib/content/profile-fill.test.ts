// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProfileFill,
  isProfilePath,
  PROFILE_FILL_TARGET_POSTS,
} from './profile-fill';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

function addArticles(count: number): void {
  for (let i = 0; i < count; i++) {
    const article = document.createElement('article');
    article.setAttribute('data-testid', 'tweet');
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

  it('分步慢慢滚，没有新帖子就停', async () => {
    history.replaceState(null, '', '/alice');
    addArticles(2);
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    let round = 0;
    const sleep = vi.fn(async () => {
      round += 1;
      // 前三步各加载一条，之后不再增长
      if (round <= 3) addArticles(1);
    });
    const fill = createProfileFill({ sleep, random: () => 0.5 });
    const result = await fill.fill('alice');
    expect(result).toEqual({ ok: true, added: 3, stopped: 'stagnant' });
    // 2 条 + 3 条 = 5，远没到目标；验证停止理由是「不再增长」
    expect(PROFILE_FILL_TARGET_POSTS).toBeGreaterThan(5);
    expect(scrollBy).toHaveBeenCalled();
    // 每一步翻将近一屏，不是一次翻到底
    for (const call of scrollBy.mock.calls) {
      const top = (call[0] as { top?: number }).top ?? 0;
      expect(top).toBeGreaterThan(window.innerHeight * 0.8);
      expect(top).toBeLessThan(window.innerHeight * 1.3);
      expect(call[0]).toMatchObject({ behavior: 'smooth' });
    }
  });

  it('调用 stop 后下一步就退出', async () => {
    history.replaceState(null, '', '/alice');
    addArticles(1);
    vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const sleep = vi.fn(async () => {
      fill.stop();
    });
    const fill = createProfileFill({ sleep, random: () => 0.5 });
    const result = await fill.fill('alice');
    expect(result.stopped).toBe('user');
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('不在这个博主的主页时不滚动', async () => {
    history.replaceState(null, '', '/bob');
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    const fill = createProfileFill({ sleep: async () => undefined, random: () => 0.5 });
    const result = await fill.fill('alice');
    expect(result).toEqual({ ok: false, added: 0, stopped: 'not-profile' });
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
