/**
 * 主页洞察（内容脚本一侧）：
 * - 在博主主页的资料卡下插一行概况：量级 · 粉丝 · 关注比 · 中位浏览 · 爆款率 · 已收 N 条，
 *   点击打开侧边栏的「主页」视图；
 * - 给推文装饰提供这个博主的基线，主人自己的帖子显示倍数（decorations.ts）。
 *
 * 概况来自后台的本地帖子库（profile-catalog.ts），只传基线和几个数，不传整份帖子。
 * X 会重渲染资料卡，所以每秒检查一次这一行还在不在；内容不变时不写 DOM。全部文本走 textContent。
 */
import { TIER_NAMES, type AccountTier, type ProfileBaseline } from '@feedsieve/metrics';
import { profileFromPath, profileSelectors } from '@feedsieve/x-adapter';
import type { UiLanguage } from '../platform/i18n';
import { formatCount } from './format';
import { asProfileSummary, type ProfileSummary } from './profile-summary';

export const PROFILE_LINE_CLASS = 'fs-profile-line';
/** 打开主页后等这么久再取概况：资料端点和第一页帖子要先到、先进帖子库。 */
const FIRST_FETCH_DELAY_MS = 1_500;
/** 停在主页上时，每隔这么久重取一次（往下滚会收进更多帖子）。 */
const REFRESH_MS = 15_000;
/**
 * 第一次打开的主页：帖子库要等内容脚本把观测批量交给后台（约 2 秒一批）才建好，
 * 首次取多半落空。落空时按这个间隔快速重取几次，不干等 15 秒。
 */
const RETRY_MS = 1_000;
const MAX_RETRIES = 8;
const TICK_MS = 1_000;

const LINE_COPY = {
  zh: {
    followers: (n: string) => `${n} 粉丝`,
    ratio: (n: string) => `关注比 ${n}`,
    median: (n: string) => `中位浏览 ${n}`,
    outlierRate: (n: string) => `爆款率 ${n}`,
    collected: (n: number) => `已收 ${n} 条`,
    open: '打开主页洞察',
  },
  en: {
    followers: (n: string) => `${n} followers`,
    ratio: (n: string) => `ratio ${n}`,
    median: (n: string) => `median ${n} views`,
    outlierRate: (n: string) => `${n} outliers`,
    collected: (n: number) => `${n} posts collected`,
    open: 'Open profile insight',
  },
} as const;

export function profileLineParts(summary: ProfileSummary, language: UiLanguage): string[] {
  const t = LINE_COPY[language];
  const parts: string[] = [];
  if (summary.tier !== null) {
    const names = TIER_NAMES[summary.tier as AccountTier];
    parts.push(language === 'zh' ? names.zh : names.en);
  }
  if (summary.followers !== undefined)
    parts.push(t.followers(formatCount(summary.followers, language)));
  if (summary.ratio !== null)
    parts.push(t.ratio(summary.ratio < 0.01 ? '<0.01' : summary.ratio.toFixed(2)));
  if (summary.baseline) {
    parts.push(t.median(formatCount(Math.round(summary.baseline.medianViews), language)));
  }
  if (summary.outlierRate !== null)
    parts.push(t.outlierRate(`${Math.round(summary.outlierRate * 100)}%`));
  parts.push(t.collected(summary.postCount));
  return parts;
}

export function createProfileInsight(deps: {
  getLanguage: () => UiLanguage;
  isEnabled: () => boolean;
  request: (handle: string) => Promise<unknown>;
  openPanel: () => void;
  /** 基线变了：重新装饰屏幕上的推文。 */
  onBaselineChange: () => void;
  getPath?: () => string;
}) {
  const getPath = deps.getPath ?? (() => location.pathname);
  let handle: string | null = null;
  let summary: ProfileSummary | null = null;
  let fetchTimer: number | undefined;
  let tickTimer: number | undefined;
  /** 当前主页连续取不到概况的次数（换主页时清零）。 */
  let misses = 0;

  function scheduleFetch(delay: number): void {
    window.clearTimeout(fetchTimer);
    fetchTimer = window.setTimeout(() => void fetchSummary(), delay);
  }

  async function fetchSummary(): Promise<void> {
    const target = handle;
    if (!target) return;
    const next = asProfileSummary(await deps.request(target).catch(() => null));
    if (handle !== target) return;
    const before = summary?.baseline?.medianViews ?? null;
    summary = next && next.handle === target ? next : null;
    if ((summary?.baseline?.medianViews ?? null) !== before) deps.onBaselineChange();
    ensureLine();
    misses = summary ? 0 : misses + 1;
    scheduleFetch(!summary && misses <= MAX_RETRIES ? RETRY_MS : REFRESH_MS);
  }

  function removeLine(): void {
    for (const line of document.querySelectorAll(`.${PROFILE_LINE_CLASS}`)) line.remove();
  }

  /** 资料卡下的那一行：不存在就插，位置不对就挪，内容变了才改。 */
  function ensureLine(): void {
    if (!summary || !deps.isEnabled() || profileFromPath(getPath())?.handle !== summary.handle) {
      removeLine();
      return;
    }
    const anchor = profileSelectors.headerAnchors
      .map((selector) => document.querySelector(selector))
      .find((node): node is Element => node !== null);
    if (!anchor?.parentElement) return;
    let line = document.querySelector<HTMLButtonElement>(`.${PROFILE_LINE_CLASS}`);
    if (!line || line.previousElementSibling !== anchor) {
      line?.remove();
      line = document.createElement('button');
      line.type = 'button';
      line.className = PROFILE_LINE_CLASS;
      line.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        deps.openPanel();
      });
      anchor.after(line);
    }
    const language = deps.getLanguage();
    const parts = profileLineParts(summary, language);
    const current = [...line.children].map((child) => child.textContent);
    if (current.join('\n') !== parts.join('\n')) {
      line.replaceChildren(
        ...parts.map((part, index) => {
          const span = document.createElement('span');
          if (index === 0) span.className = 'fs-profile-key';
          span.textContent = part;
          return span;
        }),
      );
    }
    const label = LINE_COPY[language].open;
    if (line.getAttribute('aria-label') !== label) line.setAttribute('aria-label', label);
  }

  /** 每秒：主页换了就重取；资料卡被 X 重渲染了就补回那一行。 */
  function tick(): void {
    const next = profileFromPath(getPath())?.handle ?? null;
    if (next !== handle) {
      const hadBaseline = summary?.baseline !== null && summary !== null;
      handle = next;
      summary = null;
      misses = 0;
      removeLine();
      window.clearTimeout(fetchTimer);
      if (hadBaseline) deps.onBaselineChange();
      if (handle) scheduleFetch(FIRST_FETCH_DELAY_MS);
      return;
    }
    ensureLine();
  }

  function start(): void {
    tick();
    tickTimer ??= window.setInterval(tick, TICK_MS);
  }

  function stop(): void {
    window.clearInterval(tickTimer);
    window.clearTimeout(fetchTimer);
    tickTimer = undefined;
    removeLine();
  }

  /** 给推文装饰：当前主页主人与基线；样本不够时为 null。 */
  function baseline(): { handle: string; baseline: ProfileBaseline; sample: number } | null {
    if (!summary?.baseline || summary.handle !== handle) return null;
    return { handle: summary.handle, baseline: summary.baseline, sample: summary.baseline.sample };
  }

  return { start, stop, tick, ensureLine, baseline, fetchSummary };
}

export type ProfileInsight = ReturnType<typeof createProfileInsight>;
