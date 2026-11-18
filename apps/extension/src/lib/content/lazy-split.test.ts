// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSearchAssistTrigger } from './search-assist-trigger';
import { createAiCheckCore } from '../ai-check/ai-check-core';
import { DEFAULT_SEARCH_ASSIST_PREFS } from '../settings/search-assist';

describe('content script 按需拆包轻入口', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.stubGlobal('browser', {
      runtime: {
        getURL: vi.fn((p: string) => `chrome-extension://ext${p}`),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      storage: {
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
        local: { get: vi.fn(async () => ({})) },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('search-assist-trigger 在未点击前不加载弹窗块，点击后才异步装载并打开', async () => {
    document.body.innerHTML =
      '<div data-testid="sidebarColumn"><form role="search"><label data-testid="SearchBox_Search_Input_label"><input /></label></form></div>';
    const open = vi.fn();
    let openState = false;
    const factory = vi.fn(() => ({
      ready: async () => undefined,
      open: () => {
        openState = true;
        open();
      },
      close: () => {
        openState = false;
      },
      syncLocation: () => undefined,
      syncBackdrop: () => undefined,
      reopenForLanguage: () => undefined,
      isOpen: () => openState,
      stop: () => {
        openState = false;
      },
    }));
    const loadDialog = vi.fn(async () => factory);

    const assist = createSearchAssistTrigger({
      getLanguage: () => 'zh',
      isEnabled: () => true,
      getPath: () => '/home',
      getSearch: () => '',
      loadPrefs: async () => ({ ...DEFAULT_SEARCH_ASSIST_PREFS }),
      savePrefs: async () => undefined,
      loadDialog,
    });

    expect(assist.mounted()).toBe(true);
    expect(loadDialog).not.toHaveBeenCalled();

    document.querySelector<HTMLButtonElement>('.fs-search-trigger')!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(loadDialog).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
    expect(assist.isOpen()).toBe(true);
    assist.stop();
  });

  it('ai-check-core 在仅渲染回复入口/主页 Tab 时不加载重型检测面板，触发后按需装配', async () => {
    const openFromTab = vi.fn();
    const factory = vi.fn(() => ({
      openFromTab,
      showKnown: vi.fn(),
      startFromPanel: vi.fn(),
      run: vi.fn(async () => undefined),
      onApiTweets: vi.fn(),
      tick: vi.fn(),
      hasPendingFor: () => false,
      closePanel: vi.fn(),
      stop: vi.fn(),
    }));
    const loadRunner = vi.fn(async () => factory);

    history.replaceState(null, '', '/target_user');
    document.body.innerHTML = [
      '<div data-testid="primaryColumn">',
      '  <div role="tablist">',
      '    <div role="presentation"><a role="tab" href="/target_user" aria-selected="true"><span>帖子</span></a></div>',
      '    <div role="presentation"><a role="tab" href="/target_user/with_replies" aria-selected="false"><span>回复</span></a></div>',
      '  </div>',
      '</div>',
    ].join('');

    const core = createAiCheckCore({
      getLanguage: () => 'zh',
      getSelfHandle: () => null,
      isEnabled: () => true,
      send: async () => ({ remote: null, mine: null, myVote: null }),
      loadRunner,
    });
    core.start();

    const aiTab = document.querySelector<HTMLElement>('[data-fs-ai-tab="target_user"]');
    expect(aiTab).not.toBeNull();
    expect(loadRunner).not.toHaveBeenCalled();

    aiTab!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(loadRunner).toHaveBeenCalledTimes(1);
    expect(openFromTab).toHaveBeenCalledWith('target_user');
    core.stop();
  });
});
