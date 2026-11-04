// @vitest-environment happy-dom
// popup 渲染冒烟测试：防止「渲染期崩溃 → 白屏」再犯（曾因三态分支写错崩在 null.map）
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { PersistentBlockQueueState } from '../../src/lib/queue/block-queue-store';

let storageSet: ReturnType<typeof vi.fn>;
let runtimeSendMessage: ReturnType<typeof vi.fn>;
let tabSendMessage: ReturnType<typeof vi.fn>;
const mountedRoots: Array<{ unmount: () => void }> = [];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  for (const root of mountedRoots.splice(0)) root.unmount();
  document.body.replaceChildren();
  storageSet = vi.fn().mockResolvedValue(undefined);
  runtimeSendMessage = vi.fn().mockResolvedValue({ status: 'up_to_date' });
  tabSendMessage = vi.fn().mockResolvedValue({ blocked: [], failed: [] });
  vi.stubGlobal('browser', {
    storage: {
      local: {
        remove: vi.fn(),
        // 提供空社区快照：真实环境下无快照时 lib 会用内置名单兜底（99+ 条），
        // 会让名单 tab 徽章常驻 99、按钮文本带数字，干扰本套冒烟断言。
        get: vi
          .fn()
          .mockResolvedValue({ uiLanguage: 'zh', communitySnapshotV2: communitySnapshot([]) }),
        set: storageSet,
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1, active: true, url: 'https://x.com/home' }]),
      sendMessage: tabSendMessage,
    },
    runtime: {
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: runtimeSendMessage,
    },
  });
});

function renderApp(): HTMLElement {
  // jsdom 默认 innerHeight=768 会被判成侧边栏模式；固定成弹窗实际高度
  Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
  // 默认栏目是「洞察」；这组冒烟测试从「清理」开始
  history.replaceState(null, '', '/?view=clean');
  const rootEl = document.createElement('div');
  document.body.append(rootEl);
  const root = ReactDOM.createRoot(rootEl);
  mountedRoots.push(root);
  root.render(React.createElement(App));
  return rootEl;
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1200): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

/**
 * 视图是 React.lazy 的：点完栏目要等一次异步导入才挂上。
 * 真实定时器等宏任务；测试里开了假定时器时手动推进，不然导入永远排不上。
 */
async function waitForLazy(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('lazy view did not render');
    if (vi.isFakeTimers()) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(16);
      });
    } else {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 16));
      });
    }
  }
}

function buttonWithText(root: HTMLElement, label: string): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')].find((candidate) => {
    const clone = candidate.cloneNode(true) as HTMLElement;
    // nav 徽章（如「2名单」）不进文本匹配，避免计数干扰按钮定位
    clone.querySelectorAll('.nav-badge').forEach((badge) => badge.remove());
    return clone.textContent?.trim() === label;
  });
  if (!button) throw new Error(`button not found: ${label}`);
  return button;
}

/** 设置首页的二级入口（行文字后面带着数量，按标签名精确匹配）。 */
function navRow(root: HTMLElement, label: string): HTMLButtonElement {
  const row = [...root.querySelectorAll<HTMLButtonElement>('.nav-row')].find(
    (candidate) => candidate.querySelector('.row-label')?.textContent?.trim() === label,
  );
  if (!row) throw new Error(`settings row not found: ${label}`);
  return row;
}

/** 打开某个模块的齿轮页（tab 仍高亮该模块）。 */
async function openModuleSettings(
  root: HTMLElement,
  navLabel: string,
  gearLabel = `${navLabel}设置`,
): Promise<void> {
  await waitForLazy(() => root.querySelector('.section-nav button') !== null, 400);
  // 过滤 / AI 味 合并进了「屏蔽」：先点顶栏那一格，再点它的二级 tab
  if (['过滤', 'Filter', 'AI 味', 'AI'].includes(navLabel) && !root.querySelector('.section-subnav')) {
    const groupTab = [...root.querySelectorAll<HTMLButtonElement>('.section-nav button')].find(
      (button) => ['屏蔽', 'Block'].includes(button.textContent?.trim() ?? ''),
    );
    if (!groupTab) throw new Error('block tab not found');
    await act(async () => groupTab.click());
    await waitForLazy(() => root.querySelector('.section-subnav button') !== null);
  }
  await act(async () => buttonWithText(root, navLabel).click());
  await waitForLazy(() => root.querySelector(`button[aria-label="${gearLabel}"]`) !== null);
  await act(async () =>
    root.querySelector<HTMLButtonElement>(`button[aria-label="${gearLabel}"]`)!.click(),
  );
  await waitForLazy(() => root.querySelector('.subpage-head') !== null);
}

/** 全局页（模块开关 / 通用 / 数据与隐私 / 关于）。 */
async function openGlobal(root: HTMLElement): Promise<void> {
  await waitForLazy(() => root.querySelector('.section-nav button') !== null, 400);
  await act(async () =>
    root.querySelector<HTMLButtonElement>('.section-nav .nav-settings')!.click(),
  );
  await waitForLazy(() => root.textContent?.includes('模块开关') ?? false);
}

/** 过滤规则下的名单 / 关键词：过滤 tab → 齿轮 → 过滤规则 → 子页。 */
async function openFilterRule(root: HTMLElement, label: string): Promise<void> {
  await openModuleSettings(root, '过滤');
  await waitForLazy(() => root.textContent?.includes('过滤规则') ?? false);
  await act(async () => navRow(root, '过滤规则').click());
  await waitForLazy(() => {
    try {
      navRow(root, label);
      return true;
    } catch {
      return false;
    }
  });
  await act(async () => navRow(root, label).click());
}

/** 旧测试里的「设置 › X」路径，映射到新 IA。 */
async function openSettingsPage(root: HTMLElement, label: string): Promise<void> {
  if (['关键词', '拉黑记录', '白名单', '关注保护'].includes(label)) {
    await openFilterRule(root, label);
    return;
  }
  if (label === 'AI 味标注') {
    await openModuleSettings(root, 'AI 味');
    return;
  }
  if (label === '发帖辅助') {
    await openModuleSettings(root, '发帖');
    return;
  }
  if (label === '数据与隐私') {
    await openGlobal(root);
    await act(async () => navRow(root, '数据与隐私').click());
    return;
  }
  if (label === '语言与关于') {
    await openGlobal(root);
    return;
  }
  throw new Error(`unknown settings page: ${label}`);
}

function personalConfigFile(customPhrase = '迁移关键词'): File {
  return new File(
    [
      JSON.stringify({
        format: 'feedsieve-personal-config',
        schemaVersion: 1,
        exportedAt: '2026-09-02T00:00:00.000Z',
        keywordRules: {
          customPhrases: [customPhrase],
          knownCategoryIds: ['adult_gray_traffic'],
          subscribedCategoryIds: ['adult_gray_traffic'],
          disabledOfficialRuleIds: [],
        },
        preferences: { uiLanguage: 'zh', communityEnabled: true, markStrength: 'standard' },
      }),
    ],
    'feedsieve-personal-config.json',
    { type: 'application/json' },
  );
}

function communitySnapshot(
  handles: Array<{ handle: string; maintainer?: boolean }>,
  options: { killSwitch?: unknown } = {},
) {
  return {
    snapshot_version: '2026.09.02.7',
    synced_at: Date.now(),
    body: JSON.stringify({
      schema_version: 2,
      snapshot_version: '2026.09.02.7',
      generated_at: '2026-09-02T00:00:00.000Z',
      entries: handles.map(({ handle, maintainer }) => ({
        handle,
        x_user_id: null,
        aliases: [],
        category: 'bot_spam',
        sources: maintainer ? ['maintainer'] : ['community'],
        ...(maintainer ? { maintainer_note: '维护者确认的垃圾账号' } : {}),
        community_score: maintainer ? 0 : 0.5,
        report_count: maintainer ? 0 : 3,
        rescue_count: 0,
        net_votes: maintainer ? 0 : 3,
        first_seen_at: '2026-09-02T00:00:00.000Z',
        updated_at: '2026-09-02T00:00:00.000Z',
        evidence_post_ids: [],
      })),
      ...(options.killSwitch !== undefined ? { kill_switch: options.killSwitch } : {}),
    }),
  };
}

function whitelistSnapshot(entry: { handle: string; note: string }): {
  snapshot_version: string;
  synced_at: number;
  body: string;
} {
  return {
    snapshot_version: '2026.09.12.1',
    synced_at: Date.now(),
    body: JSON.stringify({
      schema_version: 2,
      snapshot_version: '2026.09.12.1',
      generated_at: '2026-09-12T00:00:00.000Z',
      entries: [],
      verified: [],
      whitelist: [
        {
          handle: entry.handle,
          x_user_id: null,
          note: entry.note,
          added_at: '2026-09-12T00:00:00.000Z',
        },
      ],
    }),
  };
}

async function chooseFile(input: HTMLInputElement, file: File): Promise<void> {
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe('popup App 渲染冒烟', () => {
  it('automatically clears transient notices', async () => {
    const rootEl = renderApp();
    // 先按真实定时器把按需加载的视图挂上，再切到假定时器测「提示自动消失」
    await openSettingsPage(rootEl, '关键词');
    const syncButton = rootEl.querySelector<HTMLButtonElement>('button[aria-label="同步词库"]');
    if (!syncButton) throw new Error('keyword-pack sync button not found');

    vi.useFakeTimers();
    try {
      await act(async () => {
        syncButton.click();
        await Promise.resolve();
      });

      expect(rootEl.textContent).toContain('词库已同步');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });
      expect(rootEl.textContent).not.toContain('词库已同步');
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens on the profile view when the active tab is a creator profile', async () => {
    (browser.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, active: true, url: 'https://x.com/alice' },
    ]);
    // renderApp 固定带 ?view=clean（链接指定了视图就照旧）；这里模拟直接点开扩展图标
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
    history.replaceState(null, '', '/');
    const rootEl = document.createElement('div');
    document.body.append(rootEl);
    const root = ReactDOM.createRoot(rootEl);
    mountedRoots.push(root);
    await act(async () => {
      root.render(React.createElement(App));
    });
    await waitForCondition(
      () => rootEl.querySelector('.section-nav .is-active')?.textContent === '主页',
    );
    expect(rootEl.querySelector('.section-nav .is-active')?.textContent).toBe('主页');
    // 判断完之前不渲染热帖：热帖页的工具栏一次都没出现过
    expect(rootEl.querySelector('.hot-view')).toBeNull();
  });

  it('renders header and empty page-marked hint without throwing', async () => {
    const rootEl = renderApp();
    // 等 storage/tabs 异步 resolve 完成（加载态「…」过渡到空态提示）
    await waitForLazy(() => rootEl.textContent?.includes('本页没有标黄的账号') ?? false);

    // 顶部只有栏目，不放商标和名字
    expect(rootEl.querySelector('.masthead')?.textContent).not.toContain('福滤娃');
    expect(rootEl.querySelector('.masthead img')).toBeNull();
    expect(rootEl.textContent).toContain('本页标黄');
    expect(rootEl.textContent).toContain('本页没有标黄的账号');
    expect(rootEl.textContent).toContain('社区黑名单');
    const nav = [...rootEl.querySelectorAll('.section-nav button')].map(
      (button) => button.getAttribute('aria-label') ?? button.textContent,
    );
    expect(nav).toEqual(['热帖', '主页', '发帖', '屏蔽', '周刊', '全局']);
    expect(
      [...rootEl.querySelectorAll('.section-subnav button')].map((button) => button.textContent),
    ).toEqual(['过滤', 'AI 味', '静音']);

    await openSettingsPage(rootEl, '关键词');
    expect(rootEl.textContent).toContain('官方预置词库');
    expect(rootEl.textContent).toContain('黄推 / 成人引流');

    const adultToggle = rootEl.querySelector<HTMLInputElement>(
      'input[role="switch"][aria-label^="黄推 / 成人引流"]',
    );
    expect(adultToggle?.checked).toBe(true);
    await act(async () => adultToggle?.click());
    expect(adultToggle?.checked).toBe(false);

    const adultTitle = [...rootEl.querySelectorAll<HTMLButtonElement>('.disclosure')].find(
      (button) => button.textContent?.includes('黄推 / 成人引流'),
    );
    await act(async () => adultTitle?.click());
    expect(rootEl.textContent).toContain('同城上门约炮');

    // 全局页：模块开关 + 通用 + 数据与隐私 + 关于
    await openGlobal(rootEl);
    for (const label of ['模块开关', '通用', '分享菜单', '界面语言', '数据与隐私', '关于'])
      expect(rootEl.textContent).toContain(label);

    // 每个模块的齿轮页就是它自己的配置
    await openModuleSettings(rootEl, 'AI 味');
    const aiToggle = rootEl.querySelector<HTMLInputElement>(
      'input[role="switch"][aria-label="AI 味标注"]',
    );
    expect(aiToggle?.checked).toBe(true);
    await act(async () => {
      aiToggle?.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(storageSet).toHaveBeenCalledWith({
      moduleSettingsV1: expect.objectContaining({ aiCheck: false }),
    });

    await openModuleSettings(rootEl, '发帖');
    const composeToggle = rootEl.querySelector<HTMLInputElement>(
      'input[role="switch"][aria-label="发帖辅助"]',
    );
    expect(composeToggle?.checked).toBe(true);
    await act(async () => {
      composeToggle?.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(storageSet).toHaveBeenCalledWith({
      composeScheduleV1: expect.objectContaining({ composeHelper: false, articleHelper: false }),
    });

    // 全局 → 通用 里切英文
    await openGlobal(rootEl);
    await act(async () => buttonWithText(rootEl, 'EN').click());
    expect(rootEl.textContent).toContain('Modules');
    // 过滤齿轮页 → 过滤规则确认英文文案
    await openModuleSettings(rootEl, 'Filter', 'Filter settings');
    await act(async () => navRow(rootEl, 'Filter rules').click());
    expect(rootEl.textContent).toContain('Detection level');
  });

  it('屏蔽二级 tab：过滤 / AI 味 / 静音，切走再切回停在原处', async () => {
    const rootEl = renderApp();
    await waitForLazy(() => rootEl.querySelector('.section-subnav button') !== null);

    const subnavLabels = (): (string | null)[] =>
      [...rootEl.querySelectorAll('.section-subnav button')].map((button) => button.textContent);
    const activeSubtab = (): string | null | undefined =>
      rootEl.querySelector('.section-subnav .is-active')?.textContent;

    expect(subnavLabels()).toEqual(['过滤', 'AI 味', '静音']);
    expect(activeSubtab()).toBe('过滤');

    // 切到静音：顶栏仍停在「屏蔽」
    await act(async () => buttonWithText(rootEl, '静音').click());
    await waitForLazy(() => activeSubtab() === '静音');
    expect(rootEl.querySelector('.section-nav .is-active')?.textContent).toBe('屏蔽');

    // 切到别的栏目再回「屏蔽」：停在刚才的静音
    await act(async () => buttonWithText(rootEl, '热帖').click());
    await waitForLazy(() => rootEl.querySelector('.section-subnav') === null);
    await act(async () => buttonWithText(rootEl, '屏蔽').click());
    await waitForLazy(() => activeSubtab() === '静音');
    expect(activeSubtab()).toBe('静音');
  });

  it('关闭模块后 tab 立即消失', async () => {
    const rootEl = renderApp();
    await openGlobal(rootEl);
    const hotSwitch = rootEl.querySelector<HTMLInputElement>(
      'input[role="switch"][aria-label="热帖"]',
    )!;
    await act(async () => {
      hotSwitch.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    const nav = [...rootEl.querySelectorAll('.section-nav button')].map(
      (button) => button.getAttribute('aria-label') ?? button.textContent,
    );
    expect(nav).not.toContain('热帖');
    expect(nav).toContain('全局');
    expect(rootEl.querySelector('.section-nav .is-active')?.getAttribute('aria-label')).toBe(
      '全局',
    );
  });

  it('发帖节奏：发帖辅助二级页里改每小时条数写回本机', async () => {
    const rootEl = renderApp();
    await new Promise((r) => setTimeout(r, 150));
    await openSettingsPage(rootEl, '发帖辅助');
    expect(rootEl.textContent).toContain('集中时段');
    expect(rootEl.textContent).toContain('本周最多');

    const perHour = rootEl.querySelector<HTMLSelectElement>('select[aria-label="每小时最多"]');
    if (!perHour) throw new Error('per-hour select not found');
    await act(async () => {
      perHour.value = '2';
      perHour.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(storageSet).toHaveBeenCalledWith({
      composeScheduleV1: expect.objectContaining({
        windows: expect.arrayContaining([expect.objectContaining({ perHour: 2 })]),
      }),
    });

    // 返回上一层回到「发帖」页
    await act(async () => rootEl.querySelector<HTMLButtonElement>('.back-button')!.click());
    expect(rootEl.querySelector('.write-view')).not.toBeNull();
  });

  it('白名单 tab 手动添加账号：写入本地白名单并显示瞬时反馈', async () => {
    const rootEl = renderApp();
    await new Promise((r) => setTimeout(r, 150));
    await openSettingsPage(rootEl, '白名单');

    const input = rootEl.querySelector<HTMLInputElement>('#allowlist-handle');
    if (!input) throw new Error('allowlist input not found');
    // React 受控输入必须走原生 value setter 再派发 input 事件，直接赋值不触发 onChange
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      valueSetter?.call(input, '@MyHero88');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      buttonWithText(rootEl, '添加').click();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(storageSet).toHaveBeenCalledWith({
      allowlist: [expect.objectContaining({ handle: 'myhero88' })],
    });
    expect(rootEl.textContent).toContain('已加入白名单 @myhero88');
  });

  it('renders a real hover help overlay instead of relying on a native title', async () => {
    const rootEl = renderApp();
    await new Promise((r) => setTimeout(r, 150));

    await openSettingsPage(rootEl, '关键词');
    const helpIcon = rootEl.querySelector<HTMLElement>(
      '[aria-label="命中会标黄，是否拉黑由你决定。"]',
    );
    if (!helpIcon) throw new Error('community help icon not found');

    await act(async () => {
      helpIcon.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain('命中会标黄');

    await act(async () => {
      helpIcon.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('renders page-marked accounts after querying the active x.com tab', async () => {
    vi.stubGlobal('browser', {
      storage: {
        local: {
          remove: vi.fn(),
          get: vi.fn().mockResolvedValue({ uiLanguage: 'zh' }),
          set: vi.fn().mockResolvedValue(undefined),
        },
        onChanged: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, active: true, url: 'https://x.com/home' }]),
        // 页面黄框清单：内容脚本实时查询返回（communityHitReason 新句式）
        sendMessage: vi
          .fn()
          .mockResolvedValue([
            { handle: 'spamking88', category: 'copy_paste', reason: '3 人标记 · 重复刷屏' },
          ]),
      },
      runtime: {
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: vi.fn().mockResolvedValue({ status: 'up_to_date' }),
      },
    });

    const rootEl = renderApp();
    await waitForCondition(() => rootEl.textContent?.includes('@spamking88') ?? false);

    expect(rootEl.textContent).toContain('@spamking88');
    // 理由里和类别标签重复的那一段去掉
    expect(rootEl.querySelector('.category-tag')?.textContent).toBe('重复刷屏');
    expect(rootEl.querySelector('.reason-text')?.textContent).toBe('3 人标记');
    expect(rootEl.querySelector('.primary-button')?.textContent).toBe('拉黑 1 个');
  });

  it('shows the community blocklist as one row and queues every eligible account', async () => {
    const snapshot = communitySnapshot([
      { handle: 'three_votes' },
      { handle: 'maintained', maintainer: true },
    ]);
    vi.stubGlobal('browser', {
      storage: {
        local: {
          remove: vi.fn(),
          get: vi.fn().mockResolvedValue({ uiLanguage: 'zh', communitySnapshotV2: snapshot }),
          set: vi.fn().mockResolvedValue(undefined),
        },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, active: true, url: 'https://x.com/home' }]),
        sendMessage: tabSendMessage,
      },
      runtime: {
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: runtimeSendMessage,
      },
    });

    const rootEl = renderApp();
    await new Promise((resolve) => setTimeout(resolve, 150));
    // 社区黑名单只占一行：数量 + 全部拉黑，不再逐条列出
    expect(rootEl.textContent).toContain('2 个未拉黑');
    expect(rootEl.textContent).not.toContain('@three_votes');

    await act(async () => {
      buttonWithText(rootEl, '全部拉黑').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      // 全部拉黑需要二次确认
      buttonWithText(rootEl, '再点一次：拉黑 2 个').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(tabSendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        type: 'feedsieve:community-block-start',
        items: [
          { handle: 'three_votes', category: 'bot_spam' },
          { handle: 'maintained', category: 'bot_spam' },
        ],
      }),
    );
  });

  it('never sends cleanup actions to a background X tab', async () => {
    const snapshot = communitySnapshot([{ handle: 'three_votes' }]);
    vi.stubGlobal('browser', {
      storage: {
        local: {
          remove: vi.fn(),
          get: vi.fn().mockResolvedValue({ uiLanguage: 'zh', communitySnapshotV2: snapshot }),
          set: storageSet,
        },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([
          { id: 1, active: true, url: 'https://example.com/' },
          { id: 2, active: false, url: 'https://x.com/home' },
        ]),
        sendMessage: tabSendMessage,
      },
      runtime: {
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: runtimeSendMessage,
      },
    });

    const rootEl = renderApp();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await act(async () => {
      buttonWithText(rootEl, '全部拉黑').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      buttonWithText(rootEl, '再点一次：拉黑 1 个').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(tabSendMessage).not.toHaveBeenCalled();
    expect(rootEl.textContent).toContain('请先打开或刷新 x.com');
  });

  it('starts with community uploads enabled and exposes local-only as an opt-out', async () => {
    const rootEl = renderApp();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await openGlobal(rootEl);
    await act(async () => navRow(rootEl, '数据与隐私').click());
    const row = [...rootEl.querySelectorAll<HTMLElement>('.row')].find((candidate) =>
      candidate.textContent?.includes('仅本地运行'),
    );
    const input = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(input).toBeTruthy();
    expect(input?.checked).toBe(false);
    await act(async () => {
      input?.click();
      await Promise.resolve();
    });
    expect(storageSet).toHaveBeenCalledWith({
      communitySettings: expect.objectContaining({ autoContribute: false }),
    });
  });

  it('global hot list sharing is its own switch and locks when local-only mode is on', async () => {
    const rootEl = renderApp();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await openGlobal(rootEl);
    await act(async () => navRow(rootEl, '数据与隐私').click());
    const rowInput = (label: string) =>
      [...rootEl.querySelectorAll<HTMLElement>('.row')]
        .find((row) => row.textContent?.includes(label))
        ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const hot = rowInput('参与全站热榜');
    expect(hot?.checked).toBe(true);
    expect(hot?.disabled).toBe(false);
    await act(async () => {
      hot?.click();
      await Promise.resolve();
    });
    expect(storageSet).toHaveBeenCalledWith({
      communitySettings: expect.objectContaining({ hotContribute: false, autoContribute: true }),
    });
    // 打开「仅本地运行」：全站热榜开关显示为关闭并锁住
    await act(async () => {
      rowInput('仅本地运行')?.click();
      await Promise.resolve();
    });
    expect(rowInput('参与全站热榜')?.disabled).toBe(true);
    expect(rowInput('参与全站热榜')?.checked).toBe(false);
  });

  it('previews a personal config before applying only local preference storage', async () => {
    const rootEl = renderApp();
    await new Promise((r) => setTimeout(r, 150));
    await openGlobal(rootEl);
    await act(async () => navRow(rootEl, '数据与隐私').click());

    expect(rootEl.textContent).toContain('备份与迁移');
    expect(rootEl.textContent).toContain('导出');
    expect(rootEl.textContent).toContain('导入');

    const input = rootEl.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('personal config input not found');
    await chooseFile(input, personalConfigFile());

    expect(rootEl.textContent).toContain('导入预览');
    expect(rootEl.textContent).toContain('自定义关键词：备份 1 条，导入后 1 条');
    expect(rootEl.textContent).toContain('保留备份中的 1 条，移除本机独有 0 条');
    expect(rootEl.textContent).toContain('合并导入');
    expect(rootEl.textContent).toContain('替换导入');

    await act(async () => buttonWithText(rootEl, '取消').click());
    expect(rootEl.textContent).not.toContain('导入预览');

    await chooseFile(input, personalConfigFile());

    const initialRuntimeCalls = runtimeSendMessage.mock.calls.length;
    const initialTabCalls = tabSendMessage.mock.calls.length;
    await act(async () => {
      buttonWithText(rootEl, '合并导入').click();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(storageSet).toHaveBeenCalledWith(
      expect.objectContaining({ keywordRulesV1: expect.anything() }),
    );
    expect(storageSet).toHaveBeenCalledWith(
      expect.objectContaining({ communitySettings: expect.anything() }),
    );
    expect(storageSet).toHaveBeenCalledWith({ uiLanguage: 'zh' });
    // 「我的」页（会引导生成安装 ID）已移除：导入配置不应再顺带写安装 ID
    expect(storageSet.mock.calls.filter(([value]) => 'installationId' in value).length).toBe(0);
    expect(runtimeSendMessage).toHaveBeenCalledTimes(initialRuntimeCalls);
    expect(tabSendMessage).toHaveBeenCalledTimes(initialTabCalls);
    expect(rootEl.textContent).toContain('仅本地设置已更新');
  });

  it('shows invalid-file feedback and can replace the scoped local configuration', async () => {
    const rootEl = renderApp();
    await new Promise((r) => setTimeout(r, 150));
    await openGlobal(rootEl);
    await act(async () => navRow(rootEl, '数据与隐私').click());

    const input = rootEl.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('personal config input not found');
    await chooseFile(input, new File(['{'], 'broken.json', { type: 'application/json' }));
    expect(rootEl.textContent).toContain('这不是可导入的福滤娃个人配置');

    await chooseFile(input, personalConfigFile('替换关键词'));
    await act(async () => {
      buttonWithText(rootEl, '替换导入').click();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(storageSet).toHaveBeenCalledWith(
      expect.objectContaining({ keywordRulesV1: expect.anything() }),
    );
    expect(storageSet).toHaveBeenCalledWith(
      expect.objectContaining({ communitySettings: expect.anything() }),
    );
    expect(storageSet).toHaveBeenCalledWith({ uiLanguage: 'zh' });
    expect(storageSet.mock.calls.filter(([value]) => 'installationId' in value).length).toBe(0);
    expect(rootEl.textContent).toContain('仅本地设置已更新');
  });

  it('renders the backup controls with English copy when English is the local preference', async () => {
    const get = browser.storage.local.get as ReturnType<typeof vi.fn>;
    get.mockResolvedValue({ uiLanguage: 'en' });
    const rootEl = renderApp();
    await new Promise((r) => setTimeout(r, 150));
    await act(async () =>
      rootEl.querySelector<HTMLButtonElement>('.section-nav .nav-settings')!.click(),
    );
    await waitForLazy(() => rootEl.textContent?.includes('Modules') ?? false);
    await act(async () => navRow(rootEl, 'Data & privacy').click());

    expect(rootEl.textContent).toContain('Backup & migration');
    expect(rootEl.textContent).toContain('Export');
    expect(rootEl.textContent).toContain('Import');
  });

  it('官方暂停开关生效时禁用拉黑入口并显示理由', async () => {
    const snapshot = communitySnapshot([{ handle: 'three_votes' }], {
      killSwitch: {
        destructive_actions_disabled: true,
        reason: '接口排查中',
        disabled_since: '2026-09-07T00:00:00Z',
      },
    });
    vi.stubGlobal('browser', {
      storage: {
        local: {
          remove: vi.fn(),
          get: vi.fn().mockResolvedValue({ uiLanguage: 'zh', communitySnapshotV2: snapshot }),
          set: vi.fn().mockResolvedValue(undefined),
        },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, active: true, url: 'https://x.com/home' }]),
        sendMessage: tabSendMessage,
      },
      runtime: {
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: runtimeSendMessage,
      },
    });

    const rootEl = renderApp();
    // Wait for observable async state, not machine-dependent fixed rendering latency.
    await vi.waitFor(() => {
      expect(rootEl.textContent).toContain('维护者已暂停拉黑：接口排查中');
    });
    // 社区批量入口本来可用（有合格条目），降级后必须禁用
    expect(buttonWithText(rootEl, '全部拉黑').disabled).toBe(true);
  });

  it('Block 接口能力失败时禁用拉黑入口并显示降级提示', async () => {
    const caps = {
      sessionUsable: true,
      csrfAvailable: true,
      block: 'failed',
      unblock: 'unknown',
      userIdResolution: 'unknown',
      timelineParsing: 'unknown',
      updatedAt: 0,
    };
    vi.stubGlobal('browser', {
      storage: {
        local: {
          remove: vi.fn(),
          get: vi.fn().mockResolvedValue({ uiLanguage: 'zh' }),
          set: vi.fn().mockResolvedValue(undefined),
        },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, active: true, url: 'https://x.com/home' }]),
        sendMessage: vi.fn().mockResolvedValue(caps),
      },
      runtime: {
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: runtimeSendMessage,
      },
    });

    const rootEl = renderApp();
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(rootEl.textContent).toContain('拉黑接口暂不可用');
    expect(buttonWithText(rootEl, '全部拉黑').disabled).toBe(true);
  });

  it('能力快照正常时（working）不显示降级提示', async () => {
    vi.stubGlobal('browser', {
      storage: {
        local: {
          remove: vi.fn(),
          get: vi.fn().mockResolvedValue({ uiLanguage: 'zh' }),
          set: vi.fn().mockResolvedValue(undefined),
        },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, active: true, url: 'https://x.com/home' }]),
        sendMessage: vi.fn().mockResolvedValue({
          sessionUsable: true,
          csrfAvailable: true,
          block: 'working',
          unblock: 'working',
          userIdResolution: 'working',
          timelineParsing: 'working',
          updatedAt: 0,
        }),
      },
      runtime: {
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: runtimeSendMessage,
      },
    });

    const rootEl = renderApp();
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(rootEl.textContent).not.toContain('拉黑接口暂不可用');
  });

  it('页面批量拉黑队列完成后重新拉取黄框，「一键拉黑全部」随真实剩余禁用', async () => {
    const snapshot = communitySnapshot([{ handle: 'three_votes' }]);
    // push 模式收集所有 addListener 注册的回调：popup 同时订阅队列与安全账本等多个 storage 通道，
    // 单槽位 holder 会让后注册的订阅顶掉队列回调（真实浏览器是 N 个监听器并存）
    const queueListeners: Array<(changes: Record<string, unknown>, areaName: string) => void> = [];
    const fireStorageChange = (changes: Record<string, unknown>): void => {
      for (const listener of queueListeners) listener(changes, 'local');
    };
    let storedQueue: PersistentBlockQueueState | null = null;
    vi.stubGlobal('browser', {
      storage: {
        local: {
          remove: vi.fn(),
          get: vi.fn(() => {
            const base: Record<string, unknown> = {
              uiLanguage: 'zh',
              communitySnapshotV2: snapshot,
            };
            if (storedQueue) base.persistentBlockQueueV1 = storedQueue;
            return Promise.resolve(base);
          }),
          set: vi.fn().mockResolvedValue(undefined),
        },
        onChanged: {
          addListener: vi.fn(
            (listener: (changes: Record<string, unknown>, areaName: string) => void) => {
              queueListeners.push(listener);
            },
          ),
          removeListener: vi.fn(),
        },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, active: true, url: 'https://x.com/home' }]),
        sendMessage: tabSendMessage,
      },
      runtime: {
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: runtimeSendMessage,
      },
    });

    // 首屏：页面有 3 个黄框 → 按钮可用并带计数
    tabSendMessage.mockResolvedValue([
      { handle: 'alpha', category: 'bot_spam', reason: 'r' },
      { handle: 'bravo', category: 'bot_spam', reason: 'r' },
      { handle: 'charlie', category: 'bot_spam', reason: 'r' },
    ]);
    const rootEl = renderApp();
    await new Promise((resolve) => setTimeout(resolve, 150));

    const blockAll = rootEl.querySelector<HTMLButtonElement>('.primary-button');
    expect(blockAll?.disabled).toBe(false);
    expect(blockAll?.textContent).toBe('拉黑 3 个');

    // 队列写入 running → 按钮仍禁用（进行中）；完成后重新拉黄框 → 已清空 → 放行并禁用
    storedQueue = {
      id: 'q1',
      source: 'page-batch',
      status: 'running',
      tasks: [],
      createdAt: 0,
      updatedAt: 0,
    };
    fireStorageChange({ persistentBlockQueueV1: {} });
    await new Promise((resolve) => setTimeout(resolve, 30));

    tabSendMessage.mockResolvedValueOnce([]);
    storedQueue = { ...storedQueue!, status: 'completed', updatedAt: 1 };
    fireStorageChange({ persistentBlockQueueV1: {} });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const refreshCalls = tabSendMessage.mock.calls.filter(
      ([, message]) =>
        Object.prototype.hasOwnProperty.call(message, 'type') &&
        (message as { type: string }).type === 'feedsieve:page-marked-list',
    );
    expect(refreshCalls.length).toBeGreaterThanOrEqual(2);
    // 清空后主按钮随列表一起消失，显示空态
    expect(rootEl.querySelector('.primary-button')).toBeNull();
    expect(rootEl.textContent).toContain('本页没有标黄的账号');
  });

  it('社区清理队列收尾有失败项时，如实展示失败原因而不是让按钮无声重试', async () => {
    const snapshot = communitySnapshot([{ handle: 'cndon91', maintainer: true }]);
    const failedQueue: PersistentBlockQueueState = {
      id: 'q2',
      source: 'community-batch',
      status: 'completed',
      tasks: [
        {
          handle: 'cndon91',
          category: 'adult_gray_traffic',
          status: 'failed',
          failureCode: 'no-id',
          lastErrorCode: 'no-id',
        },
      ],
      createdAt: 0,
      updatedAt: 1,
    };
    vi.stubGlobal('browser', {
      storage: {
        local: {
          remove: vi.fn(),
          get: vi.fn().mockResolvedValue({
            uiLanguage: 'zh',
            communitySnapshotV2: snapshot,
            persistentBlockQueueV1: failedQueue,
          }),
          set: vi.fn().mockResolvedValue(undefined),
        },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, active: true, url: 'https://x.com/home' }]),
        sendMessage: tabSendMessage,
      },
      runtime: {
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: runtimeSendMessage,
      },
    });

    const rootEl = renderApp();
    await new Promise((resolve) => setTimeout(resolve, 150));
    // 失败条目与原因如实展示，避免「怎么都清不掉」的无声死循环
    expect(rootEl.textContent).toContain('@cndon91');
    expect(rootEl.textContent).toContain('缺少用户 ID');
    // 剩余可清理条目仍在，可重试
    expect(buttonWithText(rootEl, '全部拉黑').disabled).toBe(false);
  });

  it('额度用尽暂停时给友情提醒，点「仍要继续」显式放行本轮', async () => {
    const pausedQueue: PersistentBlockQueueState = {
      id: 'q4',
      source: 'community-batch',
      status: 'paused',
      pauseReason: 'quota_exhausted',
      tasks: [
        { handle: 'cndon91', category: 'adult_gray_traffic', status: 'pending' },
        { handle: 'spamking88', category: 'bot_spam', status: 'success' },
      ],
      createdAt: 0,
      updatedAt: 1,
    };
    vi.stubGlobal('browser', {
      storage: {
        local: {
          remove: vi.fn(),
          get: vi.fn().mockResolvedValue({
            uiLanguage: 'zh',
            persistentBlockQueueV1: pausedQueue,
          }),
          set: vi.fn().mockResolvedValue(undefined),
        },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, active: true, url: 'https://x.com/home' }]),
        sendMessage: tabSendMessage,
      },
      runtime: {
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: runtimeSendMessage,
      },
    });

    const rootEl = renderApp();
    // 等可观察的状态，不靠固定延迟：全量校验并发高时 150ms 不一定够
    await vi.waitFor(() => expect(rootEl.textContent).toContain('今日额度已用完'));
    // 友情提醒：额度到顶 + 风险提示；不再是「只能明天继续」的硬规定
    expect(rootEl.textContent).toContain('今日额度已用完（400/24 小时）');
    expect(rootEl.textContent).toContain('仍要继续可以，但被 X 临时限制的风险会变高');
    await act(async () => buttonWithText(rootEl, '仍要继续').click());
    expect(tabSendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: 'feedsieve:block-queue-resume' }),
    );
  });

  it('页面批量收尾有失败项时，在当前页面卡片如实展示原因（账号已消失与解析失败分开）', async () => {
    const failedQueue: PersistentBlockQueueState = {
      id: 'q3',
      source: 'page-batch',
      status: 'completed',
      tasks: [
        {
          handle: 'mtzntzvcuuvan5',
          category: 'adult_gray_traffic',
          status: 'failed',
          failureCode: 'no_user',
          lastErrorCode: 'no_user',
        },
        {
          handle: 'petersulli92sm',
          category: 'adult_gray_traffic',
          status: 'failed',
          failureCode: 'rate_limited',
          lastErrorCode: 'rate_limited',
        },
      ],
      createdAt: 0,
      updatedAt: 1,
    };
    vi.stubGlobal('browser', {
      storage: {
        local: {
          remove: vi.fn(),
          get: vi.fn().mockResolvedValue({
            uiLanguage: 'zh',
            persistentBlockQueueV1: failedQueue,
          }),
          set: vi.fn().mockResolvedValue(undefined),
        },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, active: true, url: 'https://x.com/search' }]),
        sendMessage: tabSendMessage,
      },
      runtime: {
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: runtimeSendMessage,
      },
    });

    const rootEl = renderApp();
    await new Promise((resolve) => setTimeout(resolve, 150));

    // 死账号与瞬时失败语义分开：前者不用重试，后者等待重试
    expect(rootEl.textContent).toContain('@mtzntzvcuuvan5账号已不存在');
    expect(rootEl.textContent).toContain('@petersulli92sm请求过于频繁');
  });

  it('white-list tab 底部推荐白名单默认折叠，展开后展示维护者背书理由', async () => {
    vi.stubGlobal('browser', {
      storage: {
        local: {
          remove: vi.fn(),
          get: vi.fn().mockResolvedValue({
            uiLanguage: 'zh',
            communitySnapshotV2: whitelistSnapshot({
              handle: 'goodactor',
              note: '知名科普博主，多次被模板误标，复核为正常账号',
            }),
          }),
          set: storageSet,
        },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, active: true, url: 'https://x.com/home' }]),
        sendMessage: tabSendMessage,
      },
      runtime: {
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: runtimeSendMessage,
      },
    });

    const rootEl = renderApp();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await openSettingsPage(rootEl, '白名单');

    // 折叠态：标题行带数量，备注未展开
    const toggle = rootEl.querySelector<HTMLButtonElement>('.disclosure');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.textContent).toContain('推荐白名单');
    expect(toggle?.textContent).toContain('1');
    expect(rootEl.textContent).not.toContain('知名科普博主');

    await act(async () => toggle?.click());
    expect(rootEl.querySelector('.account-note')?.textContent).toBe(
      '知名科普博主，多次被模板误标，复核为正常账号',
    );
  });

  it('支持在当前页面卡片浏览推文帖子正文，并可移除误伤项后再一键拉黑', async () => {
    vi.stubGlobal('browser', {
      storage: {
        local: {
          remove: vi.fn(),
          get: vi.fn().mockResolvedValue({ uiLanguage: 'zh' }),
          set: vi.fn().mockResolvedValue(undefined),
        },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, active: true, url: 'https://x.com/home' }]),
        sendMessage: tabSendMessage,
      },
      runtime: {
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: runtimeSendMessage,
      },
    });

    tabSendMessage.mockImplementation(async (_tabId, msg) => {
      if ((msg as { type: string }).type === 'feedsieve:page-marked-list') {
        return [
          {
            handle: 'spam_queen',
            displayName: '小甜甜 🌸',
            category: 'adult_gray_traffic',
            reason: '色情引流',
            snippet: '哥哥看我置顶私聊',
          },
          {
            handle: 'normal_user',
            displayName: '普通博主',
            category: 'other',
            reason: '可疑关键词',
            snippet: '这是一条正常的讨论',
          },
        ];
      }
      if ((msg as { type: string }).type === 'feedsieve:run-page-block') {
        return { status: 'started', count: 1 };
      }
      return undefined;
    });

    const rootEl = renderApp();
    await waitForCondition(() => rootEl.textContent?.includes('小甜甜 🌸') ?? false);

    // 帖子正文与昵称直接可见，供用户快速辨识
    expect(rootEl.textContent).toContain('小甜甜 🌸');
    expect(rootEl.textContent).toContain('哥哥看我置顶私聊');
    expect(rootEl.textContent).toContain('普通博主');
    expect(rootEl.textContent).toContain('这是一条正常的讨论');

    const primaryBtn = rootEl.querySelector<HTMLButtonElement>('.primary-button');
    expect(primaryBtn?.textContent).toBe('拉黑 2 个');

    // 用户快速移除误伤的 normal_user
    const excludeBtns = rootEl.querySelectorAll<HTMLButtonElement>('button[aria-label^="移除"]');
    expect(excludeBtns.length).toBe(2);
    await act(async () => {
      excludeBtns[1]?.click(); // 移除第 2 个（normal_user）
    });

    // 移除后整行离开清单，其余按钮文案联动为选中的 1 个
    const reviewedRows = [...rootEl.querySelectorAll('.marked-list li')];
    expect(reviewedRows.some((row) => row.textContent?.includes('normal_user'))).toBe(false);
    // 移除专属账号后没有另行勾选，按钮回到「全部 · 剩余数」
    expect(primaryBtn?.textContent).toBe('拉黑 1 个');

    // 点击一键拉黑，校验只发出了未移除的账号
    await act(async () => {
      primaryBtn?.click();
    });

    const blockCalls = tabSendMessage.mock.calls.filter(
      ([, msg]) => (msg as { type: string }).type === 'feedsieve:run-page-block',
    );
    expect(blockCalls.length).toBe(1);
    expect((blockCalls[0]?.[1] as { handles: string[] } | undefined)?.handles).toEqual([
      'spam_queen',
    ]);
  });
  it('旧链接参数落到新位置：名单 › 拉黑记录进设置二级页，默认打开热帖', async () => {
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
    history.replaceState(null, '', '/?view=lists&list=blocked');
    const rootEl = document.createElement('div');
    document.body.append(rootEl);
    const root = ReactDOM.createRoot(rootEl);
    mountedRoots.push(root);
    await act(async () => root.render(React.createElement(App)));
    await waitForCondition(() => rootEl.querySelector('.subpage-head') !== null);
    expect(rootEl.querySelector('.subpage-head h2')?.textContent).toBe('拉黑记录');
    expect(rootEl.querySelector('.section-nav .is-active')?.textContent).toBe('屏蔽');
    expect(rootEl.querySelector('.section-subnav .is-active')?.textContent).toBe('过滤');

    // 返回「过滤规则」→「过滤设置」→ 过滤页
    await act(async () => rootEl.querySelector<HTMLButtonElement>('.back-button')!.click());
    expect(rootEl.querySelector('.subpage-head h2')?.textContent).toBe('过滤规则');
    await act(async () => rootEl.querySelector<HTMLButtonElement>('.back-button')!.click());
    expect(rootEl.querySelector('.subpage-head h2')?.textContent).toBe('过滤设置');
    await act(async () => rootEl.querySelector<HTMLButtonElement>('.back-button')!.click());
    expect(rootEl.querySelector('.subpage-head')).toBeNull();
    expect(rootEl.textContent).toContain('本页标黄');

    history.replaceState(null, '', '/');
    const second = document.createElement('div');
    document.body.append(second);
    const root2 = ReactDOM.createRoot(second);
    mountedRoots.push(root2);
    await act(async () => root2.render(React.createElement(App)));
    await waitForCondition(
      () => second.querySelector('.section-nav .is-active')?.textContent === '热帖',
    );
    expect(second.querySelector('.section-nav .is-active')?.textContent).toBe('热帖');
  });
});
