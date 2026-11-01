import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  parseSnapshotBody,
  type CommunityEntry,
  type WhitelistEntry,
} from '@feedsieve/community-lists';
import { shouldPauseDestructive, type XAdapterCapabilities } from '@feedsieve/x-adapter';
import { ensureVariantTables } from '../../src/lib/detection/keyword-rules';
import { getBlockedAccounts, subscribeBlocked } from '../../src/lib/community/blocked-accounts';
import { getAllowlist, subscribeAllowlist } from '../../src/lib/community/allowlist';
import {
  getFollowingAllowlist,
  subscribeFollowingAllowlist,
} from '../../src/lib/community/following-allowlist';
import {
  getCommunityKillSwitch,
  getCommunitySettings,
  getCommunitySnapshot,
  requestOfficialPauseCheck,
  setCommunitySettings,
  subscribeCommunity,
  type CommunitySettings,
} from '../../src/lib/community/community-store';
import {
  defaultUiLanguage,
  getUiLanguage,
  subscribeUiLanguage,
  UI_COPY,
  type UiLanguage,
} from '../../src/lib/platform/i18n';
import CleanView from './views/CleanView';
import SettingsView, { type SettingsPage } from './views/SettingsView';
import HotView from './views/HotView';
import ProfileView from './views/ProfileView';
import { AiView } from './views/AiView';
import { WriteView } from './views/WriteView';
import { isProfileUrl } from './views/profile-model';
import { PANEL_VIEW_REQUEST_KEY, readPanelViewRequest } from '../../src/lib/platform/panel-route';
import { AppIcon, asPageMarkedList, getChromeSidePanel, type PageMarkedItem } from './views/shared';

/**
 * 三个栏目，各回答一个问题：
 * - 热帖：这一页什么在火、回复谁划算（默认）
 * - 发帖：已排期的帖子和空档、发帖时间表、发帖框与文章编辑器助手
 * - AI 味：当前账号是不是 AI 代写回复的号，我测过的账号
 * - 清理：这一页的垃圾账号、社区黑名单还剩多少
 * - 设置：规则与记录，低频内容收进二级页
 */
type PopupView = 'hot' | 'profile' | 'write' | 'ai' | 'clean' | 'settings';

const SECTIONS: PopupView[] = ['hot', 'profile', 'write', 'ai', 'clean', 'settings'];

const PAGE_MARKED_MESSAGE = { type: 'feedsieve:page-marked-list' } as const;

/** 旧链接参数兼容：`?view=lists&list=blocked`、`?view=keywords` 等。 */
function initialRoute(): { view: PopupView; page: SettingsPage } {
  const params = new URLSearchParams(globalThis.location?.search ?? '');
  const list = params.get('list');
  switch (params.get('view')) {
    case 'clean':
      return { view: 'clean', page: 'home' };
    case 'profile':
      return { view: 'profile', page: 'home' };
    case 'ai':
      return { view: 'ai', page: 'home' };
    case 'write':
      return { view: 'write', page: 'home' };
    case 'lists':
    case 'overview':
      if (list === 'blocked' || list === 'allowlist' || list === 'following') {
        return { view: 'settings', page: list };
      }
      return { view: 'clean', page: 'home' };
    case 'keywords':
    case 'detection':
      return { view: 'settings', page: 'keywords' };
    case 'settings':
      return { view: 'settings', page: 'home' };
    default:
      // 旧链接里已下线的页面（insight / hot / hunting 等）都落到热帖
      return { view: 'hot', page: 'home' };
  }
}

/**
 * 同一个 popup.html 既做工具栏弹窗，也做侧边栏（manifest side_panel）。
 * 只有工具栏弹窗是固定 420×600；侧边栏和在标签页里打开时都撑满。
 * 按扩展登记的视图判断：工具栏弹窗出现在 getViews({ type: 'popup' }) 里。
 * 原先按窗口高度猜（> 650 算侧边栏），窗口矮时侧边栏会被当成弹窗。
 */
function detectSidePanel(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.location.search.includes('panel') || window.location.hash.includes('sidepanel')) {
    return true;
  }
  const getViews = (
    globalThis as {
      chrome?: { extension?: { getViews?: (filter: { type: string }) => Window[] } };
    }
  ).chrome?.extension?.getViews;
  if (typeof getViews === 'function') {
    try {
      return !getViews({ type: 'popup' }).includes(window);
    } catch {
      // 拿不到登记信息时退回按高度判断
    }
  }
  return window.innerHeight > 650;
}

export default function App() {
  const [language, setLanguage] = useState<UiLanguage>(defaultUiLanguage);
  const [route] = useState(initialRoute);
  const [view, setView] = useState<PopupView>(route.view);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>(route.page);
  const [notice, setNotice] = useState<string | null>(null);
  const [pageMarked, setPageMarked] = useState<PageMarkedItem[] | null>(null);
  const [killSwitch, setKillSwitch] = useState<{
    destructive_actions_disabled: true;
    reason?: string;
    disabled_since?: string;
  } | null>(null);
  const [capabilities, setCapabilities] = useState<XAdapterCapabilities | null>(null);
  const [community, setCommunity] = useState<CommunitySettings | null>(null);
  const [communityEntries, setCommunityEntries] = useState<CommunityEntry[]>([]);
  // 社区快照在拉取中：清理页先不显示数量，不闪「0」
  const [communityEntriesLoading, setCommunityEntriesLoading] = useState(true);
  // 推荐白名单：快照 whitelist 段随名单一起下发，只读展示
  const [recommendList, setRecommendList] = useState<WhitelistEntry[]>([]);
  const [blocked, setBlocked] = useState<Array<{ handle: string }> | null>(null);
  const [allowlist, setAllowlist] = useState<Array<{ handle: string }> | null>(null);
  const [following, setFollowing] = useState<Array<{ handle: string }> | null>(null);

  const t = UI_COPY[language];

  const notify = useCallback((message: string | null): void => setNotice(message), []);

  // 在博主主页上打开弹窗 / 侧边栏：默认落到「主页」。只在打开的那一刻判断，
  // 之后切到别的页面不自动跳走（热帖的阅读位置在切换视图时会丢）。链接里指定了视图的照旧
  // 判断完之前不渲染热帖，热帖不会先闪一下再跳走（查询很快，失败也照常显示）
  const [viewReady, setViewReady] = useState(
    () => new URLSearchParams(globalThis.location?.search ?? '').get('view') !== null,
  );
  useEffect(() => {
    if (viewReady) return;
    let active = true;
    // 兜底：个别环境里 tabs.query 迟迟不 settle 时，热帖区不能一直空着
    const timer = setTimeout(() => {
      if (active) setViewReady(true);
    }, 400);
    void Promise.resolve()
      .then(() => browser.tabs.query({ active: true, currentWindow: true }))
      .then((tabs) => {
        if (active && isProfileUrl(tabs[0]?.url)) {
          setView((current) => (current === 'hot' ? 'profile' : current));
        }
      })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        if (active) setViewReady(true);
      });
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // 只在打开的那一刻判断一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 从主页资料卡下的洞察行打开侧边栏：落到「主页」视图；侧边栏已经开着时跟着切过去
  useEffect(() => {
    const session = (browser.storage as { session?: typeof browser.storage.local }).session;
    if (!session) return;
    const apply = (value: unknown): void => {
      if (readPanelViewRequest(value, Date.now()) === 'profile') setView('profile');
    };
    void session
      .get(PANEL_VIEW_REQUEST_KEY)
      .then((stored) => apply(stored[PANEL_VIEW_REQUEST_KEY]))
      .catch(() => undefined);
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
      if (area === 'session' && changes[PANEL_VIEW_REQUEST_KEY]) {
        apply(changes[PANEL_VIEW_REQUEST_KEY].newValue);
      }
    };
    browser.storage.onChanged?.addListener(onChanged);
    return () => browser.storage.onChanged?.removeListener(onChanged);
  }, []);

  const applyCommunitySnapshotState = useCallback(
    (snapshot: Awaited<ReturnType<typeof getCommunitySnapshot>>): void => {
      setCommunityEntriesLoading(false);
      const parsed = snapshot ? parseSnapshotBody(snapshot.body) : null;
      if (!parsed?.ok) {
        setCommunityEntries([]);
        setRecommendList([]);
        return;
      }
      // 批量拉黑按这个顺序：净票高的先处理，同票按 handle
      const sorted = [...parsed.value.entries].sort(
        (a, b) => b.net_votes - a.net_votes || a.handle.localeCompare(b.handle),
      );
      setCommunityEntries(sorted);
      setRecommendList(
        (parsed.value.whitelist ?? []).sort((a, b) => a.handle.localeCompare(b.handle)),
      );
    },
    [],
  );

  const sendToXPage = useCallback(
    async (message: {
      type: string;
      handle?: string;
      handles?: string[];
      force?: boolean;
      items?: Array<{ handle: string; xUserId?: string; category: string }>;
      sort?: string;
      postId?: string;
      text?: string;
      at?: number;
    }): Promise<unknown> => {
      // 只发给当前激活的 x.com 标签页：发给后台标签页可能拉黑错账号。
      // 必须是弹窗 / 侧边栏所在窗口的（currentWindow），多窗口时 lastFocusedWindow 会指到别的窗口
      const activeTabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tab = activeTabs.find((candidate) => {
        const url = candidate.url ?? '';
        return (
          candidate.active === true &&
          /^https:\/\/(www\.)?x\.com\//.test(url) &&
          Boolean(candidate.id)
        );
      });
      if (!tab?.id) throw new Error('no x.com receiver');
      return browser.tabs.sendMessage(tab.id, { ...message, targetTabId: tab.id });
    },
    [],
  );

  const refreshPageMarked = useCallback(async (): Promise<void> => {
    try {
      const result = await sendToXPage(PAGE_MARKED_MESSAGE);
      setPageMarked(asPageMarkedList(result));
    } catch {
      setPageMarked([]);
    }
  }, [sendToXPage]);

  const refreshCommunitySnapshot = useCallback(async (): Promise<void> => {
    await getCommunitySnapshot().then(applyCommunitySnapshotState);
  }, [applyCommunitySnapshotState]);

  const updateCommunity = useCallback(
    async (patch: Parameters<typeof setCommunitySettings>[0]): Promise<unknown> => {
      const next = await setCommunitySettings(patch);
      setCommunity(next);
      return next;
    },
    [],
  );

  useEffect(() => {
    // 变体映射是随包资源：弹窗内自定义词去重/校验依赖它，进弹窗先预热
    void ensureVariantTables();
    void getUiLanguage().then(setLanguage);
    void getCommunitySettings().then(setCommunity);
    void getCommunitySnapshot().then(applyCommunitySnapshotState);
    void getBlockedAccounts().then(setBlocked);
    void getAllowlist().then(setAllowlist);
    void getFollowingAllowlist().then(setFollowing);
    // 降级态：官方暂停开关（本地快照）+ X 能力快照（活动 x.com tab 实探）
    void getCommunityKillSwitch()
      .then((sw) => setKillSwitch(sw ?? null))
      .catch(() => setKillSwitch(null));
    // 实时门控：官方暂停以 /v1/kill-switch 为准（请求失败时刚读的本地快照值兜底）
    void requestOfficialPauseCheck()
      .then((state) => setKillSwitch(state.destructive_actions_disabled ? state : null))
      .catch(() => undefined);
    void sendToXPage({ type: 'feedsieve:capabilities' })
      .then((result) => {
        const caps = result as XAdapterCapabilities | null;
        // 形状校验：旧版 content script / 其他消息回复不会误触发降级
        if (
          caps &&
          typeof caps === 'object' &&
          typeof caps.block === 'string' &&
          typeof caps.csrfAvailable === 'boolean'
        ) {
          setCapabilities(caps);
        } else {
          setCapabilities(null);
        }
      })
      .catch(() => setCapabilities(null));
    void sendToXPage(PAGE_MARKED_MESSAGE)
      .then((result) => setPageMarked(asPageMarkedList(result)))
      .catch(() => setPageMarked([]));
    // content script 在黄框集合变化时广播；popup 开着就自动跟进
    const onPageMarkedUpdated = (message: unknown): void => {
      if ((message as { type?: string } | null)?.type === 'feedsieve:page-marked-updated') {
        void refreshPageMarked();
      }
    };
    browser.runtime.onMessage.addListener(onPageMarkedUpdated);
    const unsubs = [
      subscribeUiLanguage(setLanguage),
      subscribeBlocked(setBlocked),
      subscribeAllowlist(setAllowlist),
      subscribeFollowingAllowlist(setFollowing),
      subscribeCommunity(() => {
        void getCommunitySettings().then(setCommunity);
        void getCommunitySnapshot().then(applyCommunitySnapshotState);
        void getCommunityKillSwitch()
          .then((sw) => setKillSwitch(sw ?? null))
          .catch(() => setKillSwitch(null));
        void requestOfficialPauseCheck()
          .then((state) => setKillSwitch(state.destructive_actions_disabled ? state : null))
          .catch(() => undefined);
      }),
    ];
    return () => {
      browser.runtime.onMessage.removeListener(onPageMarkedUpdated);
      unsubs.forEach((unsub) => unsub());
    };
  }, [applyCommunitySnapshotState, refreshPageMarked, sendToXPage]);

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const [isSidePanel] = useState(detectSidePanel);

  useEffect(() => {
    document.body.classList.toggle('mode-sidepanel', isSidePanel);
  }, [isSidePanel]);

  const canOpenSidePanel = Boolean(getChromeSidePanel()?.open);

  // 弹窗 → 侧边栏。Chrome 152 实测：setOptions 不支持 windowId（同步 TypeError，
  // 会拦死后续代码），只允许全局 {enabled, path}；setOptions 独立捕获，绝不让它拦住 open
  const handleOpenSidePanel = async () => {
    const api = getChromeSidePanel();
    if (!api?.open) return;
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.windowId) return;
      try {
        await api.setOptions?.({ enabled: true, path: 'popup.html' });
      } catch {
        // setOptions 兼容性差异不阻塞 open
      }
      await api.open({ windowId: tab.windowId });
      window.close();
    } catch (err) {
      notify(`${t.sidePanelOpenFailed}：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 破坏性操作降级：官方暂停开关优先，其次 X 能力快照（会话/Block 接口异常）
  const killSwitchActive = Boolean(killSwitch?.destructive_actions_disabled);
  const pauseDestructive =
    killSwitchActive || (capabilities ? shouldPauseDestructive(capabilities) : false);
  const pageCount = pageMarked?.length ?? null;
  // 名单数千条时的 Set 构建/过滤别跟 toast、计时器等无关渲染一起跑
  const communityEligible = useMemo(() => {
    const protectedHandles = new Set([
      ...(allowlist ?? []).map((item) => item.handle),
      ...(following ?? []).map((item) => item.handle),
      ...(blocked ?? []).map((item) => item.handle),
    ]);
    return communityEntries.filter((entry) => !protectedHandles.has(entry.handle.toLowerCase()));
  }, [communityEntries, allowlist, following, blocked]);

  const sectionLabel: Record<PopupView, string> = {
    hot: t.hot,
    profile: t.profileNav,
    write: language === 'zh' ? '发帖' : 'Post',
    ai: language === 'zh' ? 'AI 味' : 'AI',
    clean: t.home,
    settings: t.settings,
  };

  function selectSection(section: PopupView): void {
    // 再点一次「设置」回到设置首页
    if (section === 'settings') setSettingsPage('home');
    setView(section);
  }

  return (
    <main className="popup">
      <header className="masthead">
        {/* 顶部只留栏目：不放商标和名字（侧边栏顶部 Chrome 已经显示了图标和名字，
            弹窗里也不需要）。关于信息在设置最底下 */}
        <nav className="section-nav" aria-label={t.primaryNavigation}>
          {SECTIONS.map((section) => (
            <button
              key={section}
              type="button"
              className={view === section ? 'is-active' : ''}
              aria-current={view === section ? 'page' : undefined}
              onClick={() => selectSection(section)}
            >
              <span>{sectionLabel[section]}</span>
              {section === 'clean' && pageCount ? (
                <span className="nav-badge">{Math.min(pageCount, 99)}</span>
              ) : null}
            </button>
          ))}
          {canOpenSidePanel && !isSidePanel ? (
            // 侧边栏模式不提供切回弹窗的按钮：关闭面板会连带杀掉刚打开的 action popup
            <button
              type="button"
              className="icon-button masthead-tool"
              title={t.openSidePanel}
              aria-label={t.openSidePanel}
              onClick={() => void handleOpenSidePanel()}
            >
              <AppIcon name="sidepanel" size={16} />
            </button>
          ) : null}
        </nav>
      </header>

      <div className="popup-content">
        {viewReady && view === 'hot' ? (
          <HotView language={language} sendToXPage={sendToXPage} />
        ) : null}
        {view === 'profile' ? (
          <ProfileView language={language} notify={notify} sendToXPage={sendToXPage} />
        ) : null}
        {view === 'write' ? (
          <WriteView
            language={language}
            notify={notify}
            sendToXPage={sendToXPage}
            onOpenCadence={() => {
              setView('settings');
              setSettingsPage('compose');
            }}
          />
        ) : null}
        {view === 'ai' ? (
          <AiView language={language} notify={notify} sendToXPage={sendToXPage} />
        ) : null}
        {view === 'clean' ? (
          <CleanView
            language={language}
            notify={notify}
            sendToXPage={sendToXPage}
            pageMarked={pageMarked}
            refreshPageMarked={refreshPageMarked}
            pauseDestructive={pauseDestructive}
            killSwitchActive={killSwitchActive}
            killSwitchReason={killSwitch?.reason}
            communityEligible={communityEligible}
            communityLoading={communityEntriesLoading}
          />
        ) : null}
        {view === 'settings' ? (
          <SettingsView
            language={language}
            notify={notify}
            page={settingsPage}
            onNavigate={setSettingsPage}
            community={community}
            onUpdateCommunity={updateCommunity}
            onLanguageChange={setLanguage}
            onSyncCommunity={refreshCommunitySnapshot}
            sendToXPage={sendToXPage}
            refreshPageMarked={refreshPageMarked}
            pauseDestructive={pauseDestructive}
            counts={{
              blocked: blocked?.length ?? null,
              allowlist: allowlist?.length ?? null,
              following: following?.length ?? null,
            }}
            recommendList={recommendList}
          />
        ) : null}
      </div>

      {notice ? (
        <p className="toast-notice" role="status">
          {notice}
        </p>
      ) : null}
    </main>
  );
}
