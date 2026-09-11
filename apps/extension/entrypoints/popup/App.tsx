import { useCallback, useEffect, useState } from 'react';
import { parseSnapshotBody, type CommunityEntry } from '@feedsieve/community-lists';
import { shouldPauseDestructive, type XAdapterCapabilities } from '@feedsieve/x-adapter';
import { getBlockedAccounts, subscribeBlocked } from '../../src/lib/blocked-accounts';
import { getAllowlist, subscribeAllowlist } from '../../src/lib/allowlist';
import { getFollowingAllowlist, subscribeFollowingAllowlist } from '../../src/lib/following-allowlist';
import {
  getCommunityKillSwitch,
  getCommunitySettings,
  getCommunitySnapshot,
  requestOfficialPauseCheck,
  setCommunitySettings,
  subscribeCommunity,
  type CommunitySettings,
} from '../../src/lib/community-store';
import {
  defaultUiLanguage,
  getUiLanguage,
  subscribeUiLanguage,
  UI_COPY,
  type UiLanguage,
} from '../../src/lib/i18n';
import CleanView from './views/CleanView';
import ListsView from './views/ListsView';
import KeywordsView from './views/KeywordsView';
import SettingsView from './views/SettingsView';
import HunterBar from './views/HunterBar';
import {
  AppIcon,
  asPageMarkedList,
  getChromeSidePanel,
  type CommunityMeta,
  type PageMarkedItem,
} from './views/shared';

type PopupView = 'clean' | 'lists' | 'keywords' | 'settings';

const PAGE_MARKED_MESSAGE = { type: 'feedsieve:page-marked-list' } as const;

function initialPopupView(): PopupView {
  const value = new URLSearchParams(globalThis.location?.search ?? '').get('view');
  switch (value) {
    case 'lists':
    case 'overview':
      return 'lists';
    case 'keywords':
    case 'detection':
      return 'keywords';
    case 'settings':
      return 'settings';
    default:
      return 'clean';
  }
}

export default function App() {
  const [language, setLanguage] = useState<UiLanguage>(defaultUiLanguage);
  const [view, setView] = useState<PopupView>(initialPopupView);
  const [notice, setNotice] = useState<string | null>(null);
  const [pageMarked, setPageMarked] = useState<PageMarkedItem[] | null>(null);
  const [killSwitch, setKillSwitch] = useState<
    { destructive_actions_disabled: true; reason?: string; disabled_since?: string } | null
  >(null);
  const [capabilities, setCapabilities] = useState<XAdapterCapabilities | null>(null);
  const [community, setCommunity] = useState<CommunitySettings | null>(null);
  const [communityMeta, setCommunityMeta] = useState<CommunityMeta | null>(null);
  const [communityEntries, setCommunityEntries] = useState<CommunityEntry[]>([]);
  // 名单 tab 徽章需要计算「社区候选中未被保护」的数量，轻量订阅三份名单。
  const [blocked, setBlocked] = useState<Array<{ handle: string }>>([]);
  const [allowlist, setAllowlist] = useState<Array<{ handle: string }>>([]);
  const [following, setFollowing] = useState<Array<{ handle: string }>>([]);

  const t = UI_COPY[language];

  const notify = useCallback((message: string | null): void => setNotice(message), []);

  const applyCommunitySnapshotState = useCallback(
    (snapshot: Awaited<ReturnType<typeof getCommunitySnapshot>>): void => {
      if (!snapshot) {
        setCommunityEntries([]);
        setCommunityMeta(null);
        return;
      }
      const parsed = parseSnapshotBody(snapshot.body);
      if (!parsed.ok) {
        setCommunityEntries([]);
        setCommunityMeta(null);
        return;
      }
      // 展示与批量拉黑都用这个顺序：净票高的排前面（票面主序稳定，同人并列按 handle）
      const sorted = [...parsed.value.entries].sort(
        (a, b) => b.net_votes - a.net_votes || a.handle.localeCompare(b.handle),
      );
      setCommunityEntries(sorted);
      setCommunityMeta({
        version: snapshot.snapshot_version,
        count: parsed.value.entries.length,
        syncedAt: snapshot.synced_at,
      });
    },
    [],
  );

  const sendToXPage = useCallback(
    async (message: {
      type: string;
      handle?: string;
      force?: boolean;
      items?: Array<{ handle: string; xUserId?: string; category: string }>;
    }): Promise<unknown> => {
      // Only target the active tab. Sending a destructive action to an arbitrary
      // background X tab is surprising and can block the wrong account.
      const activeTabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
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
        // 快照更新后同步重查实时官方暂停（popup 打开期间开关翻转也能尽快反映）
        void requestOfficialPauseCheck()
          .then((state) => setKillSwitch(state.destructive_actions_disabled ? state : null))
          .catch(() => undefined);
      }),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [applyCommunitySnapshotState, sendToXPage]);

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const [isSidePanel, setIsSidePanel] = useState(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.location.search.includes('panel') ||
      window.location.hash.includes('sidepanel') ||
      window.innerHeight > 650
    );
  });

  const sidePanelApi = getChromeSidePanel();
  const canOpenSidePanel = Boolean(sidePanelApi?.open);

  useEffect(() => {
    const syncMode = () => {
      const isPanel =
        window.location.search.includes('panel') ||
        window.location.hash.includes('sidepanel') ||
        window.innerHeight > 650;
      setIsSidePanel(isPanel);
      if (isPanel) {
        document.body.classList.add('mode-sidepanel');
      } else {
        document.body.classList.remove('mode-sidepanel');
      }
    };
    syncMode();
    window.addEventListener('resize', syncMode);
    return () => window.removeEventListener('resize', syncMode);
  }, []);

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

  // 侧边栏模式不提供切回弹窗的按钮：关闭面板会连带杀掉刚打开的 action popup
  // （Chromium 平台行为，实测含延迟收起均如此），且想用弹窗直接点工具栏图标即可。
  // 弹窗 → 侧边栏方向是弹窗自己 window.close()，可对称收起，保留入口。
  const modeToggle =
    canOpenSidePanel && !isSidePanel ? (
      <button
        type="button"
        className="sidepanel-toggle-btn"
        title={t.openSidePanel}
        aria-label={t.openSidePanel}
        onClick={() => void handleOpenSidePanel()}
      >
        <AppIcon name="sidepanel" size={15} />
        <span className="sidepanel-label-text">{t.openSidePanel}</span>
      </button>
    ) : null;

  // 破坏性操作降级：官方暂停开关优先，其次 X 能力快照（会话/Block 接口异常）
  const killSwitchActive = Boolean(killSwitch?.destructive_actions_disabled);
  const pauseDestructive =
    killSwitchActive || (capabilities ? shouldPauseDestructive(capabilities) : false);
  const pageCount = pageMarked?.length ?? null;
  const protectedHandles = new Set([
    ...allowlist.map((item) => item.handle),
    ...following.map((item) => item.handle),
    ...blocked.map((item) => item.handle),
  ]);
  const communityTodo = communityEntries.filter(
    (entry) => !protectedHandles.has(entry.handle.toLowerCase()),
  ).length;

  return (
    <main className="popup">
      {/* 侧边栏模式 Chrome 自带标题栏，应用内头部整行去掉 */}
      {!isSidePanel ? (
        <header className="popup-header">
          <div className="brand-lockup">
            <img src="/icon-64.png" alt="" className="brand-icon" />
            <h1>{t.brand}</h1>
          </div>
          {modeToggle ? <div className="header-actions">{modeToggle}</div> : null}
        </header>
      ) : null}

      <div className="popup-content">
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
          />
        ) : null}
        {view === 'lists' ? (
          <>
            <ListsView
              language={language}
              notify={notify}
              sendToXPage={sendToXPage}
              refreshPageMarked={refreshPageMarked}
              pauseDestructive={pauseDestructive}
              communityEntries={communityEntries}
              communityMeta={communityMeta}
              onRefreshCommunitySnapshot={refreshCommunitySnapshot}
            />
            <HunterBar language={language} />
          </>
        ) : null}
        {view === 'keywords' ? (
          <KeywordsView language={language} notify={notify} />
        ) : null}
        {view === 'settings' ? (
          <SettingsView
            language={language}
            notify={notify}
            community={community}
            onUpdateCommunity={updateCommunity}
            onLanguageChange={setLanguage}
          />
        ) : null}
      </div>

      {notice ? (
        <p className="toast-notice" role="status">
          {notice}
        </p>
      ) : null}

      <nav className="bottom-nav" aria-label={t.primaryNavigation}>
        <button
          type="button"
          className={view === 'clean' ? 'is-active' : ''}
          aria-current={view === 'clean' ? 'page' : undefined}
          onClick={() => setView('clean')}
        >
          <span className="nav-icon-wrap">
            <AppIcon name="clean" />
            {pageCount ? <span className="nav-badge">{Math.min(pageCount, 99)}</span> : null}
          </span>
          <span>{t.home}</span>
        </button>
        <button
          type="button"
          className={view === 'lists' ? 'is-active' : ''}
          aria-current={view === 'lists' ? 'page' : undefined}
          onClick={() => setView('lists')}
        >
          <span className="nav-icon-wrap">
            <AppIcon name="lists" />
            {communityTodo ? (
              <span className="nav-badge">{Math.min(communityTodo, 99)}</span>
            ) : null}
          </span>
          <span>{t.lists}</span>
        </button>
        <button
          type="button"
          className={view === 'keywords' ? 'is-active' : ''}
          aria-current={view === 'keywords' ? 'page' : undefined}
          onClick={() => setView('keywords')}
        >
          <span className="nav-icon-wrap">
            <AppIcon name="detect" />
          </span>
          <span>{t.keywords}</span>
        </button>
        <button
          type="button"
          className={view === 'settings' ? 'is-active' : ''}
          aria-current={view === 'settings' ? 'page' : undefined}
          onClick={() => setView('settings')}
        >
          <span className="nav-icon-wrap">
            <AppIcon name="settings" />
          </span>
          <span>{t.settings}</span>
        </button>
      </nav>
    </main>
  );
}
