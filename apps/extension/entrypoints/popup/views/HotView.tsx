import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';
import { showToast as pushToast, type ToastAction } from '../../../src/lib/platform/toast';
import { formatCount, formatVelocity, velocityLabel } from '../../../src/lib/insight/format';
import { INSIGHT_UPDATED_MESSAGE } from '../../../src/lib/insight/shared-insight';
import { INSIGHT_READ_MESSAGE } from '../../../src/lib/insight/read-tracker';
import { API_BASE } from '../../../src/lib/platform/api-base';
import {
  hotSortKey,
  isHotSort,
  HOT_SORTS,
  type HotSort,
} from '../../../src/lib/insight/tweet-stats';
import { resolveConfig, velocityLevel } from '@feedsieve/metrics';
import {
  AppIcon,
  asGlobalHotList,
  asHotPostList,
  asPageBrief,
  EmptyState,
  HelpIcon,
  SkeletonList,
  type GlobalHotList,
  type HotPostItem,
  type PageBriefItem,
} from './shared';
import {
  Avatar,
  LineIcon,
  PostActions,
  readableText,
  shortAgo,
  TierPill,
  VerifiedMark,
} from './post-parts';

export { LineIcon };

/**
 * 有新数据时后台会广播，列表马上跟着刷新；这个间隔只是兜底：
 * 没有新数据时，流速和「几分钟前」也会随时间变化，每分钟重算一次。
 */
const FALLBACK_REFRESH_MS = 60_000;
/** 后台广播很密时（快速滚动），合并成一次重取。 */
const UPDATE_DEBOUNCE_MS = 500;
/** 每次多显示这么多条：列表可能有上百条，一次全挂上去滚动会卡。 */
const PAGE_SIZE = 20;
/** 滚动位置在这么多像素以内算停在顶部。 */
const AT_TOP_PX = 8;
/** 全站热榜服务端每 5 分钟重算一次，弹窗跟着 5 分钟取一次（带 ETag，没变化服务端回 304）。 */
const GLOBAL_REFRESH_MS = 5 * 60_000;
/** 上次取到的全站热榜：打开弹窗先显示它，连不上服务器时也有东西看。 */
const GLOBAL_CACHE_KEY = 'hotGlobalCacheV1';
/** 名次上升这么多才标「↑」。 */
const RANK_UP_MIN = 3;
const REPLY_SMOOTHING = resolveConfig().replyCompetitionSmoothing;

type HotScope = 'mine' | 'global';

/**
 * 全站热榜：「飙升」和「24 小时」是服务端排好的两个榜；其他排序在「飙升」榜上本地重排（同分保持原顺序）。
 * 「飙升」和「我刷到的」一样，流速没到「火了」的不显示；「24 小时」收已经降温的大帖。
 */
function sortGlobal(list: GlobalHotList, sort: HotSort): HotPostItem[] {
  if (sort === 'day') return list.day;
  const hot = list.items.filter((item) => velocityLevel(item.velocity) !== 'none');
  if (sort === 'heat') return hot;
  const ranked = hot
    .filter((item) => sort !== 'opportunity' || item.opportunity !== null)
    .map((item) => ({
      item,
      key: hotSortKey(
        {
          ...item,
          heat: null,
          opportunity: item.opportunity
            ? {
                score:
                  item.opportunity.remainingViews /
                  (item.opportunity.competition + REPLY_SMOOTHING),
              }
            : null,
        },
        sort,
      ),
    }));
  return ranked.sort((a, b) => b.key - a.key).map(({ item }) => item);
}

interface HotViewProps {
  language: UiLanguage;
  sendToXPage: (message: { type: string; sort?: HotSort; postId?: string }) => Promise<unknown>;
  onOpenSettings: () => void;
}

/** 本页概况：一行三个数。 */
function BriefLine({ brief, language }: { brief: PageBriefItem; language: UiLanguage }) {
  const t = UI_COPY[language];
  const stats: Array<[string, string]> = [
    [t.briefSeen, String(brief.seen)],
    [t.briefHot, String(brief.hot)],
    [t.briefMedian, brief.medianVelocity === null ? '—' : formatVelocity(brief.medianVelocity)],
  ];
  // 和「主页」的洞察卡片同一种样式：浅底卡片，标签在上、数字在下
  return (
    <section className="kpi-card is-compact" aria-label={t.briefTitle}>
      <dl className="brief-line">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** 回复机会排序时多一行理由：还能涨多少浏览、已有几条回复、窗口还剩多久。 */
function HotInsight({
  item,
  sort,
  language,
}: {
  item: HotPostItem;
  sort: HotSort;
  language: UiLanguage;
}) {
  const t = UI_COPY[language];
  if (sort === 'opportunity' && item.opportunity) {
    const { remainingViews, competition, hoursLeft } = item.opportunity;
    return (
      <div className="hot-insight">
        <span className="metric-lead">
          {t.opportunityRemaining(formatCount(remainingViews, language))}
        </span>
        <span>{t.opportunityCompetition(competition)}</span>
        <span>{t.opportunityHoursLeft(Math.max(1, Math.round(hoursLeft)))}</span>
      </div>
    );
  }
  return null;
}

type LangFilter = 'zh' | 'all';
const LANG_KEY = 'hotLangV1';
const HIDE_READ_KEY = 'hotHideReadV1';
const SORT_KEY = 'hotSortV1';
/** 用户点了「不看」的帖子和作者（跨次打开保留）。 */
const DISMISSED_KEY = 'hotDismissedV1';
const MUTED_KEY = 'hotMutedV1';
const MAX_DISMISSED = 1_000;
const MAX_MUTED = 500;
/** 上次打开时列表里有哪些帖子（storage.session：和热帖数据一样，浏览器关闭即清空）。 */
const LAST_LIST_KEY = 'hotLastListV1';
const MAX_LAST_LIST = 600;
const LAST_LIST_WRITE_MS = 500;
/** 各「范围 + 排序」停在哪（storage.session）：切到别的栏目再回来也回到原处。 */
const POSITIONS_KEY = 'hotPositionsV1';
const POSITIONS_WRITE_MS = 500;
const MAX_SAVED_COUNT = 10_000;
/** 滚动停下这么久之后，才算「没在看」，新帖子才会直接插进来。 */
const SCROLL_SETTLE_MS = 1_000;
const TOAST_MS = 1_500;
const UNDO_TOAST_MS = 4_000;
/** X 用这些代码表示「没有可识别的文字」（纯图片、纯链接、表情等），按中文筛选时也保留。 */
const NO_LANGUAGE = new Set(['und', 'zxx', 'qme', 'qam', 'qct', 'qht', 'qst']);

function matchesLang(item: HotPostItem, filter: LangFilter): boolean {
  if (filter === 'all' || !item.lang) return true;
  return item.lang.startsWith('zh') || NO_LANGUAGE.has(item.lang);
}

/**
 * 全站没有「最近刷到」（那是你自己的滑动记录），「我刷到的」没有「24 小时」（只留最近 2 小时），
 * 切过去时按热度。
 */
function effectiveSort(scope: HotScope, sort: HotSort): HotSort {
  if (scope === 'global' && sort === 'recent') return 'heat';
  if (scope === 'mine' && sort === 'day') return 'heat';
  return sort;
}

/** 名次前面的变化标记：新上榜 / 上升 N 名；没有参照（第一版榜）时不标。 */
function RankTrend({
  item,
  hasReference,
  language,
}: {
  item: HotPostItem;
  hasReference: boolean;
  language: UiLanguage;
}) {
  const t = UI_COPY[language];
  if (item.rankDelta === null && hasReference) {
    return (
      <span className="rank-trend is-new" title={t.hotRankNew}>
        {t.hotRankNewShort}
      </span>
    );
  }
  if (typeof item.rankDelta === 'number' && item.rankDelta >= RANK_UP_MIN) {
    return (
      <span className="rank-trend is-up" title={t.hotRankUp(item.rankDelta)}>
        ↑{item.rankDelta}
      </span>
    );
  }
  return null;
}

function viewKey(scope: HotScope, sort: HotSort): string {
  return `${scope}|${effectiveSort(scope, sort)}`;
}

/** 读回上次存下的滚动位置；坏数据（非数字、负数）直接跳过。 */
function parsePositions(value: unknown): Map<string, { top: number; count: number }> {
  const positions = new Map<string, { top: number; count: number }>();
  if (!value || typeof value !== 'object') return positions;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const { top, count } = raw as { top?: unknown; count?: unknown };
    if (typeof top !== 'number' || !Number.isFinite(top) || top < 0) continue;
    if (typeof count !== 'number' || !Number.isFinite(count) || count < PAGE_SIZE) continue;
    positions.set(key, { top, count: Math.min(MAX_SAVED_COUNT, Math.floor(count)) });
  }
  return positions;
}

function stringList(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').slice(-max)
    : [];
}

/** storage.session 在部分环境（旧浏览器、测试）里没有。 */
function sessionStorageArea(): typeof browser.storage.local | null {
  return (browser.storage as { session?: typeof browser.storage.local }).session ?? null;
}

/**
 * 一种「范围 + 排序」下当前显示的一批：用户正在看列表时不重排它，只刷新数字，
 * 有新帖子时顶部出现提示条，点了才换成新的一批；没在看时新帖子直接进来。
 * 每种排序各自保留一批，切走再切回来还是原来那批、原来的位置。
 * hiddenRead 是这一批出现时就已经读过的帖子：隐藏它们；之后才读的只变淡，不消失。
 * 本次从弹窗点开过的（keep）不算，免得换批时从手底下消失。
 * fresh 是新进来的帖子（比上一批、或比上次打开时多出来的），左侧带一个蓝点。
 */
interface Snapshot {
  key: string;
  items: HotPostItem[];
  hiddenRead: Set<string>;
  fresh: Set<string>;
}

function makeSnapshot(
  key: string,
  items: HotPostItem[],
  options: {
    previous?: Snapshot | null;
    keep?: Set<string>;
    keepFresh?: boolean;
    /** 第一次显示这种排序时，和上次打开弹窗时的列表比 */
    baseline?: Set<string> | null;
  } = {},
): Snapshot {
  const previous = options.previous && options.previous.key === key ? options.previous : null;
  const before = previous
    ? new Set(previous.items.map((item) => item.postId))
    : options.baseline && options.baseline.size > 0
      ? options.baseline
      : null;
  const fresh = new Set<string>();
  if (before) {
    for (const item of items) {
      if (!before.has(item.postId) || (options.keepFresh && previous?.fresh.has(item.postId))) {
        fresh.add(item.postId);
      }
    }
  }
  return {
    key,
    items,
    fresh,
    hiddenRead: new Set(
      items
        .filter((item) => item.read && !options.keep?.has(item.postId))
        .map((item) => item.postId),
    ),
  };
}

/** 新数据里有多少条是当前这批里没有的（只数会显示出来的：语言匹配、没读过、没被隐藏）。 */
export function countNewPosts(
  snapshot: HotPostItem[],
  incoming: HotPostItem[],
  filter: LangFilter,
  excluded: (item: HotPostItem) => boolean = () => false,
): number {
  const shown = new Set(snapshot.map((item) => item.postId));
  return incoming.filter(
    (item) => !shown.has(item.postId) && !item.read && matchesLang(item, filter) && !excluded(item),
  ).length;
}

/** 列表里的一行：同一作者的多条热帖收成一组，只显示最靠前的一条。 */
interface Row {
  item: HotPostItem;
  /** 组长下面藏着的同作者帖子数（展开后为 0，跟在后面单独成行） */
  more: number;
  expanded: boolean;
  leader: boolean;
}

export function groupByAuthor(list: HotPostItem[], expanded: ReadonlySet<string>): Row[] {
  const byAuthor = new Map<string, HotPostItem[]>();
  for (const item of list) {
    const group = byAuthor.get(item.handle);
    if (group) group.push(item);
    else byAuthor.set(item.handle, [item]);
  }
  const rows: Row[] = [];
  for (const item of list) {
    const group = byAuthor.get(item.handle)!;
    if (group[0] !== item) continue;
    const open = expanded.has(item.handle);
    rows.push({ item, more: group.length - 1, expanded: open, leader: true });
    if (open) {
      for (const rest of group.slice(1)) {
        rows.push({ item: rest, more: 0, expanded: true, leader: false });
      }
    }
  }
  return rows;
}

function ToggleChip({
  pressed,
  onToggle,
  children,
}: {
  pressed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`chip${pressed ? ' is-on' : ''}`}
      aria-pressed={pressed}
      onClick={onToggle}
    >
      {pressed ? <AppIcon name="check" size={12} /> : null}
      {children}
    </button>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName))
  );
}

export default function HotView({ language, sendToXPage, onOpenSettings }: HotViewProps) {
  const t = UI_COPY[language];
  const [sort, setSort] = useState<HotSort>('heat');
  const [scope, setScope] = useState<HotScope>('mine');
  const [langFilter, setLangFilter] = useState<LangFilter>(language === 'zh' ? 'zh' : 'all');
  const [hideRead, setHideRead] = useState(true);
  // 偏好、隐藏名单、上次的列表都读完才出第一批：排序不会先按热度闪一下再跳
  const [prefsReady, setPrefsReady] = useState(false);
  // 已显示的条数：滚到列表底部时自动多显示一页
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLLIElement | null>(null);
  const listTopRef = useRef<HTMLDivElement | null>(null);
  // 全站热榜：undefined = 还没取；null = 取失败
  const [global, setGlobal] = useState<GlobalHotList | null | undefined>(undefined);
  // 最近一次取全站热榜失败（显示的是缓存）
  const [globalStale, setGlobalStale] = useState(false);
  // 手动刷新：每点一次加 1，触发重新取（跳过浏览器缓存，服务端没变化回 304）
  const [globalReload, setGlobalReload] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // 「我刷到的」按排序取：带上是哪种排序取的，切排序时旧顺序不会被当成新排序的一批
  const [mine, setMine] = useState<{ sort: HotSort; items: HotPostItem[] } | null>(null);
  const [brief, setBrief] = useState<PageBriefItem | null>(null);
  // 已读的帖子 ID（全站热榜按它标已读；「我刷到的」由后台直接带 read 字段）
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});
  // 相对时间的基准：随每次拉取刷新，渲染期不调 Date.now
  const [now, setNow] = useState(() => Date.now());
  // 本次打开过的帖子：变淡，方便连续往下看
  const [visited, setVisited] = useState<Set<string>>(() => new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [muted, setMuted] = useState<Set<string>>(() => new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [expandedAuthors, setExpandedAuthors] = useState<Set<string>>(() => new Set());
  // 上次打开弹窗时列表里的帖子：第一批里比它多出来的带蓝点
  const [baseline, setBaseline] = useState<Record<HotScope, Set<string>> | null>(null);
  // 用户是否正在看列表：滚离顶部、刚滚过、鼠标在列表上、键盘焦点在列表里
  const [atTop, setAtTop] = useState(true);
  const [scrolling, setScrolling] = useState(false);
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);

  const [liveText, setLiveText] = useState('');
  // 每种「范围 + 排序」各自的滚动位置和已加载条数
  const positions = useRef(new Map<string, { top: number; count: number }>());
  const pendingRestore = useRef<number | null>(null);
  // 滚动时记下的最新位置：切走时弹窗内容已经换掉，不能再从 DOM 读 scrollTop
  const lastScrollTop = useRef(0);
  // 没动过列表就不写：StrictMode 会在挂载后先跑一次清理，别拿初始的 0 覆盖上次的位置
  const dirty = useRef(false);

  // 偏好跨次打开保留
  useEffect(() => {
    const session = sessionStorageArea();
    void Promise.all([
      browser.storage.local
        .get([LANG_KEY, HIDE_READ_KEY, SORT_KEY, DISMISSED_KEY, MUTED_KEY])
        .catch(() => ({}) as Record<string, unknown>),
      session
        ? session.get([LAST_LIST_KEY, POSITIONS_KEY]).catch(() => ({}) as Record<string, unknown>)
        : Promise.resolve({} as Record<string, unknown>),
    ]).then(([stored, last]) => {
      if (stored[LANG_KEY] === 'zh' || stored[LANG_KEY] === 'all') setLangFilter(stored[LANG_KEY]);
      if (typeof stored[HIDE_READ_KEY] === 'boolean') setHideRead(stored[HIDE_READ_KEY]);
      const savedSort = isHotSort(stored[SORT_KEY]) ? stored[SORT_KEY] : 'heat';
      setSort(savedSort);
      setDismissed(new Set(stringList(stored[DISMISSED_KEY], MAX_DISMISSED)));
      setMuted(new Set(stringList(stored[MUTED_KEY], MAX_MUTED)));
      const lastList = (last[LAST_LIST_KEY] ?? {}) as Partial<Record<HotScope, unknown>>;
      setBaseline({
        mine: new Set(stringList(lastList.mine, MAX_LAST_LIST)),
        global: new Set(stringList(lastList.global, MAX_LAST_LIST)),
      });
      // 上次离开时停在哪：连已加载条数一起恢复，否则列表不够长撑不起这个位置
      positions.current = parsePositions(last[POSITIONS_KEY]);
      const saved = positions.current.get(viewKey('mine', savedSort));
      setVisibleCount(saved?.count ?? PAGE_SIZE);
      pendingRestore.current = saved?.top ?? 0;
      setPrefsReady(true);
    });
  }, []);

  // 热帖由后台汇总所有 X 标签页的数据（shared-insight.ts），不依赖当前是哪个标签页。
  // 只返回 Promise，状态在 .then 里写：effect 里不同步 setState
  const fetchAll = useCallback(
    (): Promise<[HotPostItem[], PageBriefItem | null, string[]]> =>
      Promise.all([
        browser.runtime
          .sendMessage({ type: 'feedsieve:hot-posts', sort: effectiveSort('mine', sort) })
          .then(asHotPostList, () => []),
        browser.runtime.sendMessage({ type: 'feedsieve:hot-brief' }).then(asPageBrief, () => null),
        browser.runtime.sendMessage({ type: 'feedsieve:hot-read-ids' }).then(
          (ids: unknown) => (Array.isArray(ids) ? (ids as string[]) : []),
          () => [],
        ),
      ]),
    [sort],
  );

  useEffect(() => {
    let active = true;
    let debounce: number | undefined;
    const load = (): void => {
      void fetchAll().then(([nextItems, nextBrief, nextRead]) => {
        if (!active) return;
        setMine({ sort: effectiveSort('mine', sort), items: nextItems });
        setBrief(nextBrief);
        setReadIds(new Set(nextRead));
        setNow(Date.now());
      });
    };
    const onMessage = (message: unknown): void => {
      if ((message as { type?: string } | null)?.type !== INSIGHT_UPDATED_MESSAGE) return;
      window.clearTimeout(debounce);
      debounce = window.setTimeout(load, UPDATE_DEBOUNCE_MS);
    };
    load();
    browser.runtime.onMessage.addListener(onMessage);
    const timer = window.setInterval(load, FALLBACK_REFRESH_MS);
    return () => {
      active = false;
      window.clearTimeout(debounce);
      window.clearInterval(timer);
      browser.runtime.onMessage.removeListener(onMessage);
    };
  }, [fetchAll, sort]);

  // 只在切到「全站」时才去取；读榜单不上报任何数据。先显示上次取到的，再去服务器取新的
  useEffect(() => {
    if (scope !== 'global') return;
    let active = true;
    let fetched = false;
    void browser.storage.local
      .get(GLOBAL_CACHE_KEY)
      .then((stored) => {
        if (!active || fetched) return;
        const cached = asGlobalHotList(stored[GLOBAL_CACHE_KEY], Date.now());
        if (cached) setGlobal((prev) => prev ?? cached);
      })
      .catch(() => undefined);
    const load = (cache: RequestCache): void => {
      void fetch(`${API_BASE}/v1/hot`, { credentials: 'omit', cache })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null)
        .then((body: unknown) => {
          if (!active) return;
          const at = Date.now();
          const parsed = asGlobalHotList(body, at);
          if (parsed) {
            fetched = true;
            setGlobal(parsed);
            setGlobalStale(false);
            void browser.storage.local.set({ [GLOBAL_CACHE_KEY]: body }).catch(() => undefined);
          } else {
            // 连不上：有缓存就接着显示缓存，没有才显示「暂时不可用」
            setGlobal((prev) => prev ?? null);
            setGlobalStale(true);
          }
          setNow(at);
          setRefreshing(false);
        });
    };
    load(globalReload > 0 ? 'no-cache' : 'default');
    const timer = window.setInterval(() => load('default'), GLOBAL_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [scope, globalReload]);

  /** 热帖的瞬时提示：纯提示 1.5 秒；带「撤销 / 不看」的留 4 秒。走 App 的统一吐司通道。 */
  function showToast(text: string, actions?: ToastAction[]): void {
    pushToast(text, {
      duration: actions?.length ? UNDO_TOAST_MS : TOAST_MS,
      ...(actions?.length ? { actions } : {}),
    });
  }

  function markRead(postId: string): void {
    setVisited((prev) => new Set(prev).add(postId));
    void browser.runtime
      .sendMessage({ type: INSIGHT_READ_MESSAGE, postIds: [postId] })
      .catch(() => undefined);
  }

  /**
   * 推文还在当前页面上就滚过去高亮；否则在后台新开标签页。
   * 不切换当前标签页：可以连续打开多条。两种结果都给一句自动消失的提示。
   */
  async function openPost(event: MouseEvent<HTMLAnchorElement>, item: HotPostItem): Promise<void> {
    markRead(item.postId);
    // 带修饰键的点击（新标签页 / 新窗口）保持浏览器默认行为
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    const result = (await sendToXPage({
      type: 'feedsieve:scroll-to-post',
      postId: item.postId,
    }).catch(() => null)) as { found?: unknown } | null;
    if (result?.found === true) {
      showToast(t.hotToastLocated);
      return;
    }
    const url = `https://x.com/${item.handle}/status/${item.postId}`;
    try {
      const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true });
      await browser.tabs.create({
        url,
        active: false,
        ...(currentTab?.index !== undefined ? { index: currentTab.index + 1 } : {}),
        ...(currentTab?.id !== undefined ? { openerTabId: currentTab.id } : {}),
      });
      showToast(t.hotToastOpened);
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  }

  /** 回复：直接打开 X 官方的回复框（前台打开，用户要马上写）。 */
  async function openReply(item: HotPostItem): Promise<void> {
    markRead(item.postId);
    const url = `https://x.com/intent/post?in_reply_to=${item.postId}`;
    try {
      await browser.tabs.create({ url, active: true });
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  }

  function saveDismissed(next: Set<string>): void {
    setDismissed(next);
    void browser.storage.local.set({ [DISMISSED_KEY]: [...next].slice(-MAX_DISMISSED) });
  }

  function saveMuted(next: Set<string>): void {
    setMuted(next);
    void browser.storage.local.set({ [MUTED_KEY]: [...next].slice(-MAX_MUTED) });
  }

  function muteAuthor(handle: string): void {
    const next = new Set(muted).add(handle);
    saveMuted(next);
    showToast(t.hotToastMuted(handle), [
      {
        label: t.hotUndo,
        run: () => {
          const undo = new Set(next);
          undo.delete(handle);
          saveMuted(undo);
        },
      },
    ]);
  }

  /** 不看这条：提示里可以撤销，也可以顺手不看这个作者。 */
  function dismissPost(item: HotPostItem): void {
    const next = new Set(dismissed).add(item.postId);
    saveDismissed(next);
    showToast(t.hotToastDismissed, [
      {
        label: t.hotUndo,
        run: () => {
          const undo = new Set(next);
          undo.delete(item.postId);
          saveDismissed(undo);
        },
      },
      { label: t.hotMuteAuthor(item.handle), run: () => muteAuthor(item.handle) },
    ]);
  }

  function restorePost(item: HotPostItem): void {
    if (dismissed.has(item.postId)) {
      const next = new Set(dismissed);
      next.delete(item.postId);
      saveDismissed(next);
    }
    if (muted.has(item.handle)) {
      const next = new Set(muted);
      next.delete(item.handle);
      saveMuted(next);
    }
  }

  function scrollContainer(): Element | null {
    return listTopRef.current?.closest('.popup-content') ?? null;
  }

  /** 把各排序的位置写回 storage.session：下次打开弹窗、或切回这一屏时恢复。 */
  function persistPositions(): void {
    const session = sessionStorageArea();
    if (!session) return;
    void session
      .set({ [POSITIONS_KEY]: Object.fromEntries(positions.current) })
      .catch(() => undefined);
  }

  /** 切换范围 / 排序：记下这一页的位置，切到的那一页回到它上次的位置。 */
  function switchView(nextScope: HotScope, nextSort: HotSort): void {
    const nextKey = viewKey(nextScope, nextSort);
    if (nextKey === key) return;
    positions.current.set(key, { top: scrollContainer()?.scrollTop ?? 0, count: visibleCount });
    const saved = positions.current.get(nextKey);
    setVisibleCount(saved?.count ?? PAGE_SIZE);
    pendingRestore.current = saved?.top ?? 0;
  }

  function changeScope(next: HotScope): void {
    switchView(next, sort);
    setScope(next);
  }

  function changeSort(next: HotSort): void {
    switchView(scope, next);
    setSort(next);
    void browser.storage.local.set({ [SORT_KEY]: next });
  }

  function changeLangFilter(next: LangFilter): void {
    setLangFilter(next);
    void browser.storage.local.set({ [LANG_KEY]: next });
  }

  function changeHideRead(next: boolean): void {
    setHideRead(next);
    void browser.storage.local.set({ [HIDE_READ_KEY]: next });
  }

  const isGlobal = scope === 'global';
  const activeSort = effectiveSort(scope, sort);
  const sortOptions = HOT_SORTS.filter((option) =>
    isGlobal ? option !== 'recent' : option !== 'day',
  );
  const sortLabel = (option: HotSort): string =>
    isGlobal && option === 'heat' ? t.hotSortRising : t.hotSortOptions[option];
  // 「热度」「飙升」「24 小时」是榜，显示名次；其他排序只是换个顺序看
  const ranked = activeSort === 'heat' || activeSort === 'day';
  // 「最近刷到」就是回看刚滑过的帖子，停留过的也要在；只有从弹窗点开过的变淡
  const applyHideRead = hideRead && activeSort !== 'recent';
  const key = viewKey(scope, sort);
  // 滚动回调里读最新的 key 和已加载条数
  const viewState = useRef({ key, count: visibleCount });
  useEffect(() => {
    viewState.current = { key, count: visibleCount };
  }, [key, visibleCount]);
  const incoming: HotPostItem[] | null = !prefsReady
    ? null
    : isGlobal
      ? global
        ? sortGlobal(
            {
              ...global,
              items: global.items.map((item) => ({ ...item, read: readIds.has(item.postId) })),
              day: global.day.map((item) => ({ ...item, read: readIds.has(item.postId) })),
            },
            activeSort,
          )
        : null
      : mine && mine.sort === activeSort
        ? mine.items
        : null;
  const isHidden = (item: HotPostItem): boolean =>
    dismissed.has(item.postId) || muted.has(item.handle);
  const looking = !atTop || scrolling || pointerInside || focusInside;

  function putSnapshot(next: Snapshot): void {
    setSnapshots((prev) => ({ ...prev, [next.key]: next }));
  }

  // 第一次显示这种排序、或者这批是空的：直接换成新的一批（派生状态，不借 effect）
  const existing = snapshots[key];
  if (incoming && (!existing || (existing.items.length === 0 && incoming.length > 0))) {
    putSnapshot(
      makeSnapshot(key, incoming, { keep: visited, baseline: existing ? null : baseline?.[scope] }),
    );
  }
  const current = existing ?? null;
  const newCount =
    current && incoming ? countNewPosts(current.items, incoming, langFilter, isHidden) : 0;
  // 没在看列表：新帖子直接进来，蓝点累积到用户回来看
  if (current && incoming && newCount > 0 && !looking) {
    putSnapshot(makeSnapshot(key, incoming, { previous: current, keep: visited, keepFresh: true }));
    const announce = t.hotNewArrived(newCount);
    if (liveText !== announce) setLiveText(announce);
  }

  // 当前这批里的帖子换成最新数字，顺序不动
  const latest = new Map((incoming ?? []).map((item) => [item.postId, item]));
  const batch = (current?.items ?? []).map((item) => latest.get(item.postId) ?? item);
  const inLanguage = batch.filter((item) => matchesLang(item, langFilter));
  const hiddenByUser = inLanguage.filter(isHidden);
  const visible = showHidden ? inLanguage : inLanguage.filter((item) => !isHidden(item));
  const hiddenCount = applyHideRead
    ? visible.filter((item) => current?.hiddenRead.has(item.postId)).length
    : 0;
  const list = applyHideRead
    ? visible.filter((item) => !current?.hiddenRead.has(item.postId))
    : visible;
  const rows = groupByAuthor(list, expandedAuthors);
  // 名次：全站用榜上的名次（隐藏、已读的也占位，和别人看到的一致）；我刷到的按列表位置
  const localRank = new Map(list.map((item, index) => [item.postId, index + 1]));
  const rankOf = (item: HotPostItem): number | null =>
    ranked ? (isGlobal ? (item.rank ?? null) : (localRank.get(item.postId) ?? null)) : null;
  // 有参照（不是服务端第一版榜）时才标「新」
  const hasReference = isGlobal && batch.some((item) => typeof item.rankDelta === 'number');
  const hasBrief = !isGlobal && brief !== null && brief.seen > 0;
  const shown = rows.slice(0, visibleCount);
  const hasMore = rows.length > shown.length;
  const loading = !current && !(isGlobal && global === null);

  function showNewPosts(): void {
    if (!incoming) return;
    putSnapshot(makeSnapshot(key, incoming, { previous: current, keep: visited }));
    setVisibleCount(PAGE_SIZE);
    scrollContainer()?.scrollTo({ top: 0 });
    setAtTop(true);
  }

  // 鼠标离开列表：看过的蓝点清掉，之后新进来的重新标
  function leaveList(): void {
    setPointerInside(false);
    if (current && current.fresh.size > 0) putSnapshot({ ...current, fresh: new Set() });
  }

  function toggleAuthor(handle: string): void {
    setExpandedAuthors((prev) => {
      const next = new Set(prev);
      if (next.has(handle)) next.delete(handle);
      else next.add(handle);
      return next;
    });
  }

  // 读屏软件：有提示条时读提示条的数，直接插进来时读插进来的数
  const liveMessage = newCount > 0 ? t.hotNewArrived(newCount) : liveText;

  // 记下这次打开时列表里有哪些帖子，下次打开时比它多出来的带蓝点
  useEffect(() => {
    const session = sessionStorageArea();
    if (!session || !prefsReady) return;
    const timer = window.setTimeout(() => {
      const byScope: Record<HotScope, string[]> = { mine: [], global: [] };
      for (const snapshot of Object.values(snapshots)) {
        const target = byScope[snapshot.key.startsWith('global|') ? 'global' : 'mine'];
        for (const item of snapshot.items) target.push(item.postId);
      }
      void session
        .set({
          [LAST_LIST_KEY]: {
            mine: [...new Set(byScope.mine)].slice(0, MAX_LAST_LIST),
            global: [...new Set(byScope.global)].slice(0, MAX_LAST_LIST),
          },
        })
        .catch(() => undefined);
    }, LAST_LIST_WRITE_MS);
    return () => window.clearTimeout(timer);
  }, [snapshots, prefsReady]);

  // 切回某种排序：回到它上次的滚动位置（等那一批渲染出来再滚）
  // 设置 scrollTop 会触发 scroll 事件，「是否在顶部」由下面的监听更新
  useLayoutEffect(() => {
    if (pendingRestore.current === null || !current) return;
    const container = scrollContainer();
    if (container) {
      container.scrollTop = pendingRestore.current;
      lastScrollTop.current = container.scrollTop;
      dirty.current = true;
    }
    pendingRestore.current = null;
  }, [key, current]);

  // 列表是否停在顶部、是否刚滚过（滚动容器是 .popup-content）
  useEffect(() => {
    const container = scrollContainer();
    if (!container) return;
    let settle: number | undefined;
    let save: number | undefined;
    const onScroll = (): void => {
      lastScrollTop.current = container.scrollTop;
      dirty.current = true;
      const state = viewState.current;
      positions.current.set(state.key, { top: container.scrollTop, count: state.count });
      setAtTop(container.scrollTop <= AT_TOP_PX);
      setScrolling(true);
      window.clearTimeout(settle);
      settle = window.setTimeout(() => setScrolling(false), SCROLL_SETTLE_MS);
      // 滚停后再写存储，滚动过程中不反复写
      window.clearTimeout(save);
      save = window.setTimeout(persistPositions, POSITIONS_WRITE_MS);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.clearTimeout(settle);
      window.clearTimeout(save);
      container.removeEventListener('scroll', onScroll);
      // 切到别的栏目时内容已经换掉，DOM 里的 scrollTop 归零，用滚动时记下的位置
      const state = viewState.current;
      if (!dirty.current) return;
      positions.current.set(state.key, { top: lastScrollTop.current, count: state.count });
      persistPositions();
    };
  }, []);

  // 列表底部的哨兵进入视口就多显示一页
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!hasMore || !sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => count + PAGE_SIZE);
        }
      },
      { root: sentinel.closest('.popup-content'), rootMargin: '0px 0px 400px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, visibleCount]);

  // 键盘：j / k 上下切换，r 回复，x 不看这条；Enter 是链接自带的
  const keyActions = useRef({
    reply: openReply,
    dismiss: dismissPost,
    items: new Map<string, HotPostItem>(),
  });
  useEffect(() => {
    keyActions.current = {
      reply: openReply,
      dismiss: dismissPost,
      items: new Map(shown.map(({ item }) => [item.postId, item])),
    };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      const root = listTopRef.current;
      if (!root) return;
      const posts = [...root.querySelectorAll<HTMLAnchorElement>('.hot-list a.post')];
      if (posts.length === 0) return;
      const focused = document.activeElement?.closest<HTMLAnchorElement>('.hot-list a.post');
      const index = focused ? posts.indexOf(focused) : -1;
      const item = focused ? keyActions.current.items.get(focused.dataset.postId ?? '') : null;
      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault();
        const next =
          event.key === 'j'
            ? posts[Math.min(posts.length - 1, index + 1)]
            : posts[Math.max(0, index - 1)];
        next?.focus();
        next?.scrollIntoView?.({ block: 'nearest' });
      } else if (event.key === 'r' && item) {
        event.preventDefault();
        void keyActions.current.reply(item);
      } else if (event.key === 'x' && item) {
        event.preventDefault();
        // 焦点交给下一条，连按 x 可以一路清下去
        (posts[index + 1] ?? posts[index - 1])?.focus();
        keyActions.current.dismiss(item);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const helpText =
    activeSort === 'opportunity'
      ? t.hotOpportunityHint
      : activeSort === 'recent'
        ? t.hotRecentHint
        : isGlobal && activeSort === 'day'
          ? t.hotDayHint
          : isGlobal && activeSort === 'heat'
            ? t.hotRisingHint
            : t.hotPostsHint;

  function refreshGlobal(): void {
    if (refreshing) return;
    setRefreshing(true);
    setGlobalReload((n) => n + 1);
  }

  return (
    <div
      className="view hot-view"
      ref={listTopRef}
      onPointerEnter={() => setPointerInside(true)}
      onPointerLeave={leaveList}
      onFocus={() => setFocusInside(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusInside(false);
        }
      }}
    >
      <div className="view-toolbar">
        <div className="segmented" role="group" aria-label={t.scopeLabel}>
          <button
            type="button"
            className={scope === 'mine' ? 'is-selected' : ''}
            aria-pressed={scope === 'mine'}
            onClick={() => changeScope('mine')}
          >
            {t.scopeMine}
          </button>
          <button
            type="button"
            className={scope === 'global' ? 'is-selected' : ''}
            aria-pressed={scope === 'global'}
            onClick={() => changeScope('global')}
          >
            {t.scopeGlobal}
          </button>
        </div>
        <select
          className="sort-select"
          aria-label={t.hotSort}
          value={activeSort}
          onChange={(event) => {
            if (isHotSort(event.target.value)) changeSort(event.target.value);
          }}
        >
          {sortOptions.map((option) => (
            <option key={option} value={option}>
              {sortLabel(option)}
            </option>
          ))}
        </select>
        <HelpIcon text={helpText} />
        <button
          type="button"
          className="icon-button toolbar-end"
          aria-label={t.hotSettings}
          title={t.hotSettings}
          onClick={onOpenSettings}
        >
          <AppIcon name="settings" size={15} />
        </button>
      </div>

      <div className="filter-row">
        <ToggleChip
          pressed={langFilter === 'zh'}
          onToggle={() => changeLangFilter(langFilter === 'zh' ? 'all' : 'zh')}
        >
          {t.langZhOnly}
        </ToggleChip>
        {activeSort === 'recent' ? null : (
          <ToggleChip pressed={hideRead} onToggle={() => changeHideRead(!hideRead)}>
            {t.hideRead}
            {hideRead && hiddenCount > 0 ? <span className="chip-count">{hiddenCount}</span> : null}
          </ToggleChip>
        )}
        {hiddenByUser.length > 0 ? (
          // 和「隐藏已读」同一个用法：按下时把「不看」的帖子显示回来，可以逐条恢复
          <ToggleChip pressed={showHidden} onToggle={() => setShowHidden(!showHidden)}>
            {t.hotHiddenChip}
            <span className="chip-count">{hiddenByUser.length}</span>
          </ToggleChip>
        ) : null}
        {isGlobal && global ? (
          <span className={`list-meta${globalStale ? ' is-stale' : ''}`}>
            <span title={globalStale ? t.globalStale : undefined}>
              {now - global.generatedAt < 60_000
                ? t.globalUpdatedNow
                : t.globalUpdated(shortAgo(global.generatedAt, now, language))}
            </span>
            <button
              type="button"
              className={`icon-button list-refresh${refreshing ? ' is-spinning' : ''}`}
              aria-label={t.globalRefresh}
              title={t.globalRefresh}
              disabled={refreshing}
              onClick={refreshGlobal}
            >
              <AppIcon name="refresh" size={13} />
            </button>
          </span>
        ) : null}
      </div>

      {hasBrief ? <BriefLine brief={brief} language={language} /> : null}

      {newCount > 0 ? (
        // 和 X 的「显示 N 帖子」一样：点了才换成新的一批，并回到顶部
        <button type="button" className="new-posts-bar" onClick={showNewPosts}>
          <AppIcon name="refresh" size={13} />
          {t.newPosts(newCount)}
        </button>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      {loading ? (
        <SkeletonList />
      ) : isGlobal && global === null ? (
        <EmptyState>{t.globalUnavailable}</EmptyState>
      ) : list.length === 0 ? (
        <EmptyState hint={isGlobal ? t.globalEmptyHint : t.hotEmptyHint}>
          {batch.length > 0
            ? t.allFiltered
            : isGlobal
              ? t.globalEmpty
              : hasBrief
                ? t.hotEmptySeen(brief.seen)
                : t.briefEmpty}
        </EmptyState>
      ) : (
        <ol className="hot-list" aria-label={t.hotPosts}>
          {shown.map(({ item, more, expanded, leader }) => {
            const velocity = velocityLabel(item.velocity);
            const text = readableText(item.snippet);
            const hidden = isHidden(item);
            const dimmed =
              hidden || visited.has(item.postId) || (item.read === true && activeSort !== 'recent');
            const fresh = current?.fresh.has(item.postId) === true;
            const rank = rankOf(item);
            // 「最近刷到」按刷到的时间排，卡片上就写刷到的时间；发布时间放进悬浮提示
            const seenMode = activeSort === 'recent' && item.seenAt !== undefined;
            const timeText = seenMode
              ? t.hotSeenAgo(shortAgo(item.seenAt!, now, language))
              : item.createdAt !== undefined
                ? shortAgo(item.createdAt, now, language)
                : null;
            const timeTitle =
              seenMode && item.createdAt !== undefined
                ? t.hotPostedAgo(shortAgo(item.createdAt, now, language))
                : undefined;
            return (
              <li key={item.postId} className={leader ? undefined : 'is-grouped'}>
                <a
                  className={`post${dimmed ? ' is-visited' : ''}${fresh ? ' is-new' : ''}`}
                  href={`https://x.com/${item.handle}/status/${item.postId}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  data-post-id={item.postId}
                  aria-label={`${t.hotOpenPost}: @${item.handle}`}
                  onClick={(event) => void openPost(event, item)}
                >
                  <Avatar item={item} />
                  <div className="post-main">
                    {/* 和 X 一样的作者行：名字 蓝标 @handle · 时间，后面接量级；流速在右上角 */}
                    <div className="post-head">
                      <div className="post-who">
                        {rank !== null ? (
                          <span className={`post-rank${rank <= 3 ? ' is-top' : ''}`}>{rank}</span>
                        ) : null}
                        <span className="post-name">{item.displayName ?? item.handle}</span>
                        {item.verified ? <VerifiedMark label={t.verified} /> : null}
                        <span className="post-handle">@{item.handle}</span>
                        {timeText !== null ? (
                          <span
                            className={`post-meta${seenMode ? ' is-key' : ''}`}
                            title={timeTitle}
                          >
                            {timeText}
                          </span>
                        ) : null}
                        {item.tier !== null && item.followers !== undefined ? (
                          <TierPill
                            tier={item.tier}
                            followers={item.followers}
                            language={language}
                            highlight={activeSort === 'followers'}
                          />
                        ) : null}
                        {ranked && isGlobal ? (
                          <RankTrend item={item} hasReference={hasReference} language={language} />
                        ) : null}
                      </div>
                      {velocity ? (
                        <span className="velocity-tag" data-fs-level={velocity.level}>
                          <AppIcon
                            name={velocity.level === 'none' ? 'trending' : 'flame'}
                            size={12}
                          />
                          {velocity.text}
                        </span>
                      ) : null}
                    </div>
                    {text ? <p className="post-text">{text}</p> : null}
                    {item.mediaUrl ? (
                      <img
                        className="post-media"
                        src={`${item.mediaUrl}?name=small`}
                        alt=""
                        loading="lazy"
                        draggable={false}
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : null}
                    <PostActions
                      item={item}
                      language={language}
                      showBookmarks={activeSort === 'bookmarks'}
                    />
                  </div>
                </a>
                {/* 卡片本身是链接，按钮都放在卡片外面（链接里不能再套按钮） */}
                <button
                  type="button"
                  className={`post-dismiss${hidden ? ' is-restore' : ''}`}
                  aria-label={hidden ? t.hotRestore : t.hotDismiss}
                  title={hidden ? t.hotRestore : t.hotDismiss}
                  onClick={() => (hidden ? restorePost(item) : dismissPost(item))}
                >
                  <AppIcon name={hidden ? 'refresh' : 'x'} size={13} />
                </button>
                {activeSort === 'opportunity' && item.opportunity ? (
                  <div className="post-extra">
                    <HotInsight item={item} sort={activeSort} language={language} />
                    <button
                      type="button"
                      className="reply-button"
                      onClick={() => void openReply(item)}
                    >
                      <LineIcon name="reply" size={13} />
                      {t.replyNow}
                    </button>
                  </div>
                ) : null}
                {leader && more > 0 ? (
                  <button
                    type="button"
                    className="post-more"
                    aria-expanded={expanded}
                    onClick={() => toggleAuthor(item.handle)}
                  >
                    {expanded ? t.hotCollapseAuthor : t.hotMoreFromAuthor(more, item.handle)}
                  </button>
                ) : null}
              </li>
            );
          })}
          {hasMore ? <li ref={sentinelRef} className="list-sentinel" aria-hidden="true" /> : null}
        </ol>
      )}

    </div>
  );
}
