/**
 * AI 味检测（页面端）。
 *
 * 入口一：博主主页的 Tab 栏（帖子 / 回复 / 媒体…）末尾加一个「AI 味」Tab。有结论就直接在
 * Tab 上显示「AI 味 95%」，点开看报告；没测过点一下就切到「回复」Tab 开测。
 * 入口二：帖子详情页里每条「回复」的动作栏一个和 X 原生按钮同款的机器人图标（常显，引导去测）。
 * 原创主帖、原帖作者在自己串里的回复、自己、官方机器人不加；被打开的那条本身是回复时也加。
 * 入口三：评论区 / 时间线里已有结论的号（社区名单、自己测过的），名字后面一个「AI 味 N%」标签，
 * 点开看报告；设置成折叠时整条收成一行。
 *
 * 取数：优先用 X 接口已经返回的数据（回复自带回的哪条帖子），DOM 上下配对兜底；不额外请求 X。
 * 有结论时直接出报告，不再翻页重测；关掉检测卡以后从 Tab / 标签 / 面板都能回来看、继续投票。
 */
import {
  contextFromPath,
  extractFeedItem,
  profileFromPath,
  tweetSelectors,
} from '@feedsieve/x-adapter';
import {
  MAX_REPLIES,
  medianGap,
  MIN_AUTHORS,
  MIN_REPLIES,
  ReplyCollector,
  replyGaps,
  replySpan,
  rhythmOf,
  type ApiTweet,
  type PageTweet,
} from './evidence';
import { flavorOf, type Lang } from '@feedsieve/shared';
import { canvasToBlob, loadAvatar } from '../share/canvas-kit';
import { drawShareCard, formatGap, spreadLabel } from './share-card';
import {
  AI_JUDGE_MESSAGE,
  AI_LIST_KEY,
  AI_LIST_SYNC_MESSAGE,
  AI_LOOKUP_MESSAGE,
  AI_OUTCOME_MESSAGE,
  AI_RECORDS_KEY,
  AI_SETTINGS_KEY,
  AI_VOTE_MESSAGE,
  DEFAULT_AI_SETTINGS,
  normalizeAiSettings,
  type AiCheckRecord,
  type AiCheckSettings,
  type AiJudgeOutcome,
  type AiListState,
  type AiLookupOutcome,
  type AiRhythm,
  type AiVoteOutcome,
} from './client';
import { actionIcon, alignActionSlot, createActionSlot } from '../content/action-slot';

const SITE_BASE = 'https://feedsieve.win';
const MARK_ATTR = 'data-fs-ai-mark';
const FOLD_ATTR = 'data-fs-ai-fold';
const AUTOSTART_KEY = 'fs-ai-autostart';
const BUTTON_ATTR = 'data-fs-ai';
const TAB_ATTR = 'data-fs-ai-tab';
const PANEL_ID = 'fs-ai-panel';
const STYLE_ID = 'feedsieve-ai-check-styles';
/** 官方机器人不测 */
const EXEMPT = new Set(['grok']);
const MAX_SCROLL_STEPS = 20;
/** 最多读两批：服务端先判最近 15 条，灰色地带再用后 15 条补判 */
const MAX_UPLOAD = MAX_REPLIES * 2;

const TEXT = {
  zh: {
    tab: 'AI 味',
    buttonTip: '测测 TA 的 AI 味',
    retest: '重新检测',
    expired: '结论已过期，可以重测',
    title: 'AI 味检测',
    collecting: (n: number) => `正在翻 TA 的回复 · 已读 ${n} 条`,
    narrow: (k: number) => `回复只集中在 ${k} 个人身上，至少要回给 ${MIN_AUTHORS} 个不同的人才好判`,
    sampleValue: (n: number, k: number | null) => (k ? `${n} 条 · ${k} 人` : `${n} 条`),
    spanLine: (span: string) => `最近 ${span}内的回复`,
    judging: '模型正在品鉴…',
    flavor: 'AI 味',
    samples: '样本',
    gap: '间隔',
    spread: '长短波动',
    voteAi: '是 AI',
    voteHuman: '是真人',
    tally: (ai: number, human: number) =>
      ai + human === 0 ? '还没人投票，你来第一票' : `${ai} 人认为是 AI · ${human} 人认为是真人`,
    listed: '已进社区 AI 号名单',
    copy: '复制报告图',
    download: '下载',
    copied: '已复制，去发帖粘贴',
    downloaded: '已下载',
    retry: '重试',
    close: '关闭',
    cached: '近期已有人测过',
    insufficient: (n: number) => `只找到 ${n} 条回复，至少要 ${MIN_REPLIES} 条，TA 话太少了`,
    error: {
      local_only: '「仅本地运行」已开启，检测需要联网',
      insufficient: `回复不够 ${MIN_REPLIES} 条，没法判`,
      rate_limited: '今天的检测次数用完了，明天再来',
      unavailable: '检测服务暂时不可用，稍后再试',
      network: '网络不通，稍后再试',
    },
    voteFailed: '投票没成功，稍后再试',
    stop: '停止',
    stopped: '已停止',
    noData: '页面上没读到这个人的回复，刷新页面再试',
    mineOnly: '只有你能看到 · 再有一人测到同样结果才公开',
    underReview: '有人认为是真人，维护者复核中',
    shareLink: '分享到 X',
    shareText: (name: string, pct: number, level: string) =>
      `测了一下 ${name} 的回复：AI 味 ${pct}%（${level}）`,
    mark: (pct: number) => `AI 味 ${pct}%`,
    markListed: '社区 AI 号',
    folded: (name: string, pct: string) => `已折叠 ${name} 的回复 · ${pct}`,
    unfold: '显示',
  },
  en: {
    tab: 'AI flavor',
    buttonTip: 'Check their AI flavor',
    retest: 'Check again',
    expired: 'This result has expired. You can check again',
    title: 'AI Flavor Check',
    collecting: (n: number) => `Reading replies · ${n} so far`,
    narrow: (k: number) => `Replies only go to ${k} people; need at least ${MIN_AUTHORS}`,
    sampleValue: (n: number, k: number | null) => (k ? `${n} · ${k} people` : String(n)),
    spanLine: (span: string) => `Replies from the last ${span}`,
    judging: 'The model is tasting…',
    flavor: 'AI flavor',
    samples: 'Replies',
    gap: 'Gap',
    spread: 'Variety',
    voteAi: 'It’s AI',
    voteHuman: 'It’s human',
    tally: (ai: number, human: number) =>
      ai + human === 0 ? 'No votes yet. Cast the first one' : `${ai} say AI · ${human} say human`,
    listed: 'On the community AI list',
    copy: 'Copy image',
    download: 'Download',
    copied: 'Copied. Paste it into a post',
    downloaded: 'Downloaded',
    retry: 'Retry',
    close: 'Close',
    cached: 'Checked recently by someone',
    insufficient: (n: number) => `Only ${n} replies found, need at least ${MIN_REPLIES}`,
    error: {
      local_only: 'Local-only mode is on; checks need the network',
      insufficient: `Fewer than ${MIN_REPLIES} replies, can’t judge`,
      rate_limited: 'Daily check limit reached. Try tomorrow',
      unavailable: 'Check service unavailable. Try later',
      network: 'Network error. Try later',
    },
    voteFailed: 'Vote failed. Try later',
    stop: 'Stop',
    stopped: 'Stopped',
    noData: 'No replies from this account were found. Reload and try again',
    mineOnly: 'Only you can see this until someone else gets the same result',
    underReview: 'Someone says this is a human; under review',
    shareLink: 'Share on X',
    shareText: (name: string, pct: number, level: string) =>
      `Checked ${name}'s replies: ${pct}% AI flavor (${level})`,
    mark: (pct: number) => `AI ${pct}%`,
    markListed: 'Community AI list',
    folded: (name: string, pct: string) => `Folded a reply from ${name} · ${pct}`,
    unfold: 'Show',
  },
} as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    [${TAB_ATTR}] .fs-ai-tab-pct { margin-left: 4px; font-weight: 800; }
    #${PANEL_ID} {
      position: fixed; top: 72px; right: 24px; z-index: 2147483000; width: 320px; box-sizing: border-box;
      padding: 18px; border-radius: 20px; background: #0b0d12; color: #fff;
      border: 1px solid rgba(255,255,255,.12); box-shadow: 0 20px 60px rgba(0,0,0,.45);
      font: 14px/1.45 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      animation: fs-ai-in .28s cubic-bezier(.2,.9,.3,1.2);
    }
    #${PANEL_ID} * { box-sizing: border-box; }
    @keyframes fs-ai-in { from { opacity: 0; transform: translateY(-8px) scale(.97); } }
    .fs-ai-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .fs-ai-title { font-weight: 800; font-size: 15px; }
    .fs-ai-handle { color: rgba(255,255,255,.55); font-size: 13px; margin-left: 6px; font-weight: 500; }
    .fs-ai-x { border: 0; background: transparent; color: rgba(255,255,255,.5); font-size: 18px; cursor: pointer; line-height: 1; }
    .fs-ai-x:hover { color: #fff; }
    .fs-ai-primary, .fs-ai-ghost {
      display: flex; align-items: center; justify-content: center; text-align: center;
      width: 100%; height: 40px; padding: 0 12px; border-radius: 9999px;
      font: 800 14px/1 inherit; font-family: inherit; cursor: pointer;
    }
    .fs-ai-primary:disabled, .fs-ai-ghost:disabled { opacity: .6; cursor: default; }
    .fs-ai-primary { border: 0; background: #fff; color: #0b0d12; }
    .fs-ai-primary:hover { background: #e7e9ea; }
    .fs-ai-ghost { border: 1px solid rgba(255,255,255,.25); background: transparent; color: #fff; }
    .fs-ai-ghost:hover { background: rgba(255,255,255,.08); }
    .fs-ai-row { display: flex; gap: 8px; margin-top: 10px; }
    .fs-ai-row > * { flex: 1; }
    .fs-ai-status { font-weight: 600; margin-bottom: 10px; }
    .fs-ai-track { position: relative; height: 8px; border-radius: 4px; background: rgba(255,255,255,.1); overflow: hidden; }
    .fs-ai-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg,#22d39b,#ffb020,#ff4d6d); transition: width .4s ease; }
    .fs-ai-sweep::after {
      content: ""; position: absolute; inset: 0; width: 40%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,.45), transparent);
      animation: fs-ai-sweep 1.1s linear infinite;
    }
    @keyframes fs-ai-sweep { from { transform: translateX(-100%); } to { transform: translateX(260%); } }
    .fs-ai-pulse { animation: fs-ai-pulse 1s ease-in-out infinite; }
    @keyframes fs-ai-pulse { 50% { opacity: .45; } }
    .fs-ai-label { color: rgba(255,255,255,.6); font-size: 13px; font-weight: 600; }
    .fs-ai-pct { font-size: 64px; font-weight: 900; line-height: 1; letter-spacing: -.02em; margin: 2px 0 10px; }
    .fs-ai-pct small { font-size: 28px; font-weight: 800; margin-left: 2px; }
    .fs-ai-meter { position: relative; height: 8px; border-radius: 4px; margin: 0 0 14px;
      background: linear-gradient(90deg,#22d39b,#ffb020,#ff4d6d); }
    .fs-ai-dot { position: absolute; top: 50%; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%;
      background: #fff; box-shadow: 0 0 0 3px #0b0d12; transition: left .9s cubic-bezier(.2,.9,.3,1); }
    .fs-ai-level { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-weight: 900; color: #0b0d12; font-size: 15px; }
    .fs-ai-roast { margin: 10px 0 14px; font-size: 15px; font-weight: 600; }
    .fs-ai-stats { display: flex; justify-content: space-between; padding: 10px 0; margin-bottom: 4px;
      border-top: 1px solid rgba(255,255,255,.1); border-bottom: 1px solid rgba(255,255,255,.1); }
    .fs-ai-stats div { display: flex; flex-direction: column; gap: 2px; }
    .fs-ai-stats span { color: rgba(255,255,255,.5); font-size: 12px; }
    .fs-ai-stats b { font-size: 15px; }
    .fs-ai-tally { margin-top: 10px; color: rgba(255,255,255,.65); font-size: 12px; text-align: center; }
    .fs-ai-toast { margin-top: 10px; text-align: center; font-size: 12px; color: #22d39b; }
    .fs-ai-voted { border-color: #fff !important; background: rgba(255,255,255,.14) !important; }
    .fs-ai-error { color: #ffb020; font-weight: 600; margin-bottom: 12px; }
    .fs-ai-note { margin-top: 10px; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.07);
      color: rgba(255,255,255,.75); font-size: 12px; text-align: center; }
    .fs-ai-stop { margin-top: 12px; }
    /* 评论区：名字后面一个小标签，点开看报告 */
    .fs-ai-mark { display: inline-flex; align-items: center; height: 18px; margin-left: 6px; padding: 0 7px;
      border-radius: 9999px; font: 700 11px/1 system-ui, sans-serif; cursor: pointer; white-space: nowrap;
      border: 0; background: rgba(255,77,109,.12); color: #f4212e; flex: none; align-self: center; }
    .fs-ai-mark[data-tone="mixed"] { background: rgba(255,176,32,.15); color: #b45309; }
    .fs-ai-mark:hover { filter: brightness(.95); text-decoration: underline; }
    /* 折叠：整条回复收成一行，点「显示」展开 */
    [data-fs-ai-fold="1"] > :not(.fs-ai-foldbar) { display: none !important; }
    .fs-ai-foldbar { display: flex; align-items: center; gap: 8px; padding: 10px 16px;
      color: rgb(113,118,123); font: 13px/1.4 system-ui, sans-serif; border-bottom: 1px solid rgba(113,118,123,.2); }
    .fs-ai-foldbar button { border: 0; background: none; color: rgb(29,155,240); cursor: pointer; font: inherit; padding: 0; }
    .fs-ai-foldbar button:hover { text-decoration: underline; }
  `;
  document.head.appendChild(style);
}

const TONE_COLOR = { ai: '#ff4d6d', mixed: '#ffb020', human: '#22d39b' } as const;

/** 一个账号的结论：服务端可公开的，或者自己测过、还没公开的（只有本人能看到） */
interface Known {
  verdict: 'ai' | 'suspect' | 'human' | 'insufficient' | null;
  score: number | null;
  replyCount: number;
  rhythm: AiRhythm | null;
  expired: boolean;
  votes: { ai_count: number; human_count: number; listed: boolean } | null;
  myVote: 'ai' | 'human' | null;
  /** 来自自己的本机记录、服务端还没公开 */
  mineOnly: boolean;
  underReview: boolean;
}

type Judged = Known & { score: number; verdict: 'ai' | 'suspect' | 'human' };

/** 页面上收到的 X 接口帖子，最多留这么多条（只在本页内存里，用来配对原帖、判断是不是回复） */
const API_BUFFER_MAX = 3_000;

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
  };
}

export function createAiCheck(deps: {
  getLanguage: () => Lang;
  getSelfHandle: () => string | null;
  /** 已关注、个人白名单：不标记、不折叠 */
  isProtected?: (handle: string) => boolean;
  send: (message: unknown) => Promise<unknown>;
  setInterval: (fn: () => void, ms: number) => unknown;
}) {
  let running: { handle: string; token: number } | null = null;
  let panelHandle: string | null = null;
  /** 卡片打开时的页面地址：离开这个页面才收起（详情页、主页都能开卡片） */
  let panelPath: string | null = null;
  let token = 0;
  let stopped = false;
  /** 用户在检测中点了「停止」 */
  let stopRequested = false;
  /** 点了 Tab / 面板、等切到回复页后要开测的账号 */
  let pending: string | null = null;
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
  /** 正在收集证据的那次检测：接口数据到了直接喂进去 */
  let activeCollector: ReplyCollector | null = null;
  const unfolded = new Set<string>();
  const t = () => TEXT[deps.getLanguage()];

  function readPage(context = contextFromPath(location.pathname)) {
    const tweets: Array<PageTweet & { displayName?: string }> = [];
    for (const article of document.querySelectorAll(tweetSelectors.article)) {
      const item = extractFeedItem(article, context);
      if (!item) continue;
      tweets.push({
        postId: item.postId,
        handle: item.author.handle,
        text: item.text,
        displayName: item.author.displayName,
      });
    }
    return tweets;
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
    activeCollector?.observeApi(tweets);
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
      };
    }
    // 服务端还没公开，但自己测过：用本机那份（只有本人能看到）
    const mine = outcome?.mine ?? records[handle] ?? null;
    if (mine && mine.score !== null && mine.verdict !== 'insufficient') {
      return {
        ...fromRecord(mine, myVote),
        votes: remote?.votes ?? null,
        underReview: remote?.under_review === true,
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
        underReview: remote?.under_review === true,
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
        return value;
      });
    lookups.set(handle, promise);
    return promise;
  }

  function judged(k: Known | null | undefined): k is Judged {
    return !!k && k.score !== null && !!k.verdict && k.verdict !== 'insufficient';
  }

  /** 评论区要标记的结论：已知结论 → 社区名单 → 本机记录 */
  function markFor(
    handle: string,
  ): { percent: number; tone: 'ai' | 'mixed'; listed: boolean } | null {
    const k = known.get(handle);
    if (judged(k)) {
      if (k.verdict === 'human') return null;
      const f = flavorOf(k.score, k.verdict, k.rhythm, deps.getLanguage(), handle);
      return f.tone === 'human'
        ? null
        : { percent: f.percent, tone: f.tone, listed: !!k.votes?.listed };
    }
    const entry = list.get(handle);
    if (entry) {
      if (entry.score === null) return { percent: -1, tone: 'ai', listed: true };
      const f = flavorOf(entry.score, 'suspect', null, deps.getLanguage(), handle);
      return f.tone === 'human' ? null : { percent: f.percent, tone: f.tone, listed: entry.listed };
    }
    const mine = records[handle];
    if (mine && mine.score !== null && (mine.verdict === 'ai' || mine.verdict === 'suspect')) {
      const f = flavorOf(mine.score, mine.verdict, mine.rhythm ?? null, deps.getLanguage(), handle);
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

  function isBlue(article: Element): boolean {
    return !!article.querySelector(
      `${tweetSelectors.authorNameArea} [data-testid="icon-verified"]`,
    );
  }

  function inScope(article: Element): boolean {
    if (settings.scope === 'all') return true;
    return settings.scope === 'blue' ? isBlue(article) : !isBlue(article);
  }

  /** 通知页的回复卡片在 User-Name 后面有一行「回复 @你 / Replying to @you」 */
  function hasReplyContext(article: Element): boolean {
    const name = article.querySelector(tweetSelectors.authorNameArea);
    if (!name) return false;
    const text = (article.textContent ?? '').replace(/\s+/g, ' ');
    const nameText = (name.textContent ?? '').replace(/\s+/g, ' ');
    const at = text.indexOf(nameText);
    const head = at >= 0 ? text.slice(at + nameText.length, at + nameText.length + 120) : '';
    return /(?:回复|Replying to)\s*@/i.test(head);
  }

  // ---- 入口二、三：回复上的机器人图标，已有结论的号加标签 / 折叠 ----
  function decorateArticles(): void {
    const focal = location.pathname.match(/\/status\/(\d+)/)?.[1] ?? null;
    // 通知页：别人对你的回复也加检测入口（聚合通知卡不算）。
    const notifications = /^\/notifications(?:[/?#]|$)/.test(location.pathname);
    const self = deps.getSelfHandle()?.toLowerCase();
    const root = focal ? rootAuthor(focal) : null;
    let focalSeen = false;
    let focalAuthor: string | null = null;
    for (const article of document.querySelectorAll(tweetSelectors.article)) {
      const item = extractFeedItem(article, focal ? 'reply' : contextFromPath(location.pathname));
      if (!item?.postId) continue;
      const handle = item.author.handle.toLowerCase();
      const isFocal = item.postId === focal;
      if (isFocal) {
        focalSeen = true;
        focalAuthor = handle;
      }
      // 自己、官方机器人：哪里都不加。已关注 / 白名单：照样给检测入口（主动去测没问题），只是不自动标记、不折叠
      const exempt = handle === self || EXEMPT.has(handle);
      const protectedAccount = exempt || deps.isProtected?.(handle) === true;

      // 机器人图标：详情页加在「回复」上；通知页加在别人对你的回复上
      if (focal || notifications) {
        let eligible: boolean;
        if (focal) {
          const reply = isReplyById(item.postId);
          const opAuthor =
            root ??
            (reply === false && isFocal ? handle : null) ??
            (!focalSeen ? null : focalAuthor);
          // 接口数据说了算；没有接口数据时退回「被打开那条下面的评论」
          const looksLikeReply = reply ?? (focalSeen && !isFocal);
          eligible = looksLikeReply && !exempt && handle !== opAuthor;
        } else {
          // 通知页：接口数据优先，没有就认 DOM 里的「回复 @xxx」上下文
          const looksLikeReply = isReplyById(item.postId) ?? hasReplyContext(article);
          eligible = looksLikeReply && !exempt && handle !== self;
        }
        const group = eligible
          ? (article.querySelector(tweetSelectors.actionAnchor)?.closest('[role="group"]') ?? null)
          : null;
        const key = eligible ? item.postId : '-';
        if (article.getAttribute(BUTTON_ATTR) !== key) {
          article.setAttribute(BUTTON_ATTR, key);
          article.querySelectorAll('[data-fs-action="ai"]').forEach((b) => b.remove());
        }
        // X 或别的模块可能重建动作栏；每次 tick 发现按钮没了就补回来。
        if (eligible && group && !group.querySelector('[data-fs-action="ai"]')) {
          const slot = createActionSlot(group, 'ai', t().buttonTip);
          slot.setContent(actionIcon('robot'));
          slot.button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void openFor(handle);
          });
          const block = group.querySelector('[data-fs-action="block"]');
          if (block) group.insertBefore(slot.root, block);
          else group.appendChild(slot.root);
          alignActionSlot(slot.root);
          if (block instanceof HTMLElement) alignActionSlot(block);
        }
      }

      // 已有结论的号：名字后面一个标签；设置成折叠时整条收起（主帖本身不折叠）
      const mark =
        protectedAccount || settings.mode === 'off' || !inScope(article) ? null : markFor(handle);
      const markKey = mark ? `${handle}:${mark.percent}:${mark.tone}:${settings.mode}` : '-';
      if (article.getAttribute(MARK_ATTR) !== markKey) {
        article.setAttribute(MARK_ATTR, markKey);
        article.querySelectorAll('.fs-ai-mark').forEach((m) => m.remove());
        const cell = article.closest(tweetSelectors.timelineCell);
        cell?.removeAttribute(FOLD_ATTR);
        cell?.querySelectorAll(':scope > .fs-ai-foldbar').forEach((b) => b.remove());
        if (mark) {
          const nameRow = article.querySelector(tweetSelectors.authorNameArea);
          const pill = el(
            'button',
            'fs-ai-mark',
            mark.percent < 0 ? t().markListed : t().mark(mark.percent),
          );
          pill.type = 'button';
          pill.dataset.tone = mark.tone;
          pill.title = t().buttonTip;
          pill.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void openFor(handle);
          });
          nameRow?.appendChild(pill);
          if (settings.mode === 'fold' && cell && !isFocal && !unfolded.has(item.postId)) {
            const bar = el('div', 'fs-ai-foldbar');
            const name = item.author.displayName || `@${handle}`;
            bar.appendChild(
              el(
                'span',
                undefined,
                t().folded(name, mark.percent < 0 ? t().markListed : t().mark(mark.percent)),
              ),
            );
            const show = el('button', undefined, t().unfold);
            show.type = 'button';
            const postId = item.postId;
            show.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              unfolded.add(postId);
              cell.removeAttribute(FOLD_ATTR);
              bar.remove();
            });
            bar.appendChild(show);
            cell.prepend(bar);
            cell.setAttribute(FOLD_ATTR, '1');
          }
        }
      }
    }
  }

  /** 点机器人图标 / 标签：有结论直接出报告，没有就去这个人的回复页测 */
  /** 在他的回复页开测：新标签打开，不动当前页（用户可能正在看评论或详情）。 */
  function openInNewTab(handle: string, force: boolean): void {
    const url = `https://x.com/${handle}/with_replies?fs_ai=${handle}${force ? '&force=1' : ''}`;
    void deps.send({ type: 'feedsieve:open-tab', url }).catch(() => undefined);
  }

  async function openFor(handle: string): Promise<void> {
    const k = known.has(handle) ? known.get(handle) : await lookup(handle);
    if (judged(k) && !k.expired) {
      showKnown(handle, k);
      return;
    }
    openInNewTab(handle, false);
  }

  // ---- 入口一：主页 Tab 栏的「AI 味」Tab ----
  function repliesTab(handle: string): HTMLAnchorElement | null {
    for (const a of document.querySelectorAll<HTMLAnchorElement>(
      '[data-testid="primaryColumn"] a[role="tab"]',
    )) {
      if (a.getAttribute('href')?.toLowerCase() === `/${handle}/with_replies`) return a;
    }
    return null;
  }

  function tabLabel(handle: string): Node[] {
    const k = known.get(handle);
    const nodes: Node[] = [document.createTextNode(t().tab)];
    if (judged(k)) {
      const flavor = flavorOf(k.score, k.verdict, k.rhythm, deps.getLanguage(), handle);
      const pct = el('span', 'fs-ai-tab-pct', `${flavor.percent}%`);
      pct.style.color = TONE_COLOR[flavor.tone];
      nodes.push(pct);
    }
    return nodes;
  }

  function ensureTab(): void {
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
      // 照抄一个未选中的原生 Tab 的结构，样式和 X 完全一致（React 事件不随 cloneNode 带过来）
      const template = tabList.querySelector('a[role="tab"][aria-selected="false"]') ?? replies;
      const item = template.closest('[role="presentation"]') ?? template;
      tab = item.cloneNode(true) as HTMLElement;
      tab.setAttribute(TAB_ATTR, handle);
      tab.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      const anchor = (tab.matches('a') ? tab : tab.querySelector('a')) as HTMLAnchorElement | null;
      anchor?.setAttribute('href', `/${handle}/with_replies`);
      anchor?.setAttribute('aria-selected', 'false');
      tab.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          openFromTab(handle);
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

  function openFromTab(handle: string, force = false): void {
    const k = known.get(handle);
    if (!force && judged(k) && !k.expired) {
      showKnown(handle, k);
      return;
    }
    if (profileFromPath(location.pathname)?.tab === 'replies') {
      void run(handle, force);
      return;
    }
    // 切到 X 自己的「回复」Tab（站内跳转，不刷新页面），到了再开测
    pending = handle;
    pendingForce = force;
    showProgress(handle, 0, false);
    const replies = repliesTab(handle);
    if (replies) replies.click();
    else {
      pending = null;
      pendingForce = false;
      closePanel();
      openInNewTab(handle, force);
    }
  }
  let pendingForce = false;

  /** 页面上这个人的头像地址：主页头部的大头像，或者 TA 某条帖子旁边的头像 */
  function avatarOnPage(handle: string): string | null {
    for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href$="/photo"]')) {
      if (a.getAttribute('href')?.toLowerCase() === `/${handle}/photo`) {
        const src = a.querySelector('img')?.src;
        if (src) return src;
      }
    }
    for (const article of document.querySelectorAll(tweetSelectors.article)) {
      const item = extractFeedItem(article, 'other');
      if (item?.author.handle.toLowerCase() !== handle) continue;
      const src = article.querySelector<HTMLImageElement>(
        '[data-testid="Tweet-User-Avatar"] img',
      )?.src;
      if (src) return src;
    }
    return null;
  }

  function displayNameOn(handle: string): string | undefined {
    const profile = profileFromPath(location.pathname);
    if (profile?.handle === handle) {
      const name = document.querySelector('[data-testid="UserName"] span')?.textContent?.trim();
      if (name) return name;
    }
    for (const article of document.querySelectorAll(tweetSelectors.article)) {
      const item = extractFeedItem(article, 'other');
      if (item?.author.handle.toLowerCase() === handle && item.author.displayName) {
        return item.author.displayName;
      }
    }
    return undefined;
  }

  function showKnown(handle: string, k: Judged): void {
    showResult({
      handle,
      displayName: displayNameOn(handle),
      score: k.score,
      verdict: k.verdict,
      replyCount: k.replyCount,
      medianGapS: k.rhythm?.median_gap ?? null,
      authors: k.rhythm?.authors ?? null,
      spanS: k.rhythm?.span ?? null,
      rhythm: k.rhythm,
      cached: true,
      votes: k.votes,
      myVote: k.myVote,
      expired: k.expired,
      mineOnly: k.mineOnly,
      underReview: k.underReview,
    });
  }

  // ---- 检测卡 ----
  function panel(): HTMLElement | null {
    return document.getElementById(PANEL_ID);
  }

  function closePanel(): void {
    token += 1;
    running = null;
    panelHandle = null;
    panelPath = null;
    activeCollector = null;
    panel()?.remove();
  }

  function shell(handle: string): HTMLElement {
    ensureStyles();
    panelHandle = handle;
    panelPath = location.pathname;
    let root = panel();
    if (!root) {
      root = el('div');
      root.id = PANEL_ID;
      document.body.appendChild(root);
    }
    root.replaceChildren();
    const head = el('div', 'fs-ai-head');
    const title = el('div', 'fs-ai-title', t().title);
    title.appendChild(el('span', 'fs-ai-handle', `@${handle}`));
    const close = el('button', 'fs-ai-x', '×');
    close.type = 'button';
    close.title = t().close;
    close.addEventListener('click', () => {
      pending = null;
      closePanel();
    });
    head.append(title, close);
    root.appendChild(head);
    const body = el('div');
    root.appendChild(body);
    return body;
  }

  function showProgress(handle: string, n: number, judging: boolean): void {
    const body = shell(handle);
    const status = el('div', `fs-ai-status${judging ? ' fs-ai-pulse' : ''}`);
    status.textContent = judging ? t().judging : t().collecting(n);
    const track = el('div', 'fs-ai-track fs-ai-sweep');
    const fill = el('div', 'fs-ai-fill');
    fill.style.width = `${judging ? 100 : Math.max(6, (n / MAX_REPLIES) * 100)}%`;
    track.appendChild(fill);
    body.append(status, track);
    if (!judging) {
      const stop = el('button', 'fs-ai-ghost fs-ai-stop', t().stop);
      stop.type = 'button';
      stop.addEventListener('click', () => {
        stopRequested = true;
        stop.disabled = true;
      });
      body.appendChild(stop);
    }
  }

  function showError(handle: string, message: string): void {
    const body = shell(handle);
    body.appendChild(el('div', 'fs-ai-error', message));
    const retry = el('button', 'fs-ai-ghost', t().retry);
    retry.type = 'button';
    retry.addEventListener('click', () => void run(handle, true));
    body.appendChild(retry);
  }

  function toast(container: HTMLElement, message: string): void {
    container.querySelector('.fs-ai-toast')?.remove();
    const node = el('div', 'fs-ai-toast', message);
    container.appendChild(node);
    setTimeout(() => node.remove(), 2_000);
  }

  function countUp(node: HTMLElement, to: number): void {
    const startAt = performance.now();
    const unit = el('small', undefined, '%');
    const frame = (now: number) => {
      const p = Math.min(1, (now - startAt) / 900);
      const eased = 1 - (1 - p) ** 3;
      node.firstChild!.textContent = String(Math.round(to * eased));
      if (p < 1) requestAnimationFrame(frame);
    };
    node.replaceChildren(document.createTextNode('0'), unit);
    requestAnimationFrame(frame);
  }

  function tallyText(votes: { ai_count: number; human_count: number; listed: boolean }): string {
    const text = t();
    const base = text.tally(votes.ai_count, votes.human_count);
    return votes.listed ? `${base} · ${text.listed}` : base;
  }

  function showResult(input: {
    handle: string;
    displayName?: string;
    score: number;
    verdict: 'ai' | 'suspect' | 'human';
    replyCount: number;
    medianGapS: number | null;
    authors?: number | null;
    spanS?: number | null;
    rhythm: { fast: number; short: number; cv: number } | null;
    cached: boolean;
    votes?: { ai_count: number; human_count: number; listed: boolean } | null;
    myVote?: 'ai' | 'human' | null;
    expired?: boolean;
    mineOnly?: boolean;
    underReview?: boolean;
  }): void {
    const lang = deps.getLanguage();
    const text = t();
    const flavor = flavorOf(input.score, input.verdict, input.rhythm, lang, input.handle);
    const color = TONE_COLOR[flavor.tone];
    const cv = input.rhythm?.cv ?? 0;
    const body = shell(input.handle);

    body.appendChild(el('div', 'fs-ai-label', text.flavor));
    const pct = el('div', 'fs-ai-pct');
    pct.style.color = color;
    body.appendChild(pct);
    countUp(pct, flavor.percent);
    const meter = el('div', 'fs-ai-meter');
    const dot = el('div', 'fs-ai-dot');
    dot.style.left = '0%';
    meter.appendChild(dot);
    body.appendChild(meter);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => (dot.style.left = `${flavor.percent}%`)),
    );

    const level = el('span', 'fs-ai-level', flavor.level);
    level.style.background = color;
    body.appendChild(level);
    body.appendChild(el('div', 'fs-ai-roast', `「${flavor.roast}」`));

    const stats = el('div', 'fs-ai-stats');
    for (const [label, value] of [
      [text.samples, text.sampleValue(input.replyCount, input.authors ?? null)],
      [text.gap, formatGap(input.medianGapS, lang)],
      [text.spread, input.rhythm ? spreadLabel(cv, lang) : '—'],
    ] as const) {
      const cell = el('div');
      cell.append(el('span', undefined, label), el('b', undefined, value));
      stats.appendChild(cell);
    }
    body.appendChild(stats);
    if (input.spanS) {
      body.appendChild(el('div', 'fs-ai-tally', text.spanLine(formatGap(input.spanS, lang))));
    }
    if (input.underReview) body.appendChild(el('div', 'fs-ai-note', text.underReview));
    else if (input.mineOnly) body.appendChild(el('div', 'fs-ai-note', text.mineOnly));
    else if (input.expired) body.appendChild(el('div', 'fs-ai-tally', text.expired));
    else if (input.cached) body.appendChild(el('div', 'fs-ai-tally', text.cached));

    // 投票
    const votes = el('div', 'fs-ai-row');
    const tally = el('div', 'fs-ai-tally', input.votes ? tallyText(input.votes) : '');
    const voteButtons: HTMLButtonElement[] = [];
    for (const [vote, label] of [
      ['ai', text.voteAi],
      ['human', text.voteHuman],
    ] as const) {
      const button = el('button', 'fs-ai-ghost', label);
      button.type = 'button';
      if (input.myVote === vote) button.classList.add('fs-ai-voted');
      button.addEventListener('click', async () => {
        voteButtons.forEach((b) => (b.disabled = true));
        const outcome = (await deps
          .send({ type: AI_VOTE_MESSAGE, handle: input.handle, vote })
          .catch(() => null)) as AiVoteOutcome | null;
        voteButtons.forEach((b) => (b.disabled = false));
        if (!outcome?.ok) {
          toast(body, text.voteFailed);
          return;
        }
        voteButtons.forEach((b) => b.classList.toggle('fs-ai-voted', b === button));
        tally.textContent = tallyText(outcome.tally);
        const k = known.get(input.handle);
        if (k) {
          k.votes = { ...outcome.tally };
          k.myVote = vote;
        }
      });
      voteButtons.push(button);
      votes.appendChild(button);
    }
    body.append(votes, tally);

    // 分享：报告图（复制 / 下载）+ 带 OG 预览的链接（发到 X）
    let avatar: Promise<ImageBitmap | null> | null = null;
    const card = async () =>
      drawShareCard({
        handle: input.handle,
        displayName: input.displayName,
        avatar: await (avatar ??= loadAvatar(avatarOnPage(input.handle))),
        authors: input.authors ?? null,
        spanS: input.spanS ?? null,
        flavor,
        replyCount: input.replyCount,
        medianGapS: input.medianGapS,
        cv,
        lang,
        date: new Date(),
      });
    const download = async () => {
      const blob = await canvasToBlob(await card());
      const url = URL.createObjectURL(blob);
      const a = el('a');
      a.href = url;
      a.download = `ai-flavor-${input.handle}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
      toast(body, text.downloaded);
    };
    const share = el('div', 'fs-ai-row');
    const copy = el('button', 'fs-ai-primary', text.copy);
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try {
        const blob = await canvasToBlob(await card());
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast(body, text.copied);
      } catch {
        await download();
      }
    });
    const dl = el('button', 'fs-ai-ghost', text.download);
    dl.type = 'button';
    dl.addEventListener('click', () => void download());
    share.append(copy, dl);
    body.appendChild(share);
    const link = el('button', 'fs-ai-ghost', text.shareLink);
    link.type = 'button';
    link.style.marginTop = '10px';
    link.addEventListener('click', () => {
      // 只写名字不写 @：分享不去通知被测的人
      const name = input.displayName || input.handle;
      const url = `${SITE_BASE}/ai/${input.handle}`;
      const intent = new URL('https://x.com/intent/post');
      intent.searchParams.set('text', text.shareText(name, flavor.percent, flavor.level));
      intent.searchParams.set('url', url);
      window.open(intent.toString(), '_blank', 'noopener');
    });
    body.appendChild(link);
    if (input.expired) {
      const again = el('button', 'fs-ai-ghost', text.retest);
      again.type = 'button';
      again.style.marginTop = '10px';
      again.addEventListener('click', () => openFromTab(input.handle, true));
      body.appendChild(again);
    }
  }

  function report(outcome: 'insufficient' | 'narrow' | 'stopped' | 'no_data'): void {
    void deps.send({ type: AI_OUTCOME_MESSAGE, outcome }).catch(() => undefined);
  }

  async function run(handle: string, force = false): Promise<void> {
    if (running?.handle === handle) return;
    const my = ++token;
    running = { handle, token: my };
    stopRequested = false;
    const alive = () =>
      !stopped && token === my && profileFromPath(location.pathname)?.handle === handle;

    showProgress(handle, 0, false);
    // 已有结论（共享的或自己测过的）：直接出报告，不再翻页、不花钱
    const existing = await lookup(handle);
    if (!alive()) return;
    if (!force && judged(existing) && !existing.expired) {
      running = null;
      showKnown(handle, existing);
      return;
    }

    const collector = new ReplyCollector(handle);
    collector.limit = MAX_UPLOAD;
    activeCollector = collector;
    // 打开回复页时 X 已经返回的第一页接口数据
    collector.observeApi([...apiTweets.values()]);
    let displayName: string | undefined;
    const observe = () => {
      const tweets = readPage();
      displayName ??= tweets.find((tw) => tw.handle.toLowerCase() === handle)?.displayName;
      const before = collector.size;
      collector.observe(tweets);
      return collector.size - before;
    };

    // 等回复列表首屏渲染出来
    for (let i = 0; i < 12 && alive() && !document.querySelector(tweetSelectors.article); i++) {
      await sleep(500);
    }
    await sleep(600);
    observe();
    showProgress(handle, collector.size, false);
    let stale = 0;
    let lastSize = collector.size;
    for (
      let step = 0;
      step < MAX_SCROLL_STEPS && !collector.full && stale < 4 && alive() && !stopRequested;
      step++
    ) {
      window.scrollBy({ top: window.innerHeight * 0.85, behavior: 'smooth' });
      await sleep(1_100);
      observe();
      // 接口数据在两次 observe 之间也会进来：按总数判断有没有新进展
      stale = collector.size > lastSize ? 0 : stale + 1;
      lastSize = collector.size;
      if (alive() && !stopRequested) showProgress(handle, collector.size, false);
    }
    activeCollector = null;
    if (!alive()) return;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const replies = collector.list();
    if (replies.length < MIN_REPLIES) {
      running = null;
      report(stopRequested ? 'stopped' : replies.length === 0 ? 'no_data' : 'insufficient');
      showError(
        handle,
        stopRequested
          ? t().stopped
          : replies.length === 0
            ? t().noData
            : t().insufficient(replies.length),
      );
      return;
    }
    // 第一批（最近 10 条）也要够分散：都回同一两个人时看不出跨话题套模板
    const firstIds = replies.slice(0, MAX_REPLIES).map((r) => r.id);
    if (collector.authorCount(firstIds) < MIN_AUTHORS) {
      running = null;
      report('narrow');
      showError(handle, t().narrow(collector.authorCount(firstIds)));
      return;
    }
    showProgress(handle, replies.length, true);
    const gaps = replyGaps(replies);
    const [outcome] = (await Promise.all([
      deps
        .send({
          type: AI_JUDGE_MESSAGE,
          handle,
          replies,
          gaps,
          authorCount: collector.authorCount(),
          displayName: displayName ?? displayNameOn(handle) ?? null,
          avatarUrl: avatarOnPage(handle),
        })
        .catch(() => null),
      sleep(1_200), // 让「品鉴中」的动画至少走一轮
    ])) as [AiJudgeOutcome | null, unknown];
    if (!alive()) return;
    running = null;
    if (!outcome) {
      showError(handle, t().error.unavailable);
      return;
    }
    if (!outcome.ok) {
      showError(handle, t().error[outcome.error]);
      return;
    }
    const { value } = outcome;
    if (value.verdict === 'insufficient' || value.score === null) {
      showError(handle, t().error.insufficient);
      return;
    }
    // 服务端用了几条（只判第一批时是 10 条，补判时是全部），统计也按这些算
    const used = replies.slice(0, value.reply_count || MAX_REPLIES);
    const usedGaps = replyGaps(used);
    const rhythm: AiRhythm = {
      ...rhythmOf(used, usedGaps),
      median_gap: medianGap(usedGaps),
      authors: collector.authorCount(used.map((r) => r.id)),
      span: replySpan(used),
    };
    const prev = known.get(handle);
    const entry: Known = {
      verdict: value.verdict,
      score: value.score,
      replyCount: used.length,
      rhythm: value.rhythm ? { ...rhythm, ...value.rhythm, authors: rhythm.authors } : rhythm,
      expired: false,
      votes: prev?.votes ?? null,
      myVote: prev?.myVote ?? null,
      mineOnly: value.confirmed !== true,
      underReview: false,
    };
    known.set(handle, entry);
    ensureTab();
    showResult({
      handle,
      displayName: displayName ?? displayNameOn(handle),
      score: value.score,
      verdict: value.verdict,
      replyCount: entry.replyCount,
      medianGapS: entry.rhythm?.median_gap ?? null,
      authors: entry.rhythm?.authors ?? null,
      spanS: entry.rhythm?.span ?? null,
      rhythm: entry.rhythm,
      cached: value.cached,
      votes: entry.votes,
      myVote: entry.myVote,
      mineOnly: entry.mineOnly,
    });
  }

  /** 面板里点「开始检测 / 重新检测 / 测测我自己」：直接去这个人的回复页测（重新检测跳过缓存） */
  function startFromPanel(handle: string, force: boolean): void {
    const profile = profileFromPath(location.pathname);
    if (profile?.handle === handle) {
      if (profile.tab === 'replies') {
        void run(handle, force);
        return;
      }
      const replies = repliesTab(handle);
      if (replies) {
        pending = handle;
        pendingForce = force;
        showProgress(handle, 0, false);
        replies.click();
        return;
      }
    }
    // 不在这个人的回复页：新开标签，别把当前页面跳走（用户可能正在看评论或详情）。
    // 新标签带 fs_ai=<handle>，回复页加载后自动开始检测。
    openInNewTab(handle, force);
    closePanel();
  }

  const onPanelMessage = (message: unknown): Promise<unknown> | undefined => {
    const msg = message as { type?: string; handle?: unknown; force?: unknown } | null;
    if (msg?.type !== 'feedsieve:ai-start' || typeof msg.handle !== 'string') return undefined;
    const handle = msg.handle.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_]{1,15}$/.test(handle)) return Promise.resolve({ ok: false });
    startFromPanel(handle, msg.force === true);
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
    // 让标签 / 折叠按新数据重画
    document.querySelectorAll(`[${MARK_ATTR}]`).forEach((a) => a.removeAttribute(MARK_ATTR));
  };

  function tick(): void {
    if (stopped) return;
    decorateArticles();
    ensureTab();
    const profile = profileFromPath(location.pathname);
    // 换了页面就收起卡片；正在切到这个人的「回复」Tab 去测的不算
    if (panelHandle && panelPath !== location.pathname && !(pending && pending === panelHandle)) {
      pending = null;
      closePanel();
    }
    if (profile?.tab !== 'replies') return;
    // 新标签打开时带 fs_ai=<handle>：自动开始检测，然后把参数从地址栏清掉。
    const params = new URLSearchParams(location.search);
    const autoFromUrl = params.get('fs_ai')?.toLowerCase();
    if (autoFromUrl && autoFromUrl === profile.handle) {
      const force = params.get('force') === '1';
      params.delete('fs_ai');
      params.delete('force');
      const qs = params.toString();
      history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : ''));
      void run(profile.handle, force);
      return;
    }
    const auto = sessionStorage.getItem(AUTOSTART_KEY);
    const autoHandle = auto?.replace(/!$/, '');
    if (autoHandle === profile.handle || pending === profile.handle) {
      const force = auto?.endsWith('!') === true || (pending === profile.handle && pendingForce);
      sessionStorage.removeItem(AUTOSTART_KEY);
      pending = null;
      pendingForce = false;
      void run(profile.handle, force);
    }
  }

  return {
    ingest,
    start(): void {
      runtime?.onMessage.addListener(onPanelMessage);
      storage?.onChanged.addListener(onStorage);
      void storage?.local
        .get([AI_LIST_KEY, AI_RECORDS_KEY, AI_SETTINGS_KEY])
        .then((stored) => {
          applyList(stored[AI_LIST_KEY] as AiListState | undefined);
          records = (stored[AI_RECORDS_KEY] as Record<string, AiCheckRecord>) ?? {};
          settings = normalizeAiSettings(stored[AI_SETTINGS_KEY]);
        })
        .catch(() => undefined);
      // 社区 AI 号名单：后台按 30 分钟节流同步
      void deps.send({ type: AI_LIST_SYNC_MESSAGE }).catch(() => undefined);
      deps.setInterval(tick, 1_000);
      tick();
    },
    stop(): void {
      stopped = true;
      runtime?.onMessage.removeListener(onPanelMessage);
      storage?.onChanged.removeListener(onStorage);
      closePanel();
      document
        .querySelectorAll('[data-fs-action="ai"], .fs-ai-mark, .fs-ai-foldbar')
        .forEach((b) => b.remove());
      document.querySelectorAll(`[${TAB_ATTR}]`).forEach((n) => n.remove());
      document.querySelectorAll(`[${FOLD_ATTR}]`).forEach((n) => n.removeAttribute(FOLD_ATTR));
      document.querySelectorAll(`[${BUTTON_ATTR}], [${MARK_ATTR}]`).forEach((a) => {
        a.removeAttribute(BUTTON_ATTR);
        a.removeAttribute(MARK_ATTR);
      });
    },
  };
}
