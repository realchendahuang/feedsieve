// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_UI_SETTINGS } from '../settings/ui-settings';
import {
  createCleanUi,
  isFollowingTab,
  isForYouTab,
  isThinPremiumReply,
  isWhoToFollowHeading,
  moduleRoot,
  PREMIUM_REPLY_MAX_CHARS,
  whoToFollowCard,
} from './clean-ui';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function tab(text: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'tab');
  el.textContent = text;
  return el;
}

function article(options: { text: string; verified: boolean }): HTMLElement {
  const el = document.createElement('article');
  const name = document.createElement('div');
  name.setAttribute('data-testid', 'User-Name');
  name.textContent = 'someone';
  if (options.verified) {
    const icon = document.createElement('span');
    icon.setAttribute('data-testid', 'icon-verified');
    name.appendChild(icon);
  }
  const text = document.createElement('div');
  text.setAttribute('data-testid', 'tweetText');
  text.textContent = options.text;
  el.append(name, text);
  return el;
}

describe('clean-ui 选择器', () => {
  it('认出首页的「为你推荐」和「正在关注」标签', () => {
    expect(isForYouTab(tab('为你推荐'))).toBe(true);
    expect(isForYouTab(tab('For you'))).toBe(true);
    expect(isForYouTab(tab('正在关注'))).toBe(false);
    expect(isFollowingTab(tab('正在关注'))).toBe(true);
    expect(isFollowingTab(tab('Following'))).toBe(true);
    expect(isFollowingTab(tab('AI'))).toBe(false);
    expect(isForYouTab(document.createElement('div'))).toBe(false);
  });

  it('认出「推荐关注」标题（中英）', () => {
    expect(isWhoToFollowHeading(tab('推荐关注'))).toBe(true);
    expect(isWhoToFollowHeading(tab('Who to follow'))).toBe(true);
    expect(isWhoToFollowHeading(tab('X 上的直播'))).toBe(false);
  });

  it('上溯到侧栏模块根，而不是整个侧栏', () => {
    document.body.innerHTML = `
      <div data-testid="sidebarColumn">
        <div id="module-a"><div><span data-testid="trend">趋势</span></div></div>
        <div id="module-b"><div>别的模块</div></div>
      </div>`;
    const trend = document.querySelector('[data-testid="trend"]')!;
    expect(moduleRoot(trend)?.id).toBe('module-a');
    expect(moduleRoot(document.body)).toBeNull();
  });

  it('推荐关注只隐藏自己的卡片，不连坐前面的模块', () => {
    document.body.innerHTML = `
      <div data-testid="sidebarColumn">
        <div id="wrap">
          <div id="nfl"><h2 role="heading">NFL</h2><span>Browns</span></div>
          <div id="card"><h2 role="heading">推荐关注</h2><span>Qwas</span></div>
        </div>
      </div>`;
    const heading = document.querySelector('#card h2')!;
    expect(whoToFollowCard(heading)?.id).toBe('card');
  });

  it('只淡化评论区里蓝标作者的短回复', () => {
    const short = article({ text: '同意', verified: true });
    const long = article({ text: '这是一条足够长的正常回复，用来验证不会被误伤', verified: true });
    const unverified = article({ text: '同意', verified: false });
    expect(isThinPremiumReply(short, 1)).toBe(true);
    expect(isThinPremiumReply(short, 0)).toBe(false);
    expect(isThinPremiumReply(long, 1)).toBe(false);
    expect(isThinPremiumReply(unverified, 1)).toBe(false);
    const border = 'x'.repeat(PREMIUM_REPLY_MAX_CHARS);
    expect(isThinPremiumReply(article({ text: border, verified: true }), 1)).toBe(false);
  });

  it('stop 之后清干净，迟到的设置不会再改页面', async () => {
    vi.useFakeTimers();
    const listeners: Array<(changes: Record<string, unknown>, area: string) => void> = [];
    vi.stubGlobal('browser', {
      storage: {
        local: {
          get: vi.fn(async () => ({
            uiSettingsV1: { ...DEFAULT_UI_SETTINGS, cleanUi: true },
          })),
          set: vi.fn(async () => undefined),
        },
        onChanged: {
          addListener: (fn: (typeof listeners)[number]) => listeners.push(fn),
          removeListener: vi.fn(),
        },
      },
    });
    document.body.innerHTML = '<a href="/i/grok">Grok</a>';
    const clean = createCleanUi();
    clean.start();
    // 让设置读完、首屏补扫跑完
    await vi.advanceTimersByTimeAsync(2_000);
    expect(document.getElementById('feedsieve-clean-ui-styles')).toBeTruthy();
    expect(document.querySelector('a')?.getAttribute('data-fs-clean')).toBe('grok');

    clean.stop();
    expect(document.getElementById('feedsieve-clean-ui-styles')).toBeNull();
    expect(document.querySelector('a')?.hasAttribute('data-fs-clean')).toBe(false);
    expect(document.documentElement.hasAttribute('data-fs-clean-grok')).toBe(false);

    // stop 之后才送达的 storage 变化（比如读设置有延迟）不能再把页面改回去
    for (const listener of listeners) {
      listener({ uiSettingsV1: { newValue: { ...DEFAULT_UI_SETTINGS, cleanUi: true } } }, 'local');
    }
    await vi.advanceTimersByTimeAsync(2_000);
    expect(document.getElementById('feedsieve-clean-ui-styles')).toBeNull();
    expect(document.querySelector('a')?.hasAttribute('data-fs-clean')).toBe(false);
  });
});
