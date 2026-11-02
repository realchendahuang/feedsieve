// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProfileFill, isProfilePath } from './profile-fill';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
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

  it('不在这个博主的主页时不滚动', async () => {
    history.replaceState(null, '', '/bob');
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const fill = createProfileFill({ sleep: async () => undefined });
    const result = await fill.fill('alice');
    expect(result).toEqual({ ok: false, added: 0, stopped: 'not-profile' });
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
