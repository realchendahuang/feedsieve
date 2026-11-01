/**
 * 「主页」视图：跟随当前标签页，显示这个博主的账号卡、基线、爆款列表和规律。
 *
 * 数据来自后台的本地帖子库（profile-catalog.ts）：用户浏览时 X 已经加载的帖子，只存在本机。
 * 扩展不替用户滚动页面、不额外请求 X（docs/07 §1.3）；补数据靠用户自己点「在 X 搜高赞帖」。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  accountFlags,
  accountTier,
  analyzeProfile,
  followRatio,
  highLikesThreshold,
  HEATMAP_SLOT_HOURS,
  OUTLIER_MULTIPLE,
  PROFILE_MIN_SAMPLE,
  TIER_NAMES,
  type ProfileAnalysis,
} from '@feedsieve/metrics';
import { UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';
import { formatCount } from '../../../src/lib/insight/format';
import { drawProfileShareCard, pickSharePosts } from '../../../src/lib/insight/share-card';
import { canvasToBlob } from '../../../src/lib/share/canvas-kit';
import { INSIGHT_COPY } from '../../../src/lib/insight/copy';
import { INSIGHT_READ_MESSAGE } from '../../../src/lib/insight/read-tracker';
import {
  PROFILE_UPDATED_MESSAGE,
  type CatalogEntry,
  type CatalogPost,
} from '../../../src/lib/insight/profile-catalog';
import { AppIcon, HelpIcon, IconButton, useTip } from './shared';
import { Avatar, PostActions, readableText, shortAgo, VerifiedMark } from './post-parts';
import {
  asCatalogEntry,
  formatMultipleText,
  GOOGLE_RANGES,
  googleSearchUrl,
  handleFromUrl,
  isProfileRange,
  isProfileSort,
  outliersMarkdown,
  postsCsv,
  postUrl,
  PROFILE_RANGES,
  PROFILE_SORTS,
  topOutliers,
  visiblePosts,
  type GoogleRange,
  type ProfileRange,
  type ProfileSort,
} from './profile-model';

const PAGE_SIZE = 20;
const UPDATE_DEBOUNCE_MS = 500;
/** 「几分钟前」和刚发帖子的估算倍数随时间变化：每分钟重算一次。 */
const CLOCK_MS = 60_000;
const SORT_KEY = 'profileSortV1';
const RANGE_KEY = 'profileRangeV1';
const REPLIES_KEY = 'profileRepliesV1';
const PATTERNS_KEY = 'profilePatternsOpenV1';
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
/** 爆款率达到这个比例时数字用金色。 */
const OUTLIER_RATE_ACCENT = 0.1;

interface ProfileViewProps {
  language: UiLanguage;
  notify: (message: string | null) => void;
  sendToXPage: (message: { type: string; postId?: string; handle?: string }) => Promise<unknown>;
}

/** 当前标签页的博主：切到别的页面（帖子详情、首页）时保留上一个，面板不闪。 */
function useActiveHandle(): string | null {
  const [handle, setHandle] = useState<string | null>(() => {
    // 从主页资料行打开的独立窗口没有 X 标签页可跟随，URL 里带着博主
    const fromQuery = new URLSearchParams(globalThis.location?.search ?? '').get('handle');
    return fromQuery && /^[a-z0-9_]{1,15}$/i.test(fromQuery) ? fromQuery.toLowerCase() : null;
  });
  useEffect(() => {
    let active = true;
    const apply = (url: string | undefined): void => {
      const next = handleFromUrl(url);
      if (active && next) setHandle(next);
    };
    // 侧边栏挂在某个窗口上，只认这个窗口的标签页（currentWindow）：
    // lastFocusedWindow 在多窗口时会读到别的窗口，面板就跟着别的窗口跳
    const query = (): void => {
      void browser.tabs
        .query({ active: true, currentWindow: true })
        .then((tabs) => apply(tabs[0]?.url))
        .catch(() => undefined);
    };
    const onActivated = (): void => query();
    // 别的窗口里的地址变化也会触发；重新查本窗口的激活标签页，不直接用事件里的地址
    const onUpdated = (_id: number, change: { url?: string }, tab: { active?: boolean }): void => {
      if (change.url && tab.active) query();
    };
    query();
    browser.tabs.onActivated?.addListener(onActivated);
    browser.tabs.onUpdated?.addListener(onUpdated);
    return () => {
      active = false;
      browser.tabs.onActivated?.removeListener(onActivated);
      browser.tabs.onUpdated?.removeListener(onUpdated);
    };
  }, []);
  return handle;
}

function MultipleBadge({
  value,
  estimated,
  boosted,
  views,
  medianViews,
  language,
}: {
  value: number;
  estimated: boolean;
  boosted: boolean;
  views: number | undefined;
  medianViews: number;
  language: UiLanguage;
}) {
  const t = UI_COPY[language];
  // 疑似投流的高倍数不是本事：不标金色
  const outlier = value >= OUTLIER_MULTIPLE && !boosted;
  const lines = [
    t.profileMultipleTip(
      views === undefined ? '—' : formatCount(views, language),
      formatCount(Math.round(medianViews), language),
      formatMultipleText(value),
    ),
    estimated ? t.profileEstimated : boosted ? t.profileBoostedHint : t.profileMultipleOutlier,
  ];
  const tip = useTip(lines.join('\n'));
  return (
    <>
      <span
        className={`multiple-tag${outlier ? ' is-outlier' : ''}`}
        tabIndex={0}
        aria-label={lines.join(' ')}
        {...tip.handlers}
      >
        {estimated ? '~' : ''}
        {formatMultipleText(value)}
      </span>
      {tip.node}
    </>
  );
}

function AccountCard({
  entry,
  now,
  language,
  tools,
}: {
  entry: CatalogEntry;
  now: number;
  language: UiLanguage;
  /** 右上角的图标按钮。 */
  tools?: ReactNode;
}) {
  const t = UI_COPY[language];
  const flagsCopy = INSIGHT_COPY[language];
  const { account } = entry;
  const tier = accountTier(account.followers);
  const ratio = followRatio(account.followingCount, account.followers);
  const flags = accountFlags({ ...account, now });
  const flagLabels: string[] = [
    flags.mutualFollowFarm ? flagsCopy.flagMutual : null,
    flags.newAccount ? flagsCopy.flagNew : null,
    flags.abnormalFollowRatio ? flagsCopy.flagRatio : null,
  ].filter((label): label is NonNullable<typeof label> => label !== null);
  // 账号资料是次要信息：照 X 主页的写法排成一行「1.2万 粉丝 · 3063 关注」
  // 计数是「数字 标签」；关注比是比值，写成「关注比 0.04」才读得顺
  const stats: Array<{ value: string; label: string; labelFirst?: boolean }> = [];
  if (account.followers !== undefined)
    stats.push({ value: formatCount(account.followers, language), label: t.profileFollowers });
  if (account.followingCount !== undefined) {
    stats.push({ value: formatCount(account.followingCount, language), label: t.profileFollowing });
  }
  if (ratio !== null) {
    stats.push({
      value: ratio < 0.01 ? '<0.01' : ratio.toFixed(2),
      label: t.profileRatio,
      labelFirst: true,
    });
  }
  if (account.tweets !== undefined)
    stats.push({ value: formatCount(account.tweets, language), label: t.profilePostsCount });
  const tierName =
    tier === null ? null : language === 'zh' ? TIER_NAMES[tier].zh : TIER_NAMES[tier].en;
  return (
    <section className="profile-card" aria-label={`@${account.handle}`}>
      <div className="profile-who">
        <Avatar item={account} />
        <div className="profile-names">
          <div className="post-who">
            <span className="post-name">{account.displayName ?? account.handle}</span>
            {account.verified ? <VerifiedMark label={t.verified} /> : null}
            {tierName ? (
              <span className="tier-tag" data-fs-tier-level={tier}>
                {tierName}
              </span>
            ) : null}
          </div>
          <div className="profile-sub">
            <span className="post-handle">@{account.handle}</span>
            {account.createdAt !== undefined ? (
              <span className="post-meta">
                {t.profileJoined(Math.floor((now - account.createdAt) / YEAR_MS))}
              </span>
            ) : null}
          </div>
        </div>
        {tools ? <div className="profile-tools">{tools}</div> : null}
      </div>
      {stats.length > 0 ? (
        <p className="profile-stats">
          {stats.map(({ value, label, labelFirst }) => (
            <span key={label}>
              {labelFirst ? (
                <>
                  {label} <b>{value}</b>
                </>
              ) : (
                <>
                  <b>{value}</b> {label}
                </>
              )}
            </span>
          ))}
        </p>
      ) : null}
      {flagLabels.length > 0 ? (
        <div className="profile-flags">
          {flagLabels.map((label) => (
            <span key={label} className="flag-tag">
              {label}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function BaselineLine({
  analysis,
  entry,
  now,
  language,
}: {
  analysis: ProfileAnalysis;
  entry: CatalogEntry;
  now: number;
  language: UiLanguage;
}) {
  const t = UI_COPY[language];
  const postCount = Object.keys(entry.posts).length;
  const since = new Date(entry.firstVisitAt).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en');
  const rate = analysis.outlierRate;
  const stats: Array<{ label: string; value: string; unit?: string; accent?: boolean }> = [
    {
      label: t.profileMedian,
      value: analysis.baseline
        ? formatCount(Math.round(analysis.baseline.medianViews), language)
        : '—',
    },
    {
      label: t.profileOutlierRate,
      value: rate === null ? '—' : String(Math.round(rate * 100)),
      ...(rate === null ? {} : { unit: '%' }),
      // 爆款率高的博主值得细看：和帖子上的爆款标签同一个金色
      accent: rate !== null && rate >= OUTLIER_RATE_ACCENT,
    },
    { label: t.profileCoverage, value: String(postCount), unit: t.profileCoverageUnit },
  ];
  const mature = analysis.baseline?.sample ?? 0;
  return (
    <section className="kpi-card">
      <dl>
        {stats.map((stat) => (
          <div key={stat.label} className={stat.accent ? 'is-accent' : undefined}>
            <dt>{stat.label}</dt>
            <dd>
              {stat.value}
              {stat.unit ? <small>{stat.unit}</small> : null}
            </dd>
          </div>
        ))}
      </dl>
      <span className="kpi-help">
        <HelpIcon
          text={
            analysis.baseline
              ? t.profileBaselineHint(mature, since)
              : t.profileSampleLow(Math.max(1, PROFILE_MIN_SAMPLE - countMature(entry, now)))
          }
        />
      </span>
    </section>
  );
}

function countMature(entry: CatalogEntry, now: number): number {
  const cutoff = now - 24 * 60 * 60 * 1000;
  return Object.values(entry.posts).filter(
    (post) =>
      post.kind !== 'reply' && post.views !== undefined && (post.createdAt ?? Infinity) <= cutoff,
  ).length;
}

function Patterns({
  analysis,
  language,
  open,
  onToggle,
}: {
  analysis: ProfileAnalysis;
  language: UiLanguage;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  const t = UI_COPY[language];
  const heatmap = analysis.heatmap;
  const hasHeat = heatmap !== null;
  if (analysis.formats.length === 0 && !hasHeat) return null;
  const top = Math.max(1, ...analysis.formats.map((item) => item.medianMultiple));
  // 默认收起：爆款列表是这一页的主角，规律点开再看
  return (
    <details
      className="profile-patterns"
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary className="patterns-summary">
        <AppIcon name="chevron" size={14} className="patterns-chevron" />
        {t.profilePatterns}
      </summary>
      {analysis.formats.length > 0 ? (
        <>
          <h3 className="section-title">
            {t.profileFormats}
            <HelpIcon text={t.profileFormatsHint} />
          </h3>
          <ul className="format-bars">
            {analysis.formats.map((item) => (
              <li key={item.format}>
                <span className="format-name">{t.profileFormatNames[item.format]}</span>
                <span className="format-bar" aria-hidden="true">
                  <span style={{ width: `${Math.max(4, (item.medianMultiple / top) * 100)}%` }} />
                </span>
                <span className="format-value">{formatMultipleText(item.medianMultiple)}</span>
                <span className="format-count">{t.profileFormatCount(item.count)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {hasHeat && heatmap ? (
        <>
          <h3 className="section-title">
            {t.profileHeatmap}
            <HelpIcon text={t.profileHeatmapHint} />
          </h3>
          <div className="heatmap" role="table" aria-label={t.profileHeatmap}>
            {heatmap.cells.map((row, day) => (
              <div className="heatmap-row" role="row" key={day}>
                <span className="heatmap-day" role="rowheader">
                  {t.profileWeekdays[day]}
                </span>
                {row.map((value, slot) => (
                  <span
                    key={slot}
                    role="cell"
                    className="heatmap-cell"
                    style={
                      value === null
                        ? undefined
                        : {
                            background: `rgba(255, 173, 31, ${Math.min(1, 0.15 + value / OUTLIER_MULTIPLE).toFixed(2)})`,
                          }
                    }
                    title={t.profileHeatCell(
                      t.profileWeekdays[day]!,
                      slot * HEATMAP_SLOT_HOURS,
                      (slot + 1) * HEATMAP_SLOT_HOURS,
                      value === null ? '—' : formatMultipleText(value),
                      heatmap.counts[day]![slot]!,
                    )}
                  />
                ))}
              </div>
            ))}
            <div className="heatmap-row heatmap-hours" aria-hidden="true">
              <span className="heatmap-day" />
              {Array.from(
                { length: 24 / HEATMAP_SLOT_HOURS },
                (_, i) => i * HEATMAP_SLOT_HOURS,
              ).map((hour) => (
                <span key={hour} className="heatmap-hour">
                  {hour}
                </span>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </details>
  );
}

export default function ProfileView({ language, notify, sendToXPage }: ProfileViewProps) {
  const t = UI_COPY[language];
  const handle = useActiveHandle();
  // undefined = 加载中；null = 还没有帖子库
  const [entry, setEntry] = useState<CatalogEntry | null | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const [sort, setSort] = useState<ProfileSort>('multiple');
  const [range, setRange] = useState<ProfileRange>('all');
  const [includeReplies, setIncludeReplies] = useState(false);
  const [patternsOpen, setPatternsOpen] = useState(true);
  // Google 搜索的小面板：关键词和时间范围
  const [googleOpen, setGoogleOpen] = useState(false);
  const [googleKeyword, setGoogleKeyword] = useState('');
  const [googleRange, setGoogleRange] = useState<GoogleRange>('any');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [visited, setVisited] = useState<Set<string>>(() => new Set());
  const [filling, setFilling] = useState(false);
  const sentinelRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    void browser.storage.local
      .get([SORT_KEY, RANGE_KEY, REPLIES_KEY, PATTERNS_KEY])
      .then((stored) => {
        if (isProfileSort(stored[SORT_KEY])) setSort(stored[SORT_KEY]);
        if (isProfileRange(stored[RANGE_KEY])) setRange(stored[RANGE_KEY]);
        if (typeof stored[REPLIES_KEY] === 'boolean') setIncludeReplies(stored[REPLIES_KEY]);
        if (typeof stored[PATTERNS_KEY] === 'boolean') setPatternsOpen(stored[PATTERNS_KEY]);
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(
    (target: string): Promise<CatalogEntry | null> =>
      browser.runtime.sendMessage({ type: 'feedsieve:profile-get', handle: target }).then(
        (value: unknown) => asCatalogEntry(value, target),
        () => null,
      ),
    [],
  );

  // 换了博主：重新取；后台帖子库更新了这个博主时跟着刷新
  useEffect(() => {
    if (!handle) return;
    let active = true;
    let debounce: number | undefined;
    const refresh = (): void => {
      void load(handle).then((next) => {
        if (!active) return;
        setEntry(next);
        setNow(Date.now());
      });
    };
    const onMessage = (message: unknown): void => {
      const msg = message as { type?: string; handles?: unknown } | null;
      if (msg?.type !== PROFILE_UPDATED_MESSAGE) return;
      if (!Array.isArray(msg.handles) || !msg.handles.includes(handle)) return;
      window.clearTimeout(debounce);
      debounce = window.setTimeout(refresh, UPDATE_DEBOUNCE_MS);
    };
    refresh();
    browser.runtime.onMessage.addListener(onMessage);
    const clock = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => {
      active = false;
      window.clearTimeout(debounce);
      window.clearInterval(clock);
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, [handle, load]);

  // 换博主、换排序：回到第一页（派生状态，不借 effect）
  const [pageKey, setPageKey] = useState('');
  const nextPageKey = `${handle}|${sort}|${range}|${includeReplies}`;
  if (pageKey !== nextPageKey) {
    setPageKey(nextPageKey);
    setVisibleCount(PAGE_SIZE);
  }

  const posts = useMemo(() => (entry ? Object.values(entry.posts) : []), [entry]);
  const analysis = useMemo(() => analyzeProfile(posts, now), [posts, now]);
  const list = useMemo(
    () => visiblePosts(posts, analysis, { sort, range, includeReplies, now }),
    [posts, analysis, sort, range, includeReplies, now],
  );
  const shown = list.slice(0, visibleCount);
  const hasMore = list.length > shown.length;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!hasMore || !sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((item) => item.isIntersecting)) setVisibleCount((n) => n + PAGE_SIZE);
      },
      { root: sentinel.closest('.popup-content'), rootMargin: '0px 0px 400px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, visibleCount]);

  function save(key: string, value: unknown): void {
    void browser.storage.local.set({ [key]: value }).catch(() => undefined);
  }

  async function openPost(event: MouseEvent<HTMLAnchorElement>, post: CatalogPost): Promise<void> {
    if (!handle) return;
    setVisited((prev) => new Set(prev).add(post.postId));
    void browser.runtime
      .sendMessage({ type: INSIGHT_READ_MESSAGE, postIds: [post.postId] })
      .catch(() => undefined);
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    const result = (await sendToXPage({
      type: 'feedsieve:scroll-to-post',
      postId: post.postId,
    }).catch(() => null)) as { found?: unknown } | null;
    if (result?.found === true) return;
    const url = postUrl(handle, post.postId);
    try {
      const [current] = await browser.tabs.query({ active: true, currentWindow: true });
      await browser.tabs.create({
        url,
        active: false,
        ...(current?.index !== undefined ? { index: current.index + 1 } : {}),
      });
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  }

  const searchQuery = handle
    ? `from:${handle} min_faves:${highLikesThreshold(analysis.baseline)}`
    : '';

  async function openTab(url: string): Promise<void> {
    try {
      const [current] = await browser.tabs.query({ active: true, currentWindow: true });
      await browser.tabs.create({
        url,
        active: true,
        ...(current?.index !== undefined ? { index: current.index + 1 } : {}),
      });
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  }

  function searchHighLikes(): void {
    void openTab(`https://x.com/search?q=${encodeURIComponent(searchQuery)}&src=typed_query&f=top`);
  }

  function searchGoogle(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!handle) return;
    void openTab(googleSearchUrl(handle, googleKeyword, googleRange));
    setGoogleOpen(false);
  }

  const numberText = (value: number): string => formatCount(value, language);

  /** 用户点「补全」：慢慢向下滚，让 X 自己加载更多帖子；再点一次停止。 */
  async function fillProfile(): Promise<void> {
    if (!handle) return;
    if (filling) {
      await sendToXPage({ type: 'feedsieve:profile-fill-stop' }).catch(() => undefined);
      return;
    }
    setFilling(true);
    notify(t.profileFillRunning);
    try {
      const result = (await sendToXPage({
        type: 'feedsieve:profile-fill',
        handle,
      })) as { ok?: boolean; added?: number; stopped?: string } | null;
      const next = await load(handle);
      setEntry(next);
      setNow(Date.now());
      if (result?.ok) {
        notify(result.added && result.added > 0 ? t.profileFillDone(result.added) : t.profileFillNone);
      } else if (result?.stopped === 'not-profile') {
        notify(t.profileFillNotProfile);
      } else {
        notify(t.profileFillFailed);
      }
    } catch {
      notify(t.profileFillFailed);
    } finally {
      setFilling(false);
    }
  }

  async function copyForAi(): Promise<void> {
    if (!handle) return;
    const markdown = outliersMarkdown(
      handle,
      topOutliers(posts, analysis),
      analysis,
      {
        header: t.profileAiHeader,
        meta: t.profileAiMeta,
        ask: t.profileAiAsk,
        item: t.profileAiItem,
      },
      { now, formatNumber: numberText },
    );
    try {
      await navigator.clipboard.writeText(markdown);
      notify(t.profileCopied);
    } catch {
      notify(t.profileActionFailed);
    }
  }

  async function shareImage(): Promise<void> {
    if (!handle || !entry) return;
    const postCount = Object.keys(entry.posts).length;
    const cardPosts = pickSharePosts(Object.values(entry.posts)).map((post) => ({
      post,
      multiple: analysis.scores.get(post.postId)?.multiple ?? null,
    }));
    const { account } = entry;
    try {
      const canvas = await drawProfileShareCard({
        handle: account.handle,
        ...(account.displayName ? { displayName: account.displayName } : {}),
        ...(account.avatarUrl ? { avatarUrl: account.avatarUrl } : {}),
        tier: accountTier(account.followers),
        medianViews: analysis.baseline?.medianViews ?? null,
        outlierRate: analysis.outlierRate,
        postCount,
        posts: cardPosts,
        lang: language,
        date: new Date(now),
      });
      const blob = await canvasToBlob(canvas);
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        notify(t.profileImageCopied);
      } catch {
        // 剪贴板写不进图片（权限或环境限制）就退回下载，别让用户白点一次
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `feedsieve-${handle}-${new Date(now).toISOString().slice(0, 10)}.png`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
        notify(t.profileImageDownloaded);
      }
    } catch {
      notify(t.profileActionFailed);
    }
  }

  function exportCsv(): void {
    if (!handle) return;
    try {
      const blob = new Blob([postsCsv(handle, list, analysis)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `feedsieve-${handle}-${new Date(now).toISOString().slice(0, 10)}.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      notify(t.profileExported);
    } catch {
      notify(t.profileActionFailed);
    }
  }

  if (!handle) {
    return (
      <div className="view profile-view">
        <div className="empty-state">
          <p>{t.profileNotOnProfile}</p>
          <HelpIcon text={t.profileNotOnProfileHint} />
        </div>
      </div>
    );
  }

  if (entry === undefined) {
    return (
      <div className="view profile-view">
        <div className="loading-list" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  const hasPosts = Boolean(entry && posts.length > 0);
  // 右上角的图标按钮：没有帖子时只留两个搜索（复制、导出没东西可用）
  const tools = (
    <>
      <IconButton
        icon={filling ? 'x' : 'chevrons-down'}
        label={filling ? t.profileFillStop : t.profileFill}
        hint={filling ? undefined : t.profileFillHint}
        onClick={() => void fillProfile()}
      />
      <IconButton
        icon="search"
        label={t.profileSearchHighLikes}
        hint={t.profileSearchHint(searchQuery)}
        onClick={searchHighLikes}
      />
      <IconButton
        icon="globe"
        label={t.profileGoogle}
        hint={t.profileGoogleHint}
        onClick={() => setGoogleOpen(!googleOpen)}
      />
      {hasPosts && analysis.baseline ? (
        <IconButton
          icon="sparkles"
          label={t.profileCopyAi}
          hint={t.profileCopyAiHint}
          onClick={() => void copyForAi()}
        />
      ) : null}
      {hasPosts && analysis.baseline ? (
        <IconButton
          icon="image"
          label={t.profileShareImage}
          hint={t.profileShareImageHint}
          onClick={() => void shareImage()}
        />
      ) : null}
      {hasPosts ? (
        <IconButton
          icon="download"
          label={t.profileExportCsv}
          hint={t.profileExportHint}
          onClick={exportCsv}
        />
      ) : null}
    </>
  );

  const googlePanel = googleOpen ? (
    <form
      className="google-search"
      onSubmit={searchGoogle}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setGoogleOpen(false);
      }}
    >
      <input
        type="text"
        // 用户主动点开的小面板：直接聚焦输入框
        autoFocus
        value={googleKeyword}
        placeholder={t.profileGoogleKeyword}
        aria-label={t.profileGoogleKeyword}
        onChange={(event) => setGoogleKeyword(event.target.value)}
      />
      <select
        className="sort-select"
        aria-label={t.profileRange}
        value={googleRange}
        onChange={(event) => setGoogleRange(event.target.value as GoogleRange)}
      >
        {GOOGLE_RANGES.map((option) => (
          <option key={option} value={option}>
            {t.profileGoogleRange[option]}
          </option>
        ))}
      </select>
      <button type="submit" className="primary-button">
        {t.profileGoogleGo}
      </button>
    </form>
  ) : null;

  if (!entry || !hasPosts) {
    return (
      <div className="view profile-view">
        {entry ? <AccountCard entry={entry} now={now} language={language} tools={tools} /> : null}
        {googlePanel}
        <div className="empty-state">
          <p>{t.profileEmpty}</p>
          <HelpIcon text={t.profileEmptyHint} />
        </div>
      </div>
    );
  }

  return (
    <div className="view profile-view">
      <AccountCard entry={entry} now={now} language={language} tools={tools} />
      {googlePanel}
      <BaselineLine analysis={analysis} entry={entry} now={now} language={language} />

      <Patterns
        analysis={analysis}
        language={language}
        open={patternsOpen}
        onToggle={(next) => {
          if (next === patternsOpen) return;
          setPatternsOpen(next);
          save(PATTERNS_KEY, next);
        }}
      />

      <div className="view-toolbar">
        <select
          className="sort-select"
          aria-label={t.profileSort}
          value={sort}
          onChange={(event) => {
            if (!isProfileSort(event.target.value)) return;
            setSort(event.target.value);
            save(SORT_KEY, event.target.value);
          }}
        >
          {PROFILE_SORTS.map((option) => (
            <option key={option} value={option}>
              {t.profileSortOptions[option]}
            </option>
          ))}
        </select>
        <select
          className="sort-select"
          aria-label={t.profileRange}
          value={range}
          onChange={(event) => {
            if (!isProfileRange(event.target.value)) return;
            setRange(event.target.value);
            save(RANGE_KEY, event.target.value);
          }}
        >
          {PROFILE_RANGES.map((option) => (
            <option key={option} value={option}>
              {t.profileRangeOptions[option]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`chip${includeReplies ? ' is-on' : ''}`}
          aria-pressed={includeReplies}
          onClick={() => {
            setIncludeReplies(!includeReplies);
            save(REPLIES_KEY, !includeReplies);
          }}
        >
          {t.profileIncludeReplies}
        </button>
      </div>

      {list.length === 0 ? (
        <div className="empty-state">
          <p>{t.allFiltered}</p>
        </div>
      ) : (
        <ol className="hot-list profile-list" aria-label={`@${handle}`}>
          {shown.map((post) => {
            const score = analysis.scores.get(post.postId);
            const text = readableText(post.snippet);
            return (
              <li key={post.postId}>
                <a
                  className={`post profile-post${visited.has(post.postId) ? ' is-visited' : ''}`}
                  href={postUrl(handle, post.postId)}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`${t.profileOpenPost}: ${post.postId}`}
                  onClick={(event) => void openPost(event, post)}
                >
                  <div className="post-main">
                    <div className="post-head">
                      <div className="post-who">
                        {post.createdAt !== undefined ? (
                          <span className="post-meta is-first">
                            {shortAgo(post.createdAt, now, language)}
                          </span>
                        ) : null}
                        {post.pinned ? (
                          <span className="kind-tag">{t.profileKind.pinned}</span>
                        ) : null}
                        {post.kind === 'quote' || post.kind === 'reply' ? (
                          <span className="kind-tag">{t.profileKind[post.kind]}</span>
                        ) : null}
                        {score?.boosted ? (
                          <span className="kind-tag is-warn" title={t.profileBoostedHint}>
                            {t.profileBoosted}
                          </span>
                        ) : null}
                      </div>
                      {score?.multiple !== null && score?.multiple !== undefined ? (
                        <MultipleBadge
                          value={score.multiple}
                          estimated={score.estimated}
                          boosted={score.boosted}
                          views={post.views}
                          medianViews={analysis.baseline?.medianViews ?? 0}
                          language={language}
                        />
                      ) : null}
                    </div>
                    {text ? <p className="post-text">{text}</p> : null}
                    {post.mediaUrl ? (
                      <img
                        className="post-media"
                        src={`${post.mediaUrl}?name=small`}
                        alt=""
                        loading="lazy"
                        draggable={false}
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : null}
                    <PostActions item={post} language={language} showBookmarks />
                  </div>
                </a>
              </li>
            );
          })}
          {hasMore ? <li ref={sentinelRef} className="list-sentinel" aria-hidden="true" /> : null}
        </ol>
      )}
    </div>
  );
}
