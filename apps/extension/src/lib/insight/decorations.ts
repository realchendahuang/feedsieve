/**
 * 时间线上的流速与作者量级。
 *
 * 显示规则：推文上直接显示的内容不出现汉字，只用 Lucide 图标、数字和英文缩写
 * （`↗ 168/h`、`☆ 32K`）；档位名、破圈倍数和解释都放在悬停卡片里，跟随界面语言（copy.ts）。
 *
 * 落点：
 * - 量级：@handle 那一行末尾，按 X 的元数据写法接「· ☆ 12.8K」；主页上不显示，
 *   资料卡已经写着粉丝数，帖子行再重复只会挤占元数据行。
 * - 倍数：主页主人自己的帖子，只在明显跑赢中位数（≥ MULTIPLE_MIN）时出现；
 *   1.2× 这种「基本正常」不占地方，具体数值在流速的悬停卡片里。
 * - 流速：时间线和详情页都在右上角按钮组的最前面；找不到时退回动作栏末尾。
 *
 * 窄屏：ResizeObserver 按 article 宽度写 `data-fs-size`（wide / mid / narrow），
 * 样式据此收起数字，不去量 X 自己的元素，也不改它们的尺寸。
 *
 * X 会复用 article 节点显示别的推文，所以每次装饰都按当前 postId / handle 重算；
 * 内容不变时不写 DOM（避免触发 MutationObserver 和多余重排）。全部文本走 textContent。
 */
import {
  accountFlags,
  accountTier,
  followRatio,
  OUTLIER_MULTIPLE,
  outlierMultiple,
  shouldShowBreakout,
  type ProfileBaseline,
  type AccountTier,
  type VelocityLevel,
} from '@feedsieve/metrics';
import {
  extractTweetIdentity,
  menuSelectors,
  profileFromPath,
  tweetSelectors,
} from '@feedsieve/x-adapter';
import type { UiLanguage } from '../platform/i18n';
import { INSIGHT_COPY, tierTitle } from './copy';
import { compact, formatReach, formatVelocity, tierCode, velocityLabel } from './format';
import { createHovercard, type HoverContent } from './hovercard';
import { createIcon, TIER_ICONS, type IconName } from './icons';
import type { AuthorEntry, TweetInsight, TweetStatsStore } from './tweet-stats';

export const VELOCITY_CLASS = 'fs-velocity';
export const TIER_CLASS = 'fs-tier';
/** 主页上主人自己的帖子：浏览是他中位数的几倍（`3.4×`）。 */
export const MULTIPLE_CLASS = 'fs-multiple';
/** 倍数至少高出中位数这么多才显示：再低就是「正常」，看一眼不做任何决定。 */
export const MULTIPLE_MIN = 1.5;
/** MutationObserver 反馈环过滤与清理共用。 */
export const INSIGHT_DECORATION_SELECTOR = `.${VELOCITY_CLASS}, .${TIER_CLASS}, .${MULTIPLE_CLASS}`;
const MULTIPLE_ATTR = 'data-fs-multiple';

const VELOCITY_ATTR = 'data-fs-velocity';
const TIER_ATTR = 'data-fs-tier';
const LEVEL_ATTR = 'data-fs-level';
const TIER_LEVEL_ATTR = 'data-fs-tier-level';
const PLACE_ATTR = 'data-fs-place';
export const SIZE_ATTR = 'data-fs-size';
const REFRESH_DEBOUNCE_MS = 250;

/** article 宽度分档。桌面三栏布局里推文约 598px；X 在窗口变窄后才压缩中栏。 */
export function sizeBucket(width: number): 'wide' | 'mid' | 'narrow' {
  if (width >= 560) return 'wide';
  if (width >= 470) return 'mid';
  return 'narrow';
}

interface DecorateItem {
  postId?: string;
  author: { handle: string };
}

function localeOf(language: UiLanguage): string {
  return language === 'zh' ? 'zh-CN' : 'en';
}

/** 流速胶囊的悬停内容。`multiple` 是主页主人自己帖子的相对表现（页面上不显眼时也在这里给数值）。 */
export function velocityHover(
  insight: TweetInsight,
  language: UiLanguage,
  multiple?: { value: number; estimated: boolean } | null,
): HoverContent {
  const t = INSIGHT_COPY[language];
  const locale = localeOf(language);
  const num = (value: number) => Math.round(value).toLocaleString(locale);
  const level: VelocityLevel = velocityLabel(insight.velocity)?.level ?? 'none';
  const rows: HoverContent['rows'] = [];
  if (insight.velocity !== null) rows.push([t.velocityNow, t.perHour(num(insight.velocity))]);
  if (insight.projected !== null) rows.push([t.projected, num(insight.projected)]);
  if (multiple)
    rows.push([t.multipleTitle.normal, formatMultiple(multiple.value, multiple.estimated)]);
  const counts: Array<[string, number | undefined]> = [
    [t.views, insight.views],
    [t.likes, insight.likes],
    [t.replies, insight.replies],
    [t.reposts, insight.retweets],
    [t.quotes, insight.quotes],
    [t.bookmarks, insight.bookmarks],
  ];
  for (const [label, value] of counts) if (value !== undefined) rows.push([label, num(value)]);
  if (insight.breakout !== null && shouldShowBreakout(insight.breakout)) {
    rows.push([t.breakout, t.breakoutValue(formatReach(insight.breakout).slice(1))]);
  }
  if (insight.viral !== null) rows.push([t.viral, `${insight.viral} / 100`]);
  return {
    title: `${level === 'none' ? '📈' : '🔥'} ${t.velocityTitle[level]}`,
    rows,
    notes: insight.coldStart ? [t.coldStart] : [],
    footer: t.velocityFoot,
  };
}

/** 倍数的写法：`3.4×`、`12×`；估算的前面加 `~`；不到 0.1 写 `<0.1×`。不出现汉字（见文件头约定）。 */
export function formatMultiple(value: number, estimated: boolean): string {
  if (value < 0.1) return '<0.1×';
  const shown = value >= 10 ? String(Math.round(value)) : value.toFixed(1);
  return `${estimated ? '~' : ''}${shown}×`;
}

export function multipleHover(
  result: { value: number; estimated: boolean },
  profile: { handle: string; baseline: ProfileBaseline; sample: number },
  language: UiLanguage,
): HoverContent {
  const t = INSIGHT_COPY[language];
  const locale = localeOf(language);
  const outlier = result.value >= OUTLIER_MULTIPLE;
  return {
    title: `${outlier ? '⭐' : '📊'} ${t.multipleTitle[outlier ? 'outlier' : 'normal']}`,
    rows: [
      [
        t.multipleTitle.normal,
        // 文案里自带「倍」/「×」，这里只传数字（去掉末尾的 ×）
        t.multipleValue(formatMultiple(result.value, false).slice(0, -1), profile.handle),
      ],
      [t.multipleMedian, Math.round(profile.baseline.medianViews).toLocaleString(locale)],
    ],
    notes: result.estimated ? [t.multipleEstimated] : [],
    footer: t.multipleSample(profile.sample),
  };
}

/** 量级标签的悬停内容。 */
export function tierHover(
  author: AuthorEntry & { followers: number },
  tier: AccountTier,
  language: UiLanguage,
  now: number,
): HoverContent {
  const t = INSIGHT_COPY[language];
  const locale = localeOf(language);
  const rows: HoverContent['rows'] = [[t.followers, author.followers.toLocaleString(locale)]];
  if (author.followingCount !== undefined) {
    rows.push([t.following, author.followingCount.toLocaleString(locale)]);
    const ratio = followRatio(author.followingCount, author.followers);
    if (ratio !== null) rows.push([t.ratio, ratio < 0.01 ? '<0.01' : ratio.toFixed(2)]);
  }
  if (author.createdAt !== undefined) {
    rows.push([
      t.joined,
      new Date(author.createdAt).toLocaleDateString(locale, { year: 'numeric', month: 'short' }),
    ]);
  }
  const flags = accountFlags({
    followers: author.followers,
    ...(author.followingCount !== undefined ? { followingCount: author.followingCount } : {}),
    ...(author.createdAt !== undefined ? { createdAt: author.createdAt } : {}),
    now,
  });
  const notes: string[] = [];
  if (flags.mutualFollowFarm) notes.push(`⚠️ ${t.flagMutual}`);
  if (flags.newAccount) notes.push(`⚠️ ${t.flagNew}`);
  if (flags.abnormalFollowRatio) notes.push(`⚠️ ${t.flagRatio}`);
  if (tier <= 3) notes.push(`🌱 ${t.coldStartTier}`);
  return { title: `${tierCode(tier)} · ${tierTitle(tier, language)}`, rows, notes };
}

type VelocityPlace = 'top' | 'bar';

interface VelocitySlot {
  parent: Element;
  before: Node | null;
  place: VelocityPlace;
}

/**
 * 流速的位置：时间线和详情页都在推文右上角，按钮组（推广 / Grok / ...）的最前面，
 * 用户在哪个页面都在同一个地方找。从 ... 按钮往上找第一个有多个子元素的祖先。
 * 找不到 ... 按钮时退回动作栏末尾。
 */
function velocitySlot(article: Element): VelocitySlot | null {
  const caret = article.querySelector(menuSelectors.caretButton);
  let node: Element | null = caret?.parentElement ?? null;
  while (node && node !== article) {
    const kids = [...node.children].filter(
      (child) =>
        !child.classList.contains(VELOCITY_CLASS) && !child.classList.contains(MULTIPLE_CLASS),
    );
    if (kids.length >= 2) return { parent: node, before: kids[0] ?? null, place: 'top' };
    node = node.parentElement;
  }
  const actionGroup = article
    .querySelector(tweetSelectors.actionAnchor)
    ?.closest(tweetSelectors.actionGroup);
  return actionGroup ? { parent: actionGroup, before: null, place: 'bar' } : null;
}

/**
 * 量级标签的位置：@handle 所在的那一行末尾。
 * 首页这一行是「@handle · 4小时」，详情页是「@handle」（作者名区域在详情页竖排）。
 */
function handleRow(nameArea: Element): Element | null {
  const rows = [...nameArea.children].filter((child) => !child.classList.contains(TIER_CLASS));
  return rows[rows.length - 1] ?? null;
}

function setText(element: Element, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

function setAttr(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

/** 胶囊内部：[图标][流速]，只在内容变化时改 DOM。破圈倍数只在悬停卡片里。 */
function renderPill(element: HTMLElement, content: { icon: IconName; rate: string }): void {
  const icon = element.querySelector('svg');
  if (icon?.getAttribute('data-fs-icon') !== content.icon) {
    const next = createIcon(content.icon);
    if (icon) icon.replaceWith(next);
    else element.prepend(next);
  }
  let rate = element.querySelector<HTMLElement>('.fs-v-rate');
  if (!rate) {
    rate = document.createElement('span');
    rate.className = 'fs-v-rate';
    element.appendChild(rate);
  }
  setText(rate, content.rate);
}

export function createInsightDecorations(deps: {
  store: TweetStatsStore;
  getLanguage: () => UiLanguage;
  now?: () => number;
  /** 每条被装饰的推文都交给已读追踪（停留够久算看过）。 */
  onArticle?: (article: Element) => void;
  /** 当前所在主页的主人和他的基线（主页洞察）；不在主页、样本不够时返回 null。 */
  profileBaseline?: () => { handle: string; baseline: ProfileBaseline; sample: number } | null;
}) {
  const { store, getLanguage } = deps;
  const now = deps.now ?? (() => Date.now());
  let enabled = true;
  let refreshTimer: number | undefined;

  /**
   * 流速卡片里的相对表现：倍数低于 MULTIPLE_MIN 时页面上不显示，数值仍有地方看。
   * 只算主页主人自己的原创/引用——转帖的作者是别人，不能拿主人的基线去比。
   */
  function relativeMultiple(anchor: Element, postId: string) {
    const profile = deps.profileBaseline?.();
    if (!profile) return null;
    const article = anchor.closest(tweetSelectors.article);
    const item = article ? extractTweetIdentity(article) : null;
    if (!item || item.author.handle.toLowerCase() !== profile.handle) return null;
    const stat = store.insight(postId, now());
    return stat && stat.kind !== 'reply' ? outlierMultiple(stat, profile.baseline, now()) : null;
  }

  const hovercard = createHovercard({
    resolve(target) {
      const pill = target.closest<HTMLElement>(`.${VELOCITY_CLASS}`);
      if (pill) {
        const postId = pill.getAttribute(VELOCITY_ATTR) ?? '';
        const insight = store.insight(postId, now());
        if (!insight) return null;
        return {
          anchor: pill,
          content: velocityHover(insight, getLanguage(), relativeMultiple(pill, postId)),
        };
      }
      const badge = target.closest<HTMLElement>(`.${MULTIPLE_CLASS}`);
      if (badge) {
        const profile = deps.profileBaseline?.();
        const stat = store.insight(badge.getAttribute(MULTIPLE_ATTR) ?? '', now());
        const result = profile && stat ? outlierMultiple(stat, profile.baseline, now()) : null;
        if (!profile || !stat || !result) return null;
        return {
          anchor: badge,
          content: multipleHover(result, profile, getLanguage()),
        };
      }
      const chip = target.closest<HTMLElement>(`.${TIER_CLASS}`);
      if (chip) {
        const author = store.author(chip.getAttribute(TIER_ATTR) ?? '');
        const tier = accountTier(author?.followers);
        if (!author || tier === null || author.followers === undefined) return null;
        return {
          anchor: chip,
          content: tierHover(
            author as AuthorEntry & { followers: number },
            tier,
            getLanguage(),
            now(),
          ),
        };
      }
      return null;
    },
  });

  // 按 article 宽度分档；只观察装饰过的推文，节点离开文档后在下一次全量刷新时取消观察
  const observed = new Set<Element>();
  const sizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => {
          for (const entry of entries) {
            setAttr(entry.target, SIZE_ATTR, sizeBucket(entry.contentRect.width));
          }
        });

  function watchSize(article: Element): void {
    if (!sizeObserver || observed.has(article)) return;
    observed.add(article);
    sizeObserver.observe(article);
  }

  function pruneObserved(): void {
    for (const article of observed) {
      if (article.isConnected) continue;
      sizeObserver?.unobserve(article);
      observed.delete(article);
    }
  }

  function decorateVelocity(article: Element, postId: string | undefined) {
    const existing = article.querySelector<HTMLElement>(`[${VELOCITY_ATTR}]`);
    const insight = enabled && postId ? store.insight(postId, now()) : null;
    const label = insight ? velocityLabel(insight.velocity) : null;
    const slot = insight && label ? velocitySlot(article) : null;
    if (!insight || !label || !slot) {
      existing?.remove();
      return;
    }
    let element = existing;
    if (
      !element ||
      element.parentElement !== slot.parent ||
      (slot.before !== null && element.nextSibling !== slot.before && element !== slot.before)
    ) {
      element?.remove();
      element = document.createElement('span');
      element.className = VELOCITY_CLASS;
      slot.parent.insertBefore(element, slot.before);
    }
    setAttr(element, VELOCITY_ATTR, postId!);
    setAttr(element, LEVEL_ATTR, label.level);
    setAttr(element, PLACE_ATTR, slot.place);
    renderPill(element, {
      icon: label.level === 'none' ? 'trending' : 'flame',
      rate: formatVelocity(insight.velocity!),
    });
  }

  /**
   * 主页上主人自己的帖子：倍数放在流速前面，但只标明显跑赢的（≥ MULTIPLE_MIN）。
   * 回复不显示：基线只用原创和引用算，回复的浏览天然低，拿来比只会是一串 0.1×。
   */
  function decorateMultiple(article: Element, postId: string | undefined, handle: string) {
    const existing = article.querySelector<HTMLElement>(`[${MULTIPLE_ATTR}]`);
    const profile = enabled ? deps.profileBaseline?.() : null;
    const found =
      profile && postId && profile.handle === handle ? store.insight(postId, now()) : null;
    const stat = found && found.kind !== 'reply' ? found : null;
    const result = profile && stat ? outlierMultiple(stat, profile.baseline, now()) : null;
    const slot = result && result.value >= MULTIPLE_MIN ? velocitySlot(article) : null;
    if (!result || !slot) {
      existing?.remove();
      return;
    }
    const velocity = article.querySelector<HTMLElement>(`[${VELOCITY_ATTR}]`);
    const before = velocity && velocity.parentElement === slot.parent ? velocity : slot.before;
    let element = existing;
    if (!element || element.parentElement !== slot.parent || element.nextSibling !== before) {
      element?.remove();
      element = document.createElement('span');
      element.className = MULTIPLE_CLASS;
      slot.parent.insertBefore(element, before);
    }
    setAttr(element, MULTIPLE_ATTR, postId!);
    setAttr(element, LEVEL_ATTR, result.value >= OUTLIER_MULTIPLE ? 'outlier' : 'normal');
    setAttr(element, PLACE_ATTR, slot.place);
    setText(element, formatMultiple(result.value, result.estimated));
  }

  function decorateTier(article: Element, handle: string) {
    const nameArea = article.querySelector(tweetSelectors.authorNameArea);
    const existing = nameArea?.querySelector<HTMLElement>(`[${TIER_ATTR}]`);
    const author = enabled ? store.author(handle) : undefined;
    const tier = accountTier(author?.followers);
    const row = nameArea ? handleRow(nameArea) : null;
    // 主页资料卡已经写着粉丝数，帖子行上再重复一遍只会挤占 X 的元数据行。
    const onOwnerProfile = profileFromPath(location.pathname)?.handle === handle;
    if (!author || tier === null || author.followers === undefined || !row || onOwnerProfile) {
      existing?.remove();
      return;
    }
    let element = existing;
    if (!element || element.parentElement !== row) {
      element?.remove();
      element = document.createElement('span');
      element.className = TIER_CLASS;
      const count = document.createElement('span');
      count.className = 'fs-tier-count';
      element.append(count);
      row.appendChild(element);
    }
    setAttr(element, TIER_ATTR, handle);
    setAttr(element, TIER_LEVEL_ATTR, String(tier));
    // 量级用这一行的次要文字色（X 把它写在行内 style 上，亮暗主题各不相同）。
    // 只读行内样式，不触发重排；找不到时用样式表里的默认灰。
    const secondary = row.querySelector<HTMLElement>('[style*="color"]')?.style.color ?? '';
    if (element.style.color !== secondary) element.style.color = secondary;
    const iconName = TIER_ICONS[tier];
    const icon = element.querySelector('svg');
    if (icon?.getAttribute('data-fs-icon') !== iconName) {
      const next = createIcon(iconName, 13);
      if (icon) icon.replaceWith(next);
      else element.prepend(next);
    }
    setText(element.querySelector('.fs-tier-count')!, compact(author.followers));
  }

  /** 扫描路径与刷新路径共用：按当前 postId / handle 重算两个装饰。 */
  function decorate(article: Element, item: DecorateItem): void {
    const handle = item.author.handle.toLowerCase();
    decorateVelocity(article, item.postId);
    decorateMultiple(article, item.postId, handle);
    decorateTier(article, handle);
    if (article.querySelector(INSIGHT_DECORATION_SELECTOR)) watchSize(article);
    deps.onArticle?.(article);
  }

  function refreshAll(): void {
    pruneObserved();
    for (const article of document.querySelectorAll(tweetSelectors.article)) {
      if (!article.isConnected) continue;
      const item = extractTweetIdentity(article);
      if (item) decorate(article, item);
    }
  }

  /** 新指标到达后合并刷新：同一批 GraphQL 响应只刷一次屏幕上的推文。 */
  function scheduleRefresh(): void {
    if (refreshTimer !== undefined) return;
    refreshTimer = window.setTimeout(() => {
      refreshTimer = undefined;
      refreshAll();
    }, REFRESH_DEBOUNCE_MS);
  }

  function clearAll(): void {
    hovercard.hide();
    for (const element of document.querySelectorAll(INSIGHT_DECORATION_SELECTOR)) {
      element.remove();
    }
  }

  function setEnabled(next: boolean): void {
    if (enabled === next) return;
    enabled = next;
    if (enabled) refreshAll();
    else clearAll();
  }

  function dispose(): void {
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    refreshTimer = undefined;
    sizeObserver?.disconnect();
    observed.clear();
  }

  return {
    decorate,
    refreshAll,
    scheduleRefresh,
    clearAll,
    setEnabled,
    dispose,
    listenHover: hovercard.listen,
  };
}

export type InsightDecorations = ReturnType<typeof createInsightDecorations>;
