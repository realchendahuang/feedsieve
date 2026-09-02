// @vitest-environment happy-dom
// popup 渲染冒烟测试：防止「渲染期崩溃 → 白屏」再犯（曾因三态分支写错崩在 null.map）
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

let storageSet: ReturnType<typeof vi.fn>;
let runtimeSendMessage: ReturnType<typeof vi.fn>;
let tabSendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.body.replaceChildren();
  storageSet = vi.fn().mockResolvedValue(undefined);
  runtimeSendMessage = vi.fn().mockResolvedValue({ status: 'up_to_date' });
  tabSendMessage = vi.fn().mockResolvedValue({ blocked: [], failed: [] });
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({ uiLanguage: 'zh' }),
        set: storageSet,
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1 }]),
      sendMessage: tabSendMessage,
    },
    runtime: {
      sendMessage: runtimeSendMessage,
    },
  });
});

function renderApp(): HTMLElement {
  const rootEl = document.createElement('div');
  document.body.append(rootEl);
  ReactDOM.createRoot(rootEl).render(React.createElement(App));
  return rootEl;
}

function buttonWithText(root: HTMLElement, label: string): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`button not found: ${label}`);
  return button;
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

function communitySnapshot(handles: Array<{ handle: string; maintainer?: boolean }>) {
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
  it('renders header and empty page-marked hint without throwing', async () => {
    const rootEl = renderApp();
    // 等 storage/tabs 异步 resolve 完成（加载态「…」过渡到空态提示）；
    // 全量 verify 高并发时 50ms 偶发不够，放宽到 150ms
    await new Promise((r) => setTimeout(r, 150));

    expect(rootEl.textContent).toContain('福滤娃');
    expect(rootEl.textContent).toContain('当前页面');
    expect(rootEl.textContent).toContain('当前页面没有待处理账号');
    expect(rootEl.textContent).toContain('一键拉黑全部');
    expect(rootEl.textContent).toContain('社区黑名单');
    expect(rootEl.textContent).toContain('@cndon91');
    expect(rootEl.textContent).toContain('一键开始清理 6 个');
    expect(rootEl.textContent).toContain('今日概览');
    expect(rootEl.textContent).toContain('清理');
    expect(rootEl.textContent).toContain('名单');
    expect(rootEl.textContent).toContain('设置');

    await act(async () => buttonWithText(rootEl, '名单').click());
    expect(rootEl.textContent).toContain('拉黑记录');
    expect(rootEl.textContent).toContain('误标白名单');

    await act(async () => buttonWithText(rootEl, '设置').click());
    expect(rootEl.textContent).toContain('检测强度');
    expect(rootEl.textContent).toContain('关键词规则');
    expect(rootEl.textContent).toContain('黄推 / 成人引流');
    expect(rootEl.textContent).not.toContain('官方预置词库');
    expect(rootEl.textContent).not.toContain('未订阅');
    expect(rootEl.textContent).not.toContain('福利隐语、成人内容和主页导流的完整话术');
    expect(rootEl.textContent).not.toContain('误标较多时');
    expect(rootEl.textContent).not.toContain('标注不隐藏内容');
    expect(rootEl.textContent).not.toContain('X 页面清理');

    const adultToggle = rootEl.querySelector(
      'button[role="switch"][aria-label^="黄推 / 成人引流"]',
    ) as HTMLButtonElement | null;
    expect(adultToggle?.getAttribute('aria-checked')).toBe('true');
    await act(async () => adultToggle?.click());
    expect(adultToggle?.getAttribute('aria-checked')).toBe('false');

    const adultTitle = [...rootEl.querySelectorAll<HTMLButtonElement>('.keyword-pack-title')].find(
      (button) => button.textContent?.includes('黄推 / 成人引流'),
    );
    await act(async () => adultTitle?.click());
    expect(rootEl.textContent).toContain('同城上门约炮');

    await act(async () => buttonWithText(rootEl, 'EN').click());
    expect(rootEl.textContent).toContain('FeedSieve');
    expect(rootEl.textContent).toContain('Detection level');
  });

  it('renders page-marked accounts after querying the active x.com tab', async () => {
    vi.stubGlobal('browser', {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ uiLanguage: 'zh' }),
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
        sendMessage: vi
          .fn()
          .mockResolvedValue([
            { handle: 'spamking88', category: 'copy_paste', reason: '3 人标记为重复刷屏' },
          ]),
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ status: 'up_to_date' }),
      },
    });

    const rootEl = renderApp();
    await new Promise((r) => setTimeout(r, 150));

    expect(rootEl.textContent).toContain('@spamking88');
    expect(rootEl.textContent).toContain('3 人标记为重复刷屏');
    expect(rootEl.textContent).toContain('一键拉黑全部 · 1');
  });

  it('shows every final-list source and sends the visible accounts to the one-click queue', async () => {
    const snapshot = communitySnapshot([
      { handle: 'three_votes' },
      { handle: 'maintained', maintainer: true },
    ]);
    vi.stubGlobal('browser', {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ uiLanguage: 'zh', communitySnapshot: snapshot }),
          set: vi.fn().mockResolvedValue(undefined),
        },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1 }]),
        sendMessage: tabSendMessage,
      },
      runtime: { sendMessage: runtimeSendMessage },
    });

    const rootEl = renderApp();
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(rootEl.textContent).toContain('社区黑名单');
    expect(rootEl.textContent).toContain('@three_votes');
    expect(rootEl.textContent).toContain('社区净票 3');
    expect(rootEl.textContent).toContain('@maintained');
    expect(rootEl.textContent).toContain('维护者加入');

    await act(async () => {
      buttonWithText(rootEl, '一键开始清理 2 个').click();
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

  it('previews a personal config before applying only local preference storage', async () => {
    const rootEl = renderApp();
    await new Promise((r) => setTimeout(r, 150));
    await act(async () => buttonWithText(rootEl, '设置').click());

    expect(rootEl.textContent).toContain('备份与迁移');
    expect(rootEl.textContent).toContain('导出个人配置');
    expect(rootEl.textContent).toContain('导入个人配置');

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
    expect(storageSet).toHaveBeenCalledTimes(3);
    expect(storageSet.mock.calls.flatMap(([value]) => Object.keys(value)).sort()).toEqual([
      'communitySettings',
      'keywordRulesV1',
      'uiLanguage',
    ]);
    expect(runtimeSendMessage).toHaveBeenCalledTimes(initialRuntimeCalls);
    expect(tabSendMessage).toHaveBeenCalledTimes(initialTabCalls);
    expect(rootEl.textContent).toContain('仅本地设置已更新');
  });

  it('shows invalid-file feedback and can replace the scoped local configuration', async () => {
    const rootEl = renderApp();
    await new Promise((r) => setTimeout(r, 150));
    await act(async () => buttonWithText(rootEl, '设置').click());

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
    expect(storageSet).toHaveBeenCalledTimes(3);
    expect(rootEl.textContent).toContain('仅本地设置已更新');
  });

  it('renders the backup controls with English copy when English is the local preference', async () => {
    const get = browser.storage.local.get as ReturnType<typeof vi.fn>;
    get.mockResolvedValue({ uiLanguage: 'en' });
    const rootEl = renderApp();
    await new Promise((r) => setTimeout(r, 150));
    await act(async () => buttonWithText(rootEl, 'Settings').click());

    expect(rootEl.textContent).toContain('Backup & migration');
    expect(rootEl.textContent).toContain('Export personal config');
    expect(rootEl.textContent).toContain('Import personal config');
  });
});
