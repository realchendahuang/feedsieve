import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  getBlockedAccounts,
  subscribeBlocked,
  type BlockedAccount,
} from '../../src/lib/blocked-accounts';
import { getDailyStats, subscribeDaily, type DailyStats } from '../../src/lib/daily-stats';
import { buildReportText, shareUrl } from '../../src/lib/share-card';
import { estimateTimeSaved } from '../../src/lib/time-saved';
import {
  getContributionStats,
  getInstallationId,
  type ContributionStats,
} from '../../src/lib/contribute';
import { drawReportCard } from '../../src/lib/share-card-image';
import {
  getAllowlist,
  removeAllowed,
  subscribeAllowlist,
  type AllowlistItem,
} from '../../src/lib/allowlist';
import {
  getCommunitySettings,
  setCommunitySettings,
  getCommunitySnapshot,
  subscribeCommunity,
  type CommunitySettings,
} from '../../src/lib/community-store';
import {
  getFollowingAllowlist,
  getFollowingSyncState,
  subscribeFollowingAllowlist,
  subscribeFollowingSyncState,
  type FollowingAllowlistItem,
  type FollowingSyncState,
} from '../../src/lib/following-allowlist';
import {
  blockQueueProgress,
  getPersistentBlockQueue,
  subscribePersistentBlockQueue,
  type PersistentBlockQueueState,
} from '../../src/lib/block-queue-store';
import {
  categoryLabel,
  defaultUiLanguage,
  getUiLanguage,
  localizedDetectionReason,
  setUiLanguage,
  subscribeUiLanguage,
  UI_COPY,
  type UiLanguage,
} from '../../src/lib/i18n';
import {
  addCustomKeywordRule,
  getKeywordRuleSettings,
  isOfficialKeywordCategorySubscribed,
  removeCustomKeywordRule,
  replaceKeywordRuleSettings,
  setOfficialKeywordCategorySubscribed,
  setOfficialKeywordRuleEnabled,
  subscribeKeywordRules,
  type KeywordRuleSettings,
} from '../../src/lib/keyword-rules';
import {
  BUNDLED_KEYWORD_PACK_CATALOG,
  getKeywordPackCatalog,
  subscribeKeywordPackCatalog,
  type KeywordPackCatalog,
} from '../../src/lib/keyword-packs';
import {
  createPersonalConfigDocument,
  MAX_PERSONAL_CONFIG_BYTES,
  parsePersonalConfigDocument,
  preparePersonalConfigImport,
  serializePersonalConfigDocument,
  type PersonalConfigImportMode,
  type PersonalConfigImportResult,
  type PersonalConfigParseError,
} from '../../src/lib/personal-config';
import {
  MARK_STRENGTHS,
  parseSnapshotBody,
  type CommunityEntry,
  type MarkStrength,
} from '@feedsieve/community-lists';
import type { UnblockBatchResult } from '../../src/lib/run-unblock-batch';

interface PageBlockResult {
  blocked: string[];
  failed: Array<{ handle: string; code: string }>;
}

interface PageMarkedItem {
  handle: string;
  category: string;
  reason: string;
}

interface ManualBlockResult {
  ok: boolean;
  handle?: string;
  code?: string;
}

interface PersonalConfigPreviewState {
  merge: PersonalConfigImportResult;
  replace: PersonalConfigImportResult;
}

type PopupView = 'home' | 'lists' | 'settings';
type ListView = 'blocked' | 'allowlist';
type AppIconName = 'clean' | 'lists' | 'settings' | 'refresh' | 'shield';

function initialPopupView(): PopupView {
  const value = new URLSearchParams(globalThis.location?.search ?? '').get('view');
  return value === 'lists' || value === 'settings' ? value : 'home';
}

function initialListView(): ListView {
  return new URLSearchParams(globalThis.location?.search ?? '').get('list') === 'allowlist'
    ? 'allowlist'
    : 'blocked';
}

function AppIcon({ name, size = 20 }: { name: AppIconName; size?: number }) {
  const paths: Record<AppIconName, ReactNode> = {
    clean: (
      <>
        <path d="M12 3.25 5 6.1v5.15c0 4.3 2.82 7.7 7 9.5 4.18-1.8 7-5.2 7-9.5V6.1L12 3.25Z" />
        <path d="m8.6 12 2.15 2.15 4.75-5" />
      </>
    ),
    lists: (
      <>
        <path d="M9.25 6.25h9.5M9.25 12h9.5M9.25 17.75h9.5" />
        <circle cx="5.25" cy="6.25" r="1" />
        <circle cx="5.25" cy="12" r="1" />
        <circle cx="5.25" cy="17.75" r="1" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10M4 12h4M12 12h8" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="8" cy="17" r="2" />
        <circle cx="10" cy="12" r="2" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5" />
        <path d="M18.35 16.1A8 8 0 1 1 19.6 9" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3.25 5 6.1v5.15c0 4.3 2.82 7.7 7 9.5 4.18-1.8 7-5.2 7-9.5V6.1L12 3.25Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      className="app-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

const FAILURE_LABELS: Record<UiLanguage, Record<string, string>> = {
  zh: {
    'no-id': '缺少用户 ID',
    auth_required: '登录已失效',
    rate_limited: '请求过于频繁',
    http_error: '请求异常',
    network_error: '网络失败',
    missing_csrf: '登录态缺失',
  },
  en: {
    'no-id': 'Missing user ID',
    auth_required: 'Sign-in expired',
    rate_limited: 'Rate limited',
    http_error: 'Request error',
    network_error: 'Network error',
    missing_csrf: 'Missing session',
  },
};

const STRENGTH_LABELS: Record<UiLanguage, Record<MarkStrength, string>> = {
  zh: { refresh: '清爽', standard: '标准', deep_clean: '彻底' },
  en: { refresh: 'Light', standard: 'Standard', deep_clean: 'Deep' },
};

const STRENGTH_HINTS: Record<UiLanguage, Record<MarkStrength, string>> = {
  zh: {
    refresh: '最终黑名单始终生效；尽量减少间接证据提示',
    standard: '最终黑名单与已启用词库正常生效',
    deep_clean: '最终黑名单之外，也提示相似话术和可疑域名',
  },
  en: {
    refresh: 'The final blocklist stays on; minimize indirect-evidence prompts',
    standard: 'Use the final blocklist and enabled keyword rules',
    deep_clean: 'Also show similar wording and suspicious-domain prompts',
  },
};

const BLOCK_MESSAGE = { type: 'feedsieve:run-page-block' } as const;
const PAGE_MARKED_MESSAGE = { type: 'feedsieve:page-marked-list' } as const;

function asPageMarkedList(value: unknown): PageMarkedItem[] {
  return Array.isArray(value) ? (value as PageMarkedItem[]) : [];
}

function formatDate(timestamp: number, language: UiLanguage): string {
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}

function formatAgo(timestamp: number, language: UiLanguage): string {
  const t = UI_COPY[language];
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return t.justNow;
  if (minutes < 60) return t.minutesAgo(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t.hoursAgo(hours);
  return t.daysAgo(Math.floor(hours / 24));
}

function allowlistReason(item: AllowlistItem, language: UiLanguage): string | undefined {
  if (!item.detectionReason) return undefined;
  if (!item.ruleId) return item.detectionReason;
  return localizedDetectionReason(language, {
    source: item.detectionSource ?? '',
    ruleId: item.ruleId,
    reason: item.detectionReason,
  });
}

function normalizeManualInput(value: string): string | null {
  const trimmed = value.trim();
  let candidate = trimmed;
  try {
    const url = new URL(trimmed);
    if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)) {
      candidate = url.pathname.split('/').filter(Boolean)[0] ?? '';
    }
  } catch {
    // not a URL; treat it as @handle
  }
  const handle = candidate.replace(/^@+/, '').toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

export default function App() {
  const [language, setLanguage] = useState<UiLanguage>(defaultUiLanguage);
  const [view, setView] = useState<PopupView>(initialPopupView);
  const [listView, setListView] = useState<ListView>(initialListView);
  const [reportExpanded, setReportExpanded] = useState(false);
  const [pageMarked, setPageMarked] = useState<PageMarkedItem[] | null>(null);
  const [blocked, setBlocked] = useState<BlockedAccount[] | null>(null);
  const [daily, setDaily] = useState<DailyStats>({ days: {} });
  const [contribution, setContribution] = useState<ContributionStats | null>(null);
  const [cardUrl, setCardUrl] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [blockResult, setBlockResult] = useState<PageBlockResult | null>(null);
  const [unblockResult, setUnblockResult] = useState<UnblockBatchResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [community, setCommunity] = useState<CommunitySettings | null>(null);
  const [communityMeta, setCommunityMeta] = useState<{
    version: string;
    count: number;
    syncedAt: number;
  } | null>(null);
  const [allowlist, setAllowlist] = useState<AllowlistItem[] | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [manualHandle, setManualHandle] = useState('');
  const [manualRunning, setManualRunning] = useState(false);
  const [keywordRules, setKeywordRules] = useState<KeywordRuleSettings | null>(null);
  const [keywordCatalog, setKeywordCatalog] = useState<KeywordPackCatalog>(
    BUNDLED_KEYWORD_PACK_CATALOG,
  );
  const [expandedKeywordCategory, setExpandedKeywordCategory] = useState<string | null>(null);
  const [customKeyword, setCustomKeyword] = useState('');
  const personalConfigInputRef = useRef<HTMLInputElement>(null);
  const [personalConfigPreview, setPersonalConfigPreview] =
    useState<PersonalConfigPreviewState | null>(null);
  const [personalConfigMessage, setPersonalConfigMessage] = useState<string | null>(null);
  const [personalConfigError, setPersonalConfigError] = useState<string | null>(null);
  const [personalConfigBusy, setPersonalConfigBusy] = useState(false);
  const [following, setFollowing] = useState<FollowingAllowlistItem[] | null>(null);
  const [followingSync, setFollowingSync] = useState<FollowingSyncState>({
    status: 'idle',
    collected: 0,
    updatedAt: 0,
  });
  const [queue, setQueue] = useState<PersistentBlockQueueState | null>(null);
  const [communityEntries, setCommunityEntries] = useState<CommunityEntry[]>([]);

  const t = UI_COPY[language];

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
      setCommunityEntries(parsed.value.entries);
      setCommunityMeta({
        version: snapshot.snapshot_version,
        count: parsed.value.entries.length,
        syncedAt: snapshot.synced_at,
      });
    },
    [],
  );

  async function loadCommunitySnapshotState(): Promise<void> {
    applyCommunitySnapshotState(await getCommunitySnapshot());
  }

  useEffect(() => {
    void getUiLanguage().then(setLanguage);
    void getBlockedAccounts().then(setBlocked);
    void getDailyStats().then(setDaily);
    void getContributionStats().then(setContribution);
    void getAllowlist().then(setAllowlist);
    void getCommunitySettings().then(setCommunity);
    void getKeywordRuleSettings().then(setKeywordRules);
    void getKeywordPackCatalog().then(setKeywordCatalog);
    void browser.runtime
      .sendMessage({ type: 'feedsieve:keyword-packs-sync' })
      .catch(() => undefined);
    void getFollowingAllowlist().then(setFollowing);
    void getFollowingSyncState().then(setFollowingSync);
    void getPersistentBlockQueue().then(setQueue);
    void sendToXPage(PAGE_MARKED_MESSAGE)
      .then((result) => setPageMarked(asPageMarkedList(result)))
      .catch(() => setPageMarked([]));
    void getCommunitySnapshot().then(applyCommunitySnapshotState);
    const unsubs = [
      subscribeBlocked(setBlocked),
      subscribeDaily(setDaily),
      subscribeAllowlist(setAllowlist),
      subscribeCommunity(() => {
        void getCommunitySettings().then(setCommunity);
        void getCommunitySnapshot().then(applyCommunitySnapshotState);
      }),
      subscribeUiLanguage(setLanguage),
      subscribeKeywordRules(setKeywordRules),
      subscribeKeywordPackCatalog(setKeywordCatalog),
      subscribeFollowingAllowlist(setFollowing),
      subscribeFollowingSyncState(setFollowingSync),
      subscribePersistentBlockQueue(setQueue),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [applyCommunitySnapshotState]);

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);

  async function sendToXPage(message: {
    type: string;
    handle?: string;
    force?: boolean;
    items?: Array<{ handle: string; xUserId?: string; category: string }>;
  }): Promise<unknown> {
    const tabs = await browser.tabs.query({ url: 'https://x.com/*' });
    const ordered = [...tabs].sort((a, b) => Number(b.active ?? false) - Number(a.active ?? false));
    for (const tab of ordered) {
      if (!tab.id) continue;
      try {
        return await browser.tabs.sendMessage(tab.id, message);
      } catch {
        // Try the next x.com tab; hot reload can leave stale content scripts behind.
      }
    }
    throw new Error('no x.com receiver');
  }

  async function refreshPageMarked(): Promise<void> {
    try {
      const result = await sendToXPage(PAGE_MARKED_MESSAGE);
      setPageMarked(asPageMarkedList(result));
    } catch {
      setPageMarked([]);
    }
  }

  async function selectLanguage(next: UiLanguage): Promise<void> {
    if (next === language) return;
    setCardUrl(null);
    setSyncMsg(null);
    setNotice(null);
    setLanguage(next);
    await setUiLanguage(next);
  }

  async function setListUploads(enabled: boolean): Promise<void> {
    await setCommunitySettings({ autoContribute: enabled });
    if (enabled) {
      await browser.runtime.sendMessage({ type: 'feedsieve:labels-sync' }).catch(() => undefined);
      setContribution(await getContributionStats());
    }
  }

  async function removeFromAllowlist(handle: string): Promise<void> {
    await removeAllowed(handle);
    await browser.runtime.sendMessage({ type: 'feedsieve:labels-sync' }).catch(() => undefined);
  }

  async function syncCommunityNow(): Promise<void> {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = (await browser.runtime.sendMessage({
        type: 'feedsieve:community-sync',
        force: true,
      })) as { outcome?: { status: string; version?: string; error?: string } };
      const outcome = res?.outcome;
      if (outcome?.status === 'updated') {
        await loadCommunitySnapshotState();
        setSyncMsg(t.synced(outcome.version));
      } else if (outcome?.status === 'unchanged') {
        await loadCommunitySnapshotState();
        setSyncMsg(t.upToDate);
      } else if (outcome?.status === 'error') {
        setSyncMsg(outcome.error ? `${t.syncFailed}: ${outcome.error}` : t.syncFailed);
      } else {
        setSyncMsg(t.unavailable);
      }
    } catch {
      setSyncMsg(t.backgroundUnavailable);
    } finally {
      setSyncing(false);
    }
  }

  async function copyInstallationId(): Promise<void> {
    try {
      const id = await getInstallationId();
      await navigator.clipboard.writeText(id);
      setNotice(t.copiedId);
    } catch {
      setNotice(t.copyFailed);
    }
  }

  async function runBatch(): Promise<void> {
    setRunning(true);
    setNotice(null);
    setBlockResult(null);
    setUnblockResult(null);
    try {
      const result = (await sendToXPage(BLOCK_MESSAGE)) as PageBlockResult;
      setBlockResult(result);
      await refreshPageMarked();
    } catch {
      setNotice(t.openXNotice);
    } finally {
      setRunning(false);
    }
  }

  async function runUnblock(handle?: string): Promise<void> {
    setRunning(true);
    setNotice(null);
    setBlockResult(null);
    setUnblockResult(null);
    try {
      const result = (await sendToXPage({
        type: 'feedsieve:unblock',
        ...(handle ? { handle } : {}),
      })) as UnblockBatchResult;
      setUnblockResult(result);
      await refreshPageMarked();
    } catch {
      setNotice(t.openXNotice);
    } finally {
      setRunning(false);
    }
  }

  async function runManualBlock(): Promise<void> {
    const handle = normalizeManualInput(manualHandle);
    if (!handle) {
      setNotice(t.invalidHandle);
      return;
    }
    setManualRunning(true);
    setNotice(null);
    try {
      const result = (await sendToXPage({
        type: 'feedsieve:manual-spam-block',
        handle,
      })) as ManualBlockResult;
      if (result?.ok) {
        setManualHandle('');
        setNotice(t.manualBlocked(handle));
      } else {
        setNotice(`${t.failed}: ${result?.code ?? t.unknown}`);
      }
    } catch {
      setNotice(t.openXNotice);
    } finally {
      setManualRunning(false);
    }
  }

  async function addKeyword(): Promise<void> {
    const phrase = customKeyword.trim();
    if (!phrase) return;
    try {
      const next = await addCustomKeywordRule(phrase);
      setKeywordRules(next);
      setCustomKeyword('');
      setNotice(t.keywordAdded);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      setNotice(code === 'keyword_rule_limit' ? t.keywordLimit : t.keywordInvalid);
    }
  }

  async function removeCustomKeyword(id: string): Promise<void> {
    setKeywordRules(await removeCustomKeywordRule(id));
  }

  async function toggleOfficialKeyword(id: string, enabled: boolean): Promise<void> {
    setKeywordRules(await setOfficialKeywordRuleEnabled(id, enabled));
  }

  async function toggleOfficialKeywordCategory(
    category: Parameters<typeof setOfficialKeywordCategorySubscribed>[0],
    subscribed: boolean,
  ): Promise<void> {
    setKeywordRules(await setOfficialKeywordCategorySubscribed(category, subscribed));
  }

  async function syncKeywordPacks(): Promise<void> {
    try {
      const result = (await browser.runtime.sendMessage({
        type: 'feedsieve:keyword-packs-sync',
        force: true,
      })) as {
        outcome?: { status?: string; version?: string };
      };
      await getKeywordPackCatalog().then(setKeywordCatalog);
      setNotice(
        result?.outcome?.status === 'error'
          ? t.syncFailed
          : t.keywordPacksSynced(result?.outcome?.version),
      );
    } catch {
      setNotice(t.backgroundUnavailable);
    }
  }

  function personalConfigErrorMessage(error: PersonalConfigParseError): string {
    switch (error) {
      case 'file_too_large':
        return t.personalConfigFileTooLarge;
      case 'unsupported_version':
        return t.personalConfigUnsupportedVersion;
      case 'invalid_json':
      case 'invalid_format':
      case 'invalid_payload':
        return t.personalConfigInvalid;
    }
  }

  function exportPersonalConfig(): void {
    if (!keywordRules || !community) return;
    setPersonalConfigError(null);
    setPersonalConfigMessage(null);
    try {
      const body = serializePersonalConfigDocument(
        createPersonalConfigDocument({
          keywordRules,
          community,
          language,
          catalog: keywordCatalog,
        }),
      );
      const objectUrl = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `feedsieve-personal-config-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.style.display = 'none';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      setPersonalConfigMessage(t.personalConfigExported);
    } catch {
      setPersonalConfigError(t.personalConfigExportFailed);
    }
  }

  function choosePersonalConfigFile(): void {
    if (!keywordRules || !community || personalConfigBusy) return;
    setPersonalConfigError(null);
    setPersonalConfigMessage(null);
    personalConfigInputRef.current?.click();
  }

  async function readPersonalConfigFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0];
    // 同一文件再次选择时也要触发 change；读取后立即清空 input。
    event.currentTarget.value = '';
    if (!file || !keywordRules || !community) return;
    setPersonalConfigError(null);
    setPersonalConfigMessage(null);
    setPersonalConfigPreview(null);
    if (file.size > MAX_PERSONAL_CONFIG_BYTES) {
      setPersonalConfigError(t.personalConfigFileTooLarge);
      return;
    }
    try {
      const parsed = parsePersonalConfigDocument(await file.text());
      if (!parsed.ok) {
        setPersonalConfigError(personalConfigErrorMessage(parsed.error));
        return;
      }
      const context = { keywordRules, community, language, catalog: keywordCatalog };
      setPersonalConfigPreview({
        merge: preparePersonalConfigImport(parsed.document, context, 'merge'),
        replace: preparePersonalConfigImport(parsed.document, context, 'replace'),
      });
    } catch {
      setPersonalConfigError(t.personalConfigReadFailed);
    }
  }

  async function applyPersonalConfig(mode: PersonalConfigImportMode): Promise<void> {
    const prepared = personalConfigPreview?.[mode];
    if (!prepared?.next || personalConfigBusy) return;
    setPersonalConfigBusy(true);
    setPersonalConfigError(null);
    try {
      const [nextKeywordRules, nextCommunity] = await Promise.all([
        replaceKeywordRuleSettings(prepared.next.keywordRules),
        setCommunitySettings({
          enabled: prepared.next.preferences.communityEnabled,
          strength: prepared.next.preferences.markStrength,
        }),
      ]);
      await setUiLanguage(prepared.next.preferences.uiLanguage);
      setKeywordRules(nextKeywordRules);
      setCommunity(nextCommunity);
      setLanguage(prepared.next.preferences.uiLanguage);
      setPersonalConfigPreview(null);
      setPersonalConfigMessage(
        UI_COPY[prepared.next.preferences.uiLanguage].personalConfigImported,
      );
    } catch {
      setPersonalConfigError(t.personalConfigApplyFailed);
    } finally {
      setPersonalConfigBusy(false);
    }
  }

  async function startFollowingSync(): Promise<void> {
    setSyncing(true);
    setNotice(null);
    try {
      const result = (await sendToXPage({ type: 'feedsieve:following-sync-start' })) as {
        status?: string;
        error?: string;
      };
      if (result?.status === 'error') {
        setNotice(`${t.syncFailed}: ${result.error ?? t.unavailable}`);
      }
    } catch {
      setNotice(t.openXNotice);
    } finally {
      setSyncing(false);
    }
  }

  async function startCommunityQueue(): Promise<void> {
    if (cloudEligible.length === 0) return;
    setRunning(true);
    setNotice(null);
    try {
      await sendToXPage({
        type: 'feedsieve:community-block-start',
        items: cloudEligible.map((entry) => ({
          handle: entry.handle,
          ...(entry.x_user_id ? { xUserId: entry.x_user_id } : {}),
          category: entry.category,
        })),
      });
    } catch {
      setNotice(t.openXNotice);
    } finally {
      setRunning(false);
    }
  }

  async function controlQueue(action: 'resume' | 'pause' | 'cancel'): Promise<void> {
    try {
      await sendToXPage({ type: `feedsieve:block-queue-${action}` });
    } catch {
      setNotice(t.openXNotice);
    }
  }

  const pageCount = pageMarked?.length ?? null;
  const officialKeywordRules = keywordCatalog.packs.flatMap((pack) =>
    pack.rules.map((rule) => ({ ...rule, category: pack.id })),
  );
  const keywordCategoryNames = new Map(
    keywordCatalog.packs.map((pack) => [pack.id, pack.name[language]]),
  );
  const officialKeywordRuleNames = new Map(
    officialKeywordRules.map((rule) => [rule.id, rule.name[language]]),
  );
  const personalConfigMergePreview = personalConfigPreview?.merge.preview ?? null;
  const personalConfigReplacePreview = personalConfigPreview?.replace.preview ?? null;
  const personalConfigPreferenceChanges = personalConfigMergePreview
    ? [
        personalConfigMergePreview.languageChange
          ? `${t.languageSetting} → ${
              personalConfigMergePreview.languageChange.to === 'zh' ? '中文' : 'EN'
            }`
          : null,
        personalConfigMergePreview.communityEnabledChange
          ? `${t.enabled} → ${
              personalConfigMergePreview.communityEnabledChange.to
                ? t.personalConfigOn
                : t.personalConfigOff
            }`
          : null,
        personalConfigMergePreview.markStrengthChange
          ? `${t.strength} → ${
              STRENGTH_LABELS[language][personalConfigMergePreview.markStrengthChange.to]
            }`
          : null,
      ].filter((value): value is string => value !== null)
    : [];
  const blockedCount = blocked?.length ?? null;
  const protectedHandles = new Set([
    ...(allowlist ?? []).map((item) => item.handle),
    ...(following ?? []).map((item) => item.handle),
    ...(blocked ?? []).map((item) => item.handle),
  ]);
  const cloudEligible = communityEntries.filter(
    (entry) => !protectedHandles.has(entry.handle.toLowerCase()),
  );
  const cloudExcluded = communityEntries.length - cloudEligible.length;
  const queueSummary = blockQueueProgress(queue);
  const queueDone = queueSummary.success + queueSummary.failed;
  const followingSyncActive =
    followingSync.status === 'running' || followingSync.status === 'waiting';
  const followingSyncStale = followingSyncActive && Date.now() - followingSync.updatedAt > 60_000;
  const failedSummary = (result: { failed: Array<{ handle: string; code: string }> } | null) =>
    result?.failed.length
      ? result.failed
          .map(
            (failure) =>
              `@${failure.handle} (${FAILURE_LABELS[language][failure.code] ?? failure.code})`,
          )
          .join(' · ')
      : null;

  const today = daily.days[new Date().toISOString().slice(0, 10)] ?? {
    blocked: 0,
    detected: 0,
    unblocked: 0,
    byCategory: {},
  };
  const reportText = buildReportText(today, language);
  const shareHref = shareUrl(reportText);
  const timeSaved = estimateTimeSaved(today.detected, language);
  const categoryBars = Object.entries(today.byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([key, count]) => ({
      key,
      label: categoryLabel(key, language),
      count,
      pct: today.blocked > 0 ? Math.round((count / today.blocked) * 100) : 0,
    }));

  function makeCard(): void {
    try {
      const canvas = drawReportCard(today, language);
      setCardUrl(canvas.toDataURL('image/png'));
    } catch {
      setCardUrl(null);
    }
  }

  const communityStatus = communityMeta ? t.listReady(communityMeta.count) : t.listLoading;

  return (
    <main className="popup">
      <header className="popup-header">
        <div className="brand-lockup">
          <img src="/icon-64.png" alt="" className="brand-icon" />
          <h1>{t.brand}</h1>
        </div>
        {view === 'home' ? (
          <div className={`sync-pill${communityMeta ? ' is-ready' : ''}`} title={communityStatus}>
            <span className="sync-dot" aria-hidden="true" />
            <span>{communityStatus}</span>
          </div>
        ) : null}
      </header>

      <div className="popup-content">
        {view === 'home' ? (
          <div className="view-stack home-view">
            <section className={`review-card${pageCount === 0 ? ' is-clean' : ''}`}>
              <div className="section-heading">
                <h2>{t.pageMarked}</h2>
                <span className="count-badge" aria-label={`${t.pageMarked}: ${pageCount ?? 0}`}>
                  {pageCount === null ? '…' : pageCount}
                </span>
              </div>

              {pageCount === null ? (
                <div className="loading-list" aria-hidden="true">
                  <span />
                  <span />
                </div>
              ) : pageCount === 0 ? (
                <div className="clean-state">
                  <span className="clean-state-icon">
                    <AppIcon name="clean" size={24} />
                  </span>
                  <p>{running ? t.processing : t.pageClean}</p>
                </div>
              ) : (
                <ul className="review-list">
                  {pageMarked!.map((item) => (
                    <li key={item.handle} className="review-item">
                      <span className="account-avatar" aria-hidden="true">
                        {item.handle.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="account-info">
                        <div className="account-line">
                          <span className="account-handle">@{item.handle}</span>
                          <span className="category-chip">
                            {categoryLabel(item.category, language)}
                          </span>
                        </div>
                        {item.reason ? <span className="account-reason">{item.reason}</span> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {blockResult ? (
                <p className="result-message" role="status">
                  {t.blockedResult(blockResult.blocked.length)}
                  {failedSummary(blockResult) ? (
                    <span className="result-failure">
                      {' '}
                      · {t.failedResult(blockResult.failed.length)} · {failedSummary(blockResult)}
                    </span>
                  ) : null}
                </p>
              ) : null}

              <form
                className="manual-block-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runManualBlock();
                }}
              >
                <label htmlFor="manual-spam-handle">{t.missedAccount}</label>
                <div className="manual-block-row">
                  <input
                    id="manual-spam-handle"
                    type="text"
                    value={manualHandle}
                    placeholder={t.missedAccountHint}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setManualHandle(event.target.value)}
                  />
                  <button
                    type="submit"
                    className="secondary-inline"
                    disabled={manualRunning || manualHandle.trim().length === 0}
                  >
                    {manualRunning ? t.processing : t.markSpamAndBlock}
                  </button>
                </div>
              </form>

              <div className="primary-actions">
                <button
                  className="primary-action"
                  disabled={!pageCount || running}
                  onClick={() => void runBatch()}
                >
                  {running
                    ? t.processing
                    : pageCount
                      ? `${t.blockPage} · ${pageCount}`
                      : t.blockPage}
                </button>
                <button
                  type="button"
                  className="square-action"
                  aria-label={t.refreshPage}
                  title={t.refreshPage}
                  disabled={running}
                  onClick={() => void refreshPageMarked()}
                >
                  <AppIcon name="refresh" />
                </button>
              </div>
            </section>

            <section className="community-clean-card" aria-labelledby="community-clean-title">
              <div className="section-heading compact">
                <h2 id="community-clean-title">{t.communityClean}</h2>
                <span className="count-badge">{cloudEligible.length}</span>
              </div>
              <p className="card-hint">{t.communityCleanHint}</p>
              <div className="community-clean-metrics">
                <span>
                  {t.cloudEligible} <strong>{cloudEligible.length}</strong>
                </span>
                <span>
                  {t.cloudProtected} <strong>{cloudExcluded}</strong>
                </span>
              </div>

              {cloudEligible.length > 0 ? (
                <ul className="community-preview" aria-label={t.communityPreview}>
                  {cloudEligible.slice(0, 5).map((entry) => (
                    <li key={entry.handle}>
                      <span>@{entry.handle}</span>
                      <small>
                        {entry.sources.includes('maintainer') && entry.sources.includes('community')
                          ? t.communitySourceBoth(entry.net_votes)
                          : entry.sources.includes('maintainer')
                            ? t.communitySourceMaintainer
                            : t.communitySourceVotes(entry.net_votes)}
                      </small>
                    </li>
                  ))}
                  {cloudEligible.length > 5 ? (
                    <li className="community-preview-more">
                      {t.communityMore(cloudEligible.length - 5)}
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="community-empty">{t.communityEmpty}</p>
              )}

              {queue && queueSummary.total > 0 ? (
                <div className="queue-panel">
                  <div className="queue-line">
                    <span>{t.queueProgress(queueDone, queueSummary.total)}</span>
                    <strong>{queue.status}</strong>
                  </div>
                  <div className="queue-track" aria-hidden="true">
                    <div
                      className="queue-fill"
                      style={{
                        width: `${Math.round((queueDone / Math.max(queueSummary.total, 1)) * 100)}%`,
                      }}
                    />
                  </div>
                  {queue.status === 'running' ? (
                    <div className="queue-actions">
                      <button
                        className="secondary-inline"
                        onClick={() => void controlQueue('pause')}
                      >
                        {t.pause}
                      </button>
                      <button className="text-action" onClick={() => void controlQueue('cancel')}>
                        {t.cancel}
                      </button>
                    </div>
                  ) : queue.status === 'paused' ? (
                    <div className="queue-actions">
                      <button
                        className="secondary-inline"
                        onClick={() => void controlQueue('resume')}
                      >
                        {t.resume}
                      </button>
                      <button className="text-action" onClick={() => void controlQueue('cancel')}>
                        {t.cancel}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <button
                  className="secondary-action community-clean-action"
                  disabled={running || cloudEligible.length === 0}
                  onClick={() => void startCommunityQueue()}
                >
                  {t.startCommunityClean(cloudEligible.length)}
                </button>
              )}
            </section>

            <section className="summary-card" aria-labelledby="today-title">
              <div className="section-heading compact">
                <h2 id="today-title">{t.todaySummary}</h2>
                {today.detected > 0 ? (
                  <button
                    type="button"
                    className="text-action"
                    aria-expanded={reportExpanded}
                    onClick={() => setReportExpanded((expanded) => !expanded)}
                  >
                    {reportExpanded ? t.hideDetails : t.showDetails}
                  </button>
                ) : null}
              </div>
              <div className="metric-grid" aria-label={t.todaySummary}>
                <div>
                  <strong>{today.detected}</strong>
                  <span>{t.marked}</span>
                </div>
                <div>
                  <strong>{today.blocked}</strong>
                  <span>{t.blocked}</span>
                </div>
                <div>
                  <strong>{today.unblocked}</strong>
                  <span>{t.restored}</span>
                </div>
              </div>
              {today.detected > 0 ? (
                <p className="saved-time">
                  {t.saved} <strong>{timeSaved.label}</strong>
                </p>
              ) : (
                <p className="summary-empty">{t.todayQuiet}</p>
              )}

              {reportExpanded ? (
                <div className="report-details">
                  {categoryBars.length > 0 ? (
                    <div className="report-bars">
                      {categoryBars.map((bar) => (
                        <div key={bar.key} className="report-bar">
                          <span className="report-bar-label">{bar.label}</span>
                          <div className="report-bar-track" aria-hidden="true">
                            <div
                              className="report-bar-fill"
                              style={{ width: `${Math.max(bar.pct, 4)}%` }}
                            />
                          </div>
                          <span className="report-bar-count">{bar.count}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {today.blocked > 0 ? (
                    <div className="report-actions">
                      <button type="button" className="secondary-inline" onClick={makeCard}>
                        {t.reportCard}
                      </button>
                      <a
                        className="secondary-inline"
                        href={shareHref}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t.share} ↗
                      </a>
                    </div>
                  ) : null}
                  {cardUrl ? (
                    <div className="report-card-preview">
                      <img src={cardUrl} alt={t.reportImageAlt} />
                      <a className="text-action" href={cardUrl} download="feedsieve-report.png">
                        {t.downloadImage}
                      </a>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          </div>
        ) : null}

        {view === 'lists' ? (
          <div className="view-stack lists-view">
            <div className="list-tabs" role="tablist" aria-label={t.lists}>
              <button
                id="blocked-list-tab"
                type="button"
                role="tab"
                aria-selected={listView === 'blocked'}
                className={listView === 'blocked' ? 'is-selected' : ''}
                onClick={() => setListView('blocked')}
              >
                <span>{t.manageBlocked}</span>
                <strong>{blockedCount === null ? '…' : blockedCount}</strong>
              </button>
              <button
                id="allowlist-tab"
                type="button"
                role="tab"
                aria-selected={listView === 'allowlist'}
                className={listView === 'allowlist' ? 'is-selected' : ''}
                onClick={() => setListView('allowlist')}
              >
                <span>{t.falsePositiveList}</span>
                <strong>{allowlist === null ? '…' : allowlist.length}</strong>
              </button>
            </div>

            <section
              className="manage-card"
              role="tabpanel"
              aria-labelledby={listView === 'blocked' ? 'blocked-list-tab' : 'allowlist-tab'}
            >
              {listView === 'blocked' ? (
                <>
                  {blockedCount === null ? (
                    <div className="loading-list" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : blockedCount > 0 ? (
                    <ul className="manage-list">
                      {blocked!.map((account) => (
                        <li key={account.handle} className="manage-item">
                          <span className="account-avatar is-muted" aria-hidden="true">
                            {account.handle.slice(0, 1).toUpperCase()}
                          </span>
                          <div className="account-info">
                            <span className="account-handle">@{account.handle}</span>
                            <span className="account-reason">
                              {formatDate(account.blockedAt, language)}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="secondary-inline"
                            disabled={running}
                            onClick={() => void runUnblock(account.handle)}
                          >
                            {t.undo}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="empty-panel">
                      <AppIcon name="lists" size={26} />
                      <p>{t.noBlocked}</p>
                    </div>
                  )}

                  {unblockResult ? (
                    <p className="result-message" role="status">
                      {t.restoredResult(unblockResult.unblocked.length)}
                      {failedSummary(unblockResult) ? (
                        <span className="result-failure">
                          {' '}
                          · {t.failedResult(unblockResult.failed.length)} ·{' '}
                          {failedSummary(unblockResult)}
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                  {blockedCount ? (
                    <button
                      className="secondary-action"
                      disabled={running}
                      onClick={() => void runUnblock()}
                    >
                      {t.undoAll}
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  {allowlist === null ? (
                    <div className="loading-list" aria-hidden="true">
                      <span />
                      <span />
                    </div>
                  ) : allowlist.length > 0 ? (
                    <ul className="manage-list allowlist-list">
                      {allowlist.map((item) => (
                        <li key={item.handle} className="manage-item allowlist-item">
                          <span className="account-avatar is-safe" aria-hidden="true">
                            {item.handle.slice(0, 1).toUpperCase()}
                          </span>
                          <div className="account-info">
                            <span className="account-handle">@{item.handle}</span>
                            <span className="account-meta">
                              {formatDate(item.addedAt, language)}
                            </span>
                            {item.detectionReason ? (
                              <span
                                className="account-reason"
                                title={allowlistReason(item, language)}
                              >
                                {allowlistReason(item, language)}
                              </span>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            className="remove-action"
                            aria-label={`${t.removeAllowlist}: @${item.handle}`}
                            title={t.removeAllowlist}
                            onClick={() => void removeFromAllowlist(item.handle)}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="empty-panel">
                      <AppIcon name="shield" size={26} />
                      <p>{t.allowlistEmpty}</p>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        ) : null}

        {view === 'settings' ? (
          <div className="view-stack settings-view">
            <section className="settings-card following-card">
              <div className="settings-card-head">
                <h2>{t.followingProtection}</h2>
                <span className="community-meta is-ready">{following?.length ?? '…'}</span>
              </div>
              {followingSyncStale ? (
                <p className="inline-notice result-failure">{t.syncFollowingInterrupted}</p>
              ) : followingSyncActive ? (
                <p className="inline-notice">{t.syncFollowingWorking(followingSync.collected)}</p>
              ) : followingSync.status === 'complete' ? (
                <p className="inline-notice">{t.syncFollowingComplete(followingSync.collected)}</p>
              ) : followingSync.status === 'error' ? (
                <p className="inline-notice result-failure">
                  {t.syncFailed}: {followingSync.error ?? t.unknown}
                </p>
              ) : null}
              <button
                type="button"
                className="secondary-action"
                disabled={syncing || (followingSyncActive && !followingSyncStale)}
                onClick={() => void startFollowingSync()}
              >
                {followingSyncStale ? t.resyncFollowing : t.syncFollowing}
              </button>
            </section>

            <section className="settings-card keyword-rules-card">
              <div className="settings-card-head">
                <h2>{t.keywordRules}</h2>
                <button
                  type="button"
                  className="square-action small"
                  aria-label={t.syncKeywordPacks}
                  title={`${t.syncKeywordPacks} · v${keywordCatalog.pack_version}`}
                  onClick={() => void syncKeywordPacks()}
                >
                  <AppIcon name="refresh" size={18} />
                </button>
              </div>

              <form
                className="keyword-add-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addKeyword();
                }}
              >
                <input
                  value={customKeyword}
                  maxLength={80}
                  placeholder={t.keywordPlaceholder}
                  aria-label={t.keywordPlaceholder}
                  onChange={(event) => setCustomKeyword(event.target.value)}
                />
                <button type="submit" className="secondary-inline" disabled={!customKeyword.trim()}>
                  {t.addKeyword}
                </button>
              </form>

              {keywordRules ? (
                <div className="keyword-rules-body">
                  {keywordRules.customRules.length > 0 ? (
                    <ul className="keyword-list custom-keyword-list">
                      {keywordRules.customRules.map((rule) => (
                        <li key={rule.id}>
                          <span title={rule.phrase}>{rule.phrase}</span>
                          <button
                            type="button"
                            className="remove-action"
                            aria-label={`${t.removeKeyword}: ${rule.phrase}`}
                            title={t.removeKeyword}
                            onClick={() => void removeCustomKeyword(rule.id)}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="official-keyword-groups">
                    {keywordCatalog.packs.map((category) => {
                      const rules = officialKeywordRules.filter(
                        (rule) => rule.category === category.id,
                      );
                      const subscribed = isOfficialKeywordCategorySubscribed(
                        keywordRules,
                        category.id,
                      );
                      const enabledCount = subscribed
                        ? rules.filter(
                            (rule) => !keywordRules.disabledOfficialRuleIds.includes(rule.id),
                          ).length
                        : 0;
                      const expanded = expandedKeywordCategory === category.id;
                      return (
                        <div className="keyword-pack" key={category.id}>
                          <div className="keyword-pack-row">
                            <button
                              type="button"
                              className="keyword-pack-title"
                              aria-expanded={expanded}
                              title={category.description[language]}
                              onClick={() =>
                                setExpandedKeywordCategory(expanded ? null : category.id)
                              }
                            >
                              <span aria-hidden="true">{expanded ? '−' : '+'}</span>
                              <strong>{category.name[language]}</strong>
                            </button>
                            <button
                              type="button"
                              role="switch"
                              className={`keyword-pack-toggle${subscribed ? ' is-on' : ''}`}
                              aria-checked={subscribed}
                              aria-label={`${category.name[language]} · ${
                                subscribed ? t.unsubscribeKeywordPack : t.subscribeKeywordPack
                              }`}
                              title={`${enabledCount}/${rules.length}`}
                              onClick={() =>
                                void toggleOfficialKeywordCategory(category.id, !subscribed)
                              }
                            >
                              <span />
                            </button>
                          </div>
                          {expanded ? (
                            <ul className="keyword-list official-keyword-list">
                              {rules.map((rule) => {
                                const enabled =
                                  subscribed &&
                                  !keywordRules.disabledOfficialRuleIds.includes(rule.id);
                                return (
                                  <li key={rule.id} className={enabled ? '' : 'is-disabled'}>
                                    <label>
                                      <input
                                        type="checkbox"
                                        checked={enabled}
                                        disabled={!subscribed}
                                        onChange={(event) =>
                                          void toggleOfficialKeyword(rule.id, event.target.checked)
                                        }
                                      />
                                      <span>{rule.name[language]}</span>
                                    </label>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </section>

            <section className="settings-card personal-config-card">
              <div className="settings-card-head">
                <h2>{t.personalConfig}</h2>
              </div>
              <p className="card-hint">{t.personalConfigHint}</p>
              <div className="personal-config-actions">
                <button
                  type="button"
                  className="secondary-inline"
                  disabled={!keywordRules || !community || personalConfigBusy}
                  onClick={exportPersonalConfig}
                >
                  {t.exportPersonalConfig}
                </button>
                <button
                  type="button"
                  className="secondary-inline"
                  disabled={!keywordRules || !community || personalConfigBusy}
                  onClick={choosePersonalConfigFile}
                >
                  {t.importPersonalConfig}
                </button>
              </div>
              <input
                ref={personalConfigInputRef}
                className="personal-config-file-input"
                type="file"
                accept="application/json,.json"
                aria-label={t.importPersonalConfig}
                onChange={(event) => void readPersonalConfigFile(event)}
              />
              {personalConfigError ? (
                <p className="inline-notice result-failure" role="alert">
                  {personalConfigError}
                </p>
              ) : null}
              {personalConfigMessage ? (
                <p className="inline-notice" role="status">
                  {personalConfigMessage}
                </p>
              ) : null}
              {personalConfigMergePreview && personalConfigReplacePreview ? (
                <div className="personal-config-preview" role="status">
                  <strong>{t.personalConfigPreview}</strong>
                  <ul>
                    <li>
                      <strong>{t.personalConfigMerge}</strong>{' '}
                      {t.personalConfigCustomPreview(
                        personalConfigMergePreview.customRules.backupCount,
                        personalConfigMergePreview.customRules.resultCount,
                        personalConfigMergePreview.customRules.addedCount,
                        personalConfigMergePreview.customRules.alreadyPresentCount,
                      )}
                    </li>
                    <li>
                      <strong>{t.personalConfigReplace}</strong>{' '}
                      {t.personalConfigReplaceCustomPreview(
                        personalConfigReplacePreview.customRules.resultCount,
                        personalConfigReplacePreview.customRules.removedCount,
                      )}
                    </li>
                    {personalConfigMergePreview.categoryChanges.length > 0 ? (
                      <li>
                        {t.personalConfigCategories(
                          personalConfigMergePreview.categoryChanges.length,
                        )}
                        <ul className="personal-config-change-list">
                          {personalConfigMergePreview.categoryChanges.slice(0, 3).map((change) => (
                            <li key={change.id}>
                              {keywordCategoryNames.get(change.id) ?? change.id} →{' '}
                              {change.to ? t.personalConfigOn : t.personalConfigOff}
                            </li>
                          ))}
                          {personalConfigMergePreview.categoryChanges.length > 3 ? (
                            <li>
                              {t.personalConfigMore(
                                personalConfigMergePreview.categoryChanges.length - 3,
                              )}
                            </li>
                          ) : null}
                        </ul>
                      </li>
                    ) : null}
                    {personalConfigMergePreview.ruleChanges.length > 0 ? (
                      <li>
                        {t.personalConfigRules(personalConfigMergePreview.ruleChanges.length)}
                        <ul className="personal-config-change-list">
                          {personalConfigMergePreview.ruleChanges.slice(0, 3).map((change) => (
                            <li key={change.id}>
                              {officialKeywordRuleNames.get(change.id) ?? change.id} →{' '}
                              {change.to ? t.personalConfigOff : t.personalConfigOn}
                            </li>
                          ))}
                          {personalConfigMergePreview.ruleChanges.length > 3 ? (
                            <li>
                              {t.personalConfigMore(
                                personalConfigMergePreview.ruleChanges.length - 3,
                              )}
                            </li>
                          ) : null}
                        </ul>
                      </li>
                    ) : null}
                    {personalConfigPreferenceChanges.length > 0 ? (
                      <li>
                        {t.personalConfigPreferences(personalConfigPreferenceChanges.length)}
                        <ul className="personal-config-change-list">
                          {personalConfigPreferenceChanges.map((label) => (
                            <li key={label}>{label}</li>
                          ))}
                        </ul>
                      </li>
                    ) : null}
                    {personalConfigMergePreview.ignoredCategoryIds.length > 0 ||
                    personalConfigMergePreview.ignoredRuleIds.length > 0 ? (
                      <li>
                        {t.personalConfigIgnored(
                          personalConfigMergePreview.ignoredCategoryIds.length,
                          personalConfigMergePreview.ignoredRuleIds.length,
                        )}
                      </li>
                    ) : null}
                    {personalConfigMergePreview.categoryChanges.length === 0 &&
                    personalConfigMergePreview.ruleChanges.length === 0 &&
                    personalConfigPreferenceChanges.length === 0 &&
                    personalConfigMergePreview.customRules.addedCount === 0 &&
                    personalConfigReplacePreview.customRules.removedCount === 0 ? (
                      <li>{t.personalConfigNoChanges}</li>
                    ) : null}
                  </ul>
                  {personalConfigPreview?.merge.preview.customRules.exceedsLimit ? (
                    <p className="result-failure">
                      {t.personalConfigMergeLimit(
                        personalConfigPreview.merge.preview.customRules.resultCount,
                      )}
                    </p>
                  ) : null}
                  <div className="personal-config-actions personal-config-preview-actions">
                    <button
                      type="button"
                      className="secondary-inline"
                      disabled={personalConfigBusy || !personalConfigPreview?.merge.next}
                      onClick={() => void applyPersonalConfig('merge')}
                    >
                      {t.personalConfigMerge}
                    </button>
                    <button
                      type="button"
                      className="secondary-inline"
                      disabled={personalConfigBusy || !personalConfigPreview?.replace.next}
                      onClick={() => void applyPersonalConfig('replace')}
                    >
                      {t.personalConfigReplace}
                    </button>
                    <button
                      type="button"
                      className="text-action"
                      disabled={personalConfigBusy}
                      onClick={() => setPersonalConfigPreview(null)}
                    >
                      {t.personalConfigCancel}
                    </button>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="settings-card">
              <div className="settings-card-head">
                <h2>{t.communityList}</h2>
                <div className="settings-head-actions">
                  <span
                    className={`community-meta${communityMeta ? ' is-ready' : ''}`}
                    title={
                      communityMeta
                        ? `v${communityMeta.version} · ${formatAgo(communityMeta.syncedAt, language)}`
                        : t.listLoading
                    }
                  >
                    {communityMeta ? `${communityMeta.count} · v${communityMeta.version}` : '…'}
                  </span>
                  <button
                    type="button"
                    className={`square-action small${syncing ? ' is-spinning' : ''}`}
                    aria-label={t.syncNow}
                    title={t.syncNow}
                    disabled={syncing}
                    onClick={() => void syncCommunityNow()}
                  >
                    <AppIcon name="refresh" size={18} />
                  </button>
                </div>
              </div>
              {syncMsg ? <p className="inline-notice">{syncMsg}</p> : null}

              {community ? (
                <div className="settings-fields">
                  <label className="setting-row">
                    <span className="setting-copy">
                      <strong>{t.enabled}</strong>
                    </span>
                    <span className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={community.enabled}
                        onChange={(event) =>
                          void setCommunitySettings({ enabled: event.target.checked })
                        }
                      />
                      <span aria-hidden="true" />
                    </span>
                  </label>

                  <div className="setting-block">
                    <div className="setting-copy">
                      <strong>{t.strength}</strong>
                    </div>
                    <div className="strength-control" role="group" aria-label={t.strength}>
                      {MARK_STRENGTHS.map((strength: MarkStrength) => (
                        <button
                          key={strength}
                          type="button"
                          className={community.strength === strength ? 'is-selected' : ''}
                          title={STRENGTH_HINTS[language][strength]}
                          onClick={() => void setCommunitySettings({ strength })}
                        >
                          <span>{STRENGTH_LABELS[language][strength]}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="setting-row">
                    <span className="setting-copy">
                      <strong>{t.autoContribute}</strong>
                    </span>
                    <span className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={community.autoContribute}
                        onChange={(event) => void setListUploads(event.target.checked)}
                      />
                      <span aria-hidden="true" />
                    </span>
                  </label>

                  <div className="settings-meta-row">
                    {contribution && (contribution.reports > 0 || contribution.rescues > 0) ? (
                      <span className="contribution-chip">
                        {t.contribution(contribution.reports, contribution.rescues)}
                      </span>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      className="text-action"
                      title={t.copyInstallationIdHint}
                      onClick={() => void copyInstallationId()}
                    >
                      {t.copyInstallationId}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="loading-list settings-loading" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              )}
            </section>

            <section className="settings-card language-card">
              <div className="setting-row static-row">
                <span className="setting-copy">
                  <strong>{t.languageSetting}</strong>
                </span>
                <div className="language-control" role="group" aria-label={t.language}>
                  <button
                    type="button"
                    className={language === 'zh' ? 'is-selected' : ''}
                    aria-pressed={language === 'zh'}
                    onClick={() => void selectLanguage('zh')}
                  >
                    中文
                  </button>
                  <button
                    type="button"
                    className={language === 'en' ? 'is-selected' : ''}
                    aria-pressed={language === 'en'}
                    onClick={() => void selectLanguage('en')}
                  >
                    EN
                  </button>
                </div>
              </div>
            </section>
          </div>
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
          className={view === 'home' ? 'is-active' : ''}
          aria-current={view === 'home' ? 'page' : undefined}
          onClick={() => setView('home')}
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
          </span>
          <span>{t.lists}</span>
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
