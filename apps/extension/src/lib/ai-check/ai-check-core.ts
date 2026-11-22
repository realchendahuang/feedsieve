import { flavorOf } from '@feedsieve/shared';
/**
 * AI 味检测轻量核心（常驻内容脚本）：
 * 仅负责页面标注 / 折叠条 / 回复机器人入口 / 主页「AI 味」Tab 与 X 接口数据缓冲。
 * 点击打开报告卡、触发自动滚屏采样、画分享图卡与填入回复框的重逻辑已拆进
 * ai-check-runner.ts（由 lazy-ai-check.js 按需加载）。
 */
import {
  contextFromPath,
  extractFeedItem,
  findTweetAuthorArea,
  profileFromPath,
  tweetSelectors,
} from '@feedsieve/x-adapter';
import { actionIcon } from '../content/action-slot';
import { findAuthorMetaRow } from '../content/author-header';
import {
  AUTOSTART_KEY,
  BUTTON_ATTR,
  el,
  ensureAiCheckStyles,
  FOLD_ATTR,
  judged,
  MARK_ATTR,
  TAB_ATTR,
  TONE_ATTR,
  TONE_COLOR,
  type AiCheckDeps,
  type AiCheckRunner,
  type AiCheckRunnerFactory,
  type AiCheckRunnerHost,
  type Known,
} from './ai-check-shared';
import {
  AI_LIST_KEY,
  AI_LIST_SYNC_MESSAGE,
  AI_LOOKUP_MESSAGE,
  AI_RECORDS_KEY,
  AI_SETTINGS_KEY,
  DEFAULT_AI_SETTINGS,
  normalizeAiSettings,
  type AiCheckRecord,
  type AiCheckSettings,
  type AiListState,
  type AiLookupOutcome,
} from './client';
import type { ApiTweet } from './evidence';

/** 名单 / 设置 / 单条查询接连回来时，装饰合并成一次（不每条都全页重画）。 */
const DECORATE_THROTTLE_MS = 150;
/** 官方机器人不测 */
const EXEMPT = new Set(['grok']);
/** 页面上收到的 X 接口帖子，最多留这么多条（只在本页内存里，用来配对原帖、判断是不是回复） */
const API_BUFFER_MAX = 3_000;

const CORE_TEXT = {
  zh: {
    tab: 'AI 味',
    buttonTip: '测测 TA 的 AI 味',
    mark: (pct: number) => `AI 味 ${pct}%`,
    markListed: '社区 AI 号',
    markTip: (label: string) => `${label} · 点开看检测报告`,
    folded: (name: string, pct: string) => `已折叠 ${name} 的回复 · ${pct}`,
    unfold: '显示',
  },
  en: {
    tab: 'AI flavor',
    buttonTip: 'Check their AI flavor',
    mark: (pct: number) => `AI ${pct}%`,
    markListed: 'Community AI list',
    markTip: (label: string) => `${label} · Open the report`,
    folded: (name: string, pct: string) => `Folded a reply from ${name} · ${pct}`,
    unfold: 'Show',
  },
} as const;

function fromRecord(record: AiCheckRecord, myVote: 'ai' | 'human' | null): Known {
  return {
    verdict: record.verdict,
    score: record.score,
    replyCount: record.replyCount ?? 0,
    rhythm: record.rhythm ?? null,
    expired: record.expiresAt ? record.expiresAt * 1000 <= Date.now() : false,
    votes: null,
    myVote,
    mineOnly: record.confirmed !== true,
    underReview: false,
    comment: record.comment ?? null,
  };
}

export interface AiCheckCoreDeps extends AiCheckDeps {
  loadRunner: () => AiCheckRunnerFactory | Promise<AiCheckRunnerFactory>;
}

function isBlue(article: Element): boolean {
  const area = findTweetAuthorArea(article);
  return !!area?.querySelector(tweetSelectors.verifiedBadge);
}

function hasReplyContext(article: Element): boolean {
  const name = findTweetAuthorArea(article);
  if (!name) return false;
  const text = (article.textContent ?? '').replace(/\s+/g, ' ');
  const nameText = (name.textContent ?? '').replace(/\s+/g, ' ');
  const at = text.indexOf(nameText);
  const head = at >= 0 ? text.slice(at + nameText.length, at + nameText.length + 120) : '';
  return /(?:回复|Replying to)\s*@/i.test(head);
}

function nameRowOf(article: Element): Element | null {
  const area = findTweetAuthorArea(article);
  if (!area) return null;
  return findAuthorMetaRow(area) ?? area;
}

function hasFlexDirection(elNode: Element, direction: 'column' | 'row'): boolean {
  if (typeof getComputedStyle !== 'function') return false;
  const style = getComputedStyle(elNode);
  return (
    (style.display === 'flex' || style.display === 'inline-flex') &&
    style.flexDirection.startsWith(direction)
  );
}

function canClimbHandleWrapper(parent: Element, area: Element): boolean {
  if (parent === area) return false;
  const nonEntry = [...parent.children].filter((c) => !c.classList.contains('fs-ai-entry'));
  if (nonEntry.length > 1) return false;
  if (parent.tagName === 'SPAN') return true;
  const grand = parent.parentElement;
  if (hasFlexDirection(parent, 'column')) {
    return !(grand === area && hasFlexDirection(area, 'column'));
  }
  if (hasFlexDirection(parent, 'row')) return false;
  if (!grand || grand === area) return false;
  return [...grand.children].filter((c) => !c.classList.contains('fs-ai-entry')).length > 1;
}

function entrySlotOf(
  article: Element,
  handle: string,
): { parent: Element; before: ChildNode | null } | null {
  const area = findTweetAuthorArea(article);
  if (!area) return null;
  const atHandle = `@${handle.toLowerCase()}`;
  const handleNode = [...area.querySelectorAll('a, span')].find(
    (node) =>
      !node.classList.contains('fs-ai-entry') &&
      (node.textContent ?? '').trim().toLowerCase() === atHandle,
  );
  if (handleNode) {
    let slot: Element = handleNode;
    while (slot.parentElement && canClimbHandleWrapper(slot.parentElement, area)) {
      slot = slot.parentElement;
    }
    if (slot.parentElement) {
      return { parent: slot.parentElement, before: slot };
    }
  }
  const row = nameRowOf(article);
  return row ? { parent: row, before: row.firstChild } : null;
}

function repliesTab(handle: string): HTMLAnchorElement | null {
  const target = `/${handle.toLowerCase()}/with_replies`;
  const root = document.querySelector('[data-testid="primaryColumn"]') ?? document;
  for (const a of root.querySelectorAll<HTMLAnchorElement>(
    '[role="tablist"] a[role="tab"], a[role="tab"]',
  )) {
    if (a.hasAttribute(TAB_ATTR) || a.closest(`[${TAB_ATTR}]`)) continue;
    let pathname: string;
    try {
      pathname = new URL(a.getAttribute('href') ?? '', location.origin).pathname;
    } catch {
      continue;
    }
    if (pathname.replace(/\/+$/, '').toLowerCase() === target) return a;
  }
  return null;
}

export function createAiCheckCore(deps: AiCheckCoreDeps) {
  let stopped = false;
  /** 模块总开关当前是否生效：从关到开时补一次名单同步 */
  let moduleOn: boolean | null = null;
  /** 已有结论，每个账号每次打开页面查一次；查询中存 Promise */
  const known = new Map<string, Known | null>();
  const lookups = new Map<string, Promise<Known | null>>();
  /** 社区 AI 号名单（后台同步到 storage.local） */
  let list = new Map<string, { score: number | null; listed: boolean }>();
  /** 本机记录（自己测过的 / 投过票的） */
  let records: Record<string, AiCheckRecord> = {};
  let settings: AiCheckSettings = DEFAULT_AI_SETTINGS;
  /** 页面上收到的 X 接口帖子 */
  const apiTweets = new Map<string, ApiTweet>();
  const unfolded = new Set<string>();
  const t = () => CORE_TEXT[deps.getLanguage()];

  let runner: AiCheckRunner | null = null;
  let runnerPromise: Promise<AiCheckRunner> | null = null;

  const runnerHost: AiCheckRunnerHost = {
    getLanguage: deps.getLanguage,
    send: deps.send,
    isStopped: () => stopped,
    getApiTweets: () => [...apiTweets.values()],
    lookup,
    getKnown: (handle) => known.get(handle),
    setKnown: (handle, entry) => {
      known.set(handle, entry);
    },
    repliesTab,
    ensureTab,
    openInNewTab,
  };

  function withRunner(fn: (instance: AiCheckRunner) => void): void {
    if (stopped) return;
    if (runner) {
      fn(runner);
      return;
    }
    const result = deps.loadRunner();
    if (typeof result === 'function') {
      runner = result(runnerHost);
      fn(runner);
      return;
    }
    runnerPromise ??= result
      .then((factory) => {
        const instance = factory(runnerHost);
        runner = instance;
        return instance;
      })
      .catch((error) => {
        runnerPromise = null;
        throw error;
      });
    void runnerPromise
      .then((instance) => {
        if (!stopped) fn(instance);
      })
      .catch((error) => {
        console.error('[FeedSieve] AI 味检测面板加载失败:', error);
      });
  }

  /** X 接口数据（xhr-ingest 转过来）：存起来，正在检测时同时喂给收集器 */
  function ingest(tweets: readonly ApiTweet[]): void {
    if (stopped || !tweets.length) return;
    for (const tweet of tweets) {
      if (!tweet.postId) continue;
      apiTweets.delete(tweet.postId);
      apiTweets.set(tweet.postId, tweet);
    }
    while (apiTweets.size > API_BUFFER_MAX) apiTweets.delete(apiTweets.keys().next().value!);
    runner?.onApiTweets(tweets);
  }

  function merge(handle: string, outcome: AiLookupOutcome | null): Known | null {
    const remote = outcome?.remote;
    const myVote = outcome?.myVote ?? null;
    if (remote?.verdict && remote.score !== null && remote.verdict !== 'insufficient') {
      return {
        verdict: remote.verdict,
        score: remote.score,
        replyCount: remote.reply_count,
        rhythm: remote.rhythm,
        expired: remote.expired,
        votes: remote.votes,
        myVote,
        mineOnly: false,
        underReview: false,
        comment: remote.comment ?? null,
      };
    }
    const mine = outcome?.mine ?? records[handle] ?? null;
    if (mine && mine.score !== null && mine.verdict !== 'insufficient') {
      return {
        ...fromRecord(mine, myVote),
        votes: remote?.votes ?? null,
        underReview: remote?.contested === true || remote?.under_review === true,
      };
    }
    if (remote?.votes || myVote) {
      return {
        verdict: null,
        score: null,
        replyCount: 0,
        rhythm: null,
        expired: false,
        votes: remote?.votes ?? null,
        myVote,
        mineOnly: false,
        underReview: remote?.contested === true || remote?.under_review === true,
        comment: null,
      };
    }
    return null;
  }

  function lookup(handle: string): Promise<Known | null> {
    const existing = lookups.get(handle);
    if (existing) return existing;
    const promise = deps
      .send({ type: AI_LOOKUP_MESSAGE, handle })
      .catch(() => null)
      .then((raw) => {
        const value = merge(handle, raw as AiLookupOutcome | null);
        known.set(handle, value);
        ensureTab();
        scheduleDecorate();
        return value;
      });
    lookups.set(handle, promise);
    return promise;
  }

  /** 评论区要标记的结论：已知结论 → 社区名单 → 本机记录 */
  function markFor(
    handle: string,
  ): { percent: number; tone: 'ai' | 'mixed'; listed: boolean } | null {
    const k = known.get(handle);
    if (judged(k) && !k.expired) {
      if (k.verdict === 'human') return null;
      const f = flavorOf(k.score, k.verdict, deps.getLanguage());
      return f.tone === 'human'
        ? null
        : { percent: f.percent, tone: f.tone, listed: !!k.votes?.listed };
    }
    const entry = list.get(handle);
    if (entry) {
      if (entry.score === null) return { percent: -1, tone: 'ai', listed: true };
      const f = flavorOf(entry.score, 'suspect', deps.getLanguage());
      return f.tone === 'human' ? null : { percent: f.percent, tone: f.tone, listed: entry.listed };
    }
    const mine = records[handle];
    const fresh = !mine?.expiresAt || mine.expiresAt * 1000 > Date.now();
    if (
      mine &&
      fresh &&
      mine.score !== null &&
      (mine.verdict === 'ai' || mine.verdict === 'suspect')
    ) {
      const f = flavorOf(mine.score, mine.verdict, deps.getLanguage());
      return f.tone === 'human' ? null : { percent: f.percent, tone: f.tone, listed: false };
    }
    return null;
  }

  /** 这条帖子是不是回复：先看接口数据，没有就返回 null */
  function isReplyById(postId: string): boolean | null {
    const tweet = apiTweets.get(postId);
    if (!tweet) return null;
    return Boolean(tweet.inReplyToId);
  }

  /** 详情页这串对话的原帖作者：沿着被打开那条的「回复给」往上找到不是回复的那条 */
  function rootAuthor(focal: string): string | null {
    let current = apiTweets.get(focal);
    for (let i = 0; current && i < 50; i++) {
      if (!current.inReplyToId) return current.handle.toLowerCase();
      const parent = apiTweets.get(current.inReplyToId);
      if (!parent) return null;
      current = parent;
    }
    return null;
  }

  function inScope(article: Element): boolean {
    if (settings.scope === 'all') return true;
    return settings.scope === 'blue' ? isBlue(article) : !isBlue(article);
  }

  function protectedFromAutoMark(handle: string): boolean {
    if (deps.isAllowlisted?.(handle) === true) return true;
    if (deps.isFollowing?.(handle) === true) return !settings.markFollowing;
    return deps.isProtected?.(handle) === true;
  }

  function buildMarkPill(
    handle: string,
    postId: string,
    mark: { percent: number; tone: 'ai' | 'mixed' },
  ): HTMLButtonElement {
    const label = mark.percent < 0 ? t().markListed : t().mark(mark.percent);
    const pill = el('button', 'fs-ai-mark');
    pill.type = 'button';
    pill.dataset.tone = mark.tone;
    pill.title = t().markTip(label);
    pill.setAttribute('aria-label', t().markTip(label));
    pill.append(actionIcon('robot'), document.createTextNode(label));
    pill.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void openFor(handle, postId);
    });
    return pill;
  }

  function mountFoldBar(
    cell: Element,
    postId: string,
    name: string,
    mark: { percent: number; tone: string },
  ): void {
    cell.querySelectorAll(':scope > .fs-ai-foldbar').forEach((b) => b.remove());
    const bar = el('div', 'fs-ai-foldbar');
    bar.addEventListener('click', (event) => {
      event.stopPropagation();
    });
    bar.appendChild(
      el(
        'span',
        undefined,
        t().folded(name, mark.percent < 0 ? t().markListed : t().mark(mark.percent)),
      ),
    );
    const show = el('button', undefined, t().unfold);
    show.type = 'button';
    show.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      unfolded.add(postId);
      cell.removeAttribute(FOLD_ATTR);
      cell.querySelectorAll(':scope > .fs-ai-foldbar').forEach((b) => b.remove());
    });
    bar.appendChild(show);
    cell.prepend(bar);
    cell.setAttribute(FOLD_ATTR, '1');
  }

  function decorateArticles(only?: readonly Element[]): void {
    const focal = location.pathname.match(/\/status\/(\d+)/)?.[1] ?? null;
    const notifications = /^\/notifications(?:[/?#]|$)/.test(location.pathname);
    const self = deps.getSelfHandle()?.toLowerCase();
    const root = focal ? rootAuthor(focal) : null;
    let focalSeen = false;
    let focalAuthor: string | null = null;
    if (focal && only) {
      for (const article of document.querySelectorAll(tweetSelectors.article)) {
        const item = extractFeedItem(article, 'reply');
        if (item?.postId !== focal) continue;
        focalSeen = true;
        focalAuthor = item.author.handle.toLowerCase();
        break;
      }
    }
    for (const article of only ?? document.querySelectorAll(tweetSelectors.article)) {
      const item = extractFeedItem(article, focal ? 'reply' : contextFromPath(location.pathname));
      if (!item?.postId) continue;
      const handle = item.author.handle.toLowerCase();
      const isFocal = item.postId === focal;
      if (isFocal) {
        focalSeen = true;
        focalAuthor = handle;
      }
      const exempt = handle === self || EXEMPT.has(handle);
      const protectedAccount = exempt || protectedFromAutoMark(handle);

      let eligible = false;
      if (focal || notifications) {
        if (focal) {
          const reply = isReplyById(item.postId);
          const opAuthor =
            root ??
            (reply === false && isFocal ? handle : null) ??
            (!focalSeen ? null : focalAuthor);
          const looksLikeReply = reply ?? (focalSeen && !isFocal);
          eligible = looksLikeReply && !exempt && handle !== opAuthor;
        } else {
          const looksLikeReply = isReplyById(item.postId) ?? hasReplyContext(article);
          eligible = looksLikeReply && !exempt && handle !== self;
        }
        const key = eligible ? item.postId : '-';
        if (article.getAttribute(BUTTON_ATTR) !== key) {
          article.setAttribute(BUTTON_ATTR, key);
          article.querySelectorAll('[data-fs-action="ai"]').forEach((b) => b.remove());
        }
      }

      const mark =
        protectedAccount || settings.mode === 'off' || !inScope(article) ? null : markFor(handle);
      const markKey = mark ? `${handle}:${mark.percent}:${mark.tone}:${settings.mode}` : '-';
      const foldHost = article.closest(tweetSelectors.timelineCell) ?? article;
      if (article.getAttribute(MARK_ATTR) !== markKey) {
        article.setAttribute(MARK_ATTR, markKey);
        article.querySelectorAll('.fs-ai-mark').forEach((m) => m.remove());
        if (mark) article.setAttribute(TONE_ATTR, mark.tone);
        else article.removeAttribute(TONE_ATTR);
        foldHost.removeAttribute(FOLD_ATTR);
        foldHost.querySelectorAll(':scope > .fs-ai-foldbar').forEach((b) => b.remove());
        if (mark) {
          nameRowOf(article)?.appendChild(buildMarkPill(handle, item.postId, mark));
        }
      } else if (mark && !article.querySelector('.fs-ai-mark')) {
        nameRowOf(article)?.appendChild(buildMarkPill(handle, item.postId, mark));
      }

      const shouldFold =
        !!mark && settings.mode === 'fold' && !isFocal && !unfolded.has(item.postId);
      if (shouldFold) {
        if (
          !foldHost.hasAttribute(FOLD_ATTR) ||
          !foldHost.querySelector(':scope > .fs-ai-foldbar')
        ) {
          mountFoldBar(foldHost, item.postId, item.author.displayName || `@${handle}`, mark);
        }
      } else if (foldHost.hasAttribute(FOLD_ATTR)) {
        foldHost.removeAttribute(FOLD_ATTR);
        foldHost.querySelectorAll(':scope > .fs-ai-foldbar').forEach((b) => b.remove());
      }

      const entrySlot = mark ? null : entrySlotOf(article, handle);
      const entry = article.querySelector<HTMLElement>('[data-fs-action="ai"]');
      if (eligible && entrySlot && !mark) {
        if (
          !entry ||
          entry.parentElement !== entrySlot.parent ||
          entry.nextSibling !== entrySlot.before
        ) {
          entry?.remove();
          const btn = el('button', 'fs-ai-entry');
          btn.type = 'button';
          btn.setAttribute('data-fs-action', 'ai');
          btn.title = t().buttonTip;
          btn.setAttribute('aria-label', t().buttonTip);
          btn.append(actionIcon('robot'));
          btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void openFor(handle, item.postId ?? undefined);
          });
          entrySlot.parent.insertBefore(btn, entrySlot.before);
        }
      } else {
        entry?.remove();
      }
    }
  }

  function openInNewTab(handle: string, force: boolean, postId?: string): void {
    const params = new URLSearchParams({ fs_ai: handle });
    if (force) params.set('force', '1');
    if (postId) params.set('fs_post', postId);
    void deps
      .send({ type: 'feedsieve:open-tab', url: `https://x.com/${handle}/with_replies?${params}` })
      .catch(() => undefined);
  }

  async function openFor(handle: string, postId?: string): Promise<void> {
    const k = known.has(handle) ? known.get(handle) : await lookup(handle);
    if (judged(k) && !k.expired) {
      withRunner((instance) => instance.showKnown(handle, k, postId));
      return;
    }
    openInNewTab(handle, false, postId);
  }

  function tabLabel(handle: string): Node[] {
    const k = known.get(handle);
    const nodes: Node[] = [document.createTextNode(t().tab)];
    if (judged(k)) {
      const flavor = flavorOf(k.score, k.verdict, deps.getLanguage());
      const pct = el('span', 'fs-ai-tab-pct', `${flavor.percent}%`);
      pct.style.color = TONE_COLOR[flavor.tone];
      nodes.push(pct);
    }
    return nodes;
  }

  function ensureTab(): void {
    if (deps.isEnabled?.() === false) return;
    const profile = profileFromPath(location.pathname);
    const handle = profile && profile.tab !== 'other' ? profile.handle : null;
    for (const stale of document.querySelectorAll(`[${TAB_ATTR}]`)) {
      if (stale.getAttribute(TAB_ATTR) !== handle || !stale.isConnected) stale.remove();
    }
    if (!handle) return;
    void lookup(handle);
    const replies = repliesTab(handle);
    const tabList = replies?.closest('[role="tablist"]');
    if (!replies || !tabList) return;
    let tab = tabList.querySelector<HTMLElement>(`[${TAB_ATTR}]`);
    if (!tab) {
      const template = tabList.querySelector('a[role="tab"][aria-selected="false"]') ?? replies;
      const item = template.closest('[role="presentation"]') ?? template;
      tab = item.cloneNode(true) as HTMLElement;
      tab.setAttribute(TAB_ATTR, handle);
      tab.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      const anchor = tab.matches('a') ? tab : tab.querySelector('a');
      anchor?.setAttribute('href', `/${handle}/with_replies`);
      anchor?.setAttribute('aria-selected', 'false');
      tab.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          withRunner((instance) => instance.openFromTab(handle));
        },
        true,
      );
      tabList.appendChild(tab);
    }
    const label = [...tab.querySelectorAll('span')].find(
      (sp) => sp.childElementCount === 0 || sp.hasAttribute('data-fs-ai-label'),
    );
    if (label) {
      label.setAttribute('data-fs-ai-label', '');
      const next = tabLabel(handle);
      if (label.textContent !== next.map((n) => n.textContent).join('')) {
        label.replaceChildren(...next);
      }
    }
  }

  const onPanelMessage = (message: unknown): Promise<unknown> | undefined => {
    const msg = message as { type?: string; handle?: unknown; force?: unknown } | null;
    if (msg?.type !== 'feedsieve:ai-start' || typeof msg.handle !== 'string') return undefined;
    const handle = msg.handle.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{1,15}$/.test(handle)) return Promise.resolve({ ok: false });
    withRunner((instance) => instance.startFromPanel(handle, msg.force === true));
    return Promise.resolve({ ok: true });
  };

  const runtime = (globalThis as { browser?: typeof browser }).browser?.runtime;
  const storage = (globalThis as { browser?: typeof browser }).browser?.storage;

  function applyList(state: AiListState | undefined): void {
    list = new Map(
      (state?.entries ?? []).map(([h, score, listed]) => [h, { score, listed: listed === 1 }]),
    );
  }

  const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
    if (area !== 'local') return;
    if (changes[AI_LIST_KEY]) applyList(changes[AI_LIST_KEY].newValue as AiListState | undefined);
    if (changes[AI_RECORDS_KEY]) {
      records = (changes[AI_RECORDS_KEY].newValue as Record<string, AiCheckRecord>) ?? {};
    }
    if (changes[AI_SETTINGS_KEY]) settings = normalizeAiSettings(changes[AI_SETTINGS_KEY].newValue);
    document.querySelectorAll(`[${MARK_ATTR}]`).forEach((a) => {
      a.removeAttribute(MARK_ATTR);
      a.removeAttribute(TONE_ATTR);
    });
    scheduleDecorate();
  };

  function clearDecorations(): void {
    runner?.closePanel();
    document
      .querySelectorAll('[data-fs-action="ai"], .fs-ai-mark, .fs-ai-foldbar')
      .forEach((b) => b.remove());
    document.querySelectorAll(`[${TAB_ATTR}]`).forEach((n) => n.remove());
    document.querySelectorAll(`[${FOLD_ATTR}]`).forEach((n) => n.removeAttribute(FOLD_ATTR));
    document.querySelectorAll(`[${BUTTON_ATTR}], [${MARK_ATTR}], [${TONE_ATTR}]`).forEach((a) => {
      a.removeAttribute(BUTTON_ATTR);
      a.removeAttribute(MARK_ATTR);
      a.removeAttribute(TONE_ATTR);
    });
  }

  function decorate(only?: readonly Element[]): void {
    if (stopped) return;
    if (deps.isEnabled?.() === false) {
      if (moduleOn !== false) clearDecorations();
      moduleOn = false;
      return;
    }
    if (moduleOn !== true) {
      moduleOn = true;
      void deps.send({ type: AI_LIST_SYNC_MESSAGE }).catch(() => undefined);
    }
    decorateArticles(only);
    ensureTab();
  }

  let decorateTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleDecorate(): void {
    if (stopped || decorateTimer !== null) return;
    decorateTimer = globalThis.setTimeout(() => {
      decorateTimer = null;
      decorate();
    }, DECORATE_THROTTLE_MS);
  }

  function tick(): void {
    if (stopped) return;
    if (deps.isEnabled?.() === false) {
      if (moduleOn !== false) clearDecorations();
      moduleOn = false;
    } else if (moduleOn !== true) {
      decorate();
    } else {
      ensureTab();
    }
    const profile = profileFromPath(location.pathname);
    runner?.tick(profile);
    if (profile?.tab !== 'replies') return;
    const params = new URLSearchParams(location.search);
    const autoFromUrl = params.get('fs_ai')?.toLowerCase();
    if (autoFromUrl && autoFromUrl === profile.handle) {
      const force = params.get('force') === '1';
      const postId = params.get('fs_post') ?? undefined;
      params.delete('fs_ai');
      params.delete('force');
      params.delete('fs_post');
      const qs = params.toString();
      history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : ''));
      withRunner((instance) => void instance.run(profile.handle, force, postId));
      return;
    }
    const auto = sessionStorage.getItem(AUTOSTART_KEY);
    const autoHandle = auto?.replace(/!$/, '');
    if (autoHandle === profile.handle || runner?.hasPendingFor(profile.handle)) {
      const force = auto?.endsWith('!') === true;
      sessionStorage.removeItem(AUTOSTART_KEY);
      withRunner((instance) => {
        if (instance.hasPendingFor(profile.handle)) {
          instance.tick(profile);
        } else {
          void instance.run(profile.handle, force);
        }
      });
    }
  }

  return {
    ingest,
    decorate,
    tick,
    start(): void {
      ensureAiCheckStyles();
      runtime?.onMessage?.addListener(onPanelMessage);
      storage?.onChanged?.addListener(onStorage);
      void storage?.local
        ?.get([AI_LIST_KEY, AI_RECORDS_KEY, AI_SETTINGS_KEY])
        .then((stored) => {
          applyList(stored[AI_LIST_KEY] as AiListState | undefined);
          records = (stored[AI_RECORDS_KEY] as Record<string, AiCheckRecord>) ?? {};
          settings = normalizeAiSettings(stored[AI_SETTINGS_KEY]);
          decorate();
        })
        .catch(() => undefined);
      tick();
    },
    stop(): void {
      stopped = true;
      if (decorateTimer !== null) {
        globalThis.clearTimeout(decorateTimer);
        decorateTimer = null;
      }
      runner?.stop();
      runtime?.onMessage?.removeListener(onPanelMessage);
      storage?.onChanged?.removeListener(onStorage);
      clearDecorations();
    },
  };
}
