import { flavorOf } from '@feedsieve/shared';
/**
 * AI 味检测重型运行时（懒加载块）：
 * 包含检测卡 UI、投票、证据翻页采集（ReplyCollector）、Canvas 报告图渲染（share-card）
 * 与「填入回复框」（reply-composer）。仅在用户点开报告 / 点击检测 / 打开带 fs_ai 的
 * 回复页时才由 lazy-ai-check.js 按需加载。
 */
import {
  contextFromPath,
  extractFeedItem,
  findTweetAvatarImg,
  profileFromPath,
  tweetSelectors,
} from '@feedsieve/x-adapter';
import { fillReplyComposer } from '../compose/reply-composer';
import { canvasToBlob, loadAvatar } from '../share/canvas-kit';
import {
  el,
  ensureAiCheckStyles,
  judged,
  PANEL_ID,
  SITE_BASE,
  TONE_COLOR,
  type AiCheckRunner,
  type AiCheckRunnerHost,
  type Judged,
  type Known,
} from './ai-check-shared';
import {
  AI_JUDGE_MESSAGE,
  AI_OUTCOME_MESSAGE,
  AI_VOTE_MESSAGE,
  type AiJudgeOutcome,
  type AiRhythm,
  type AiVoteOutcome,
} from './client';
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
import { drawShareCard, formatGap, spreadLabel } from './share-card';

const MAX_SCROLL_STEPS = 20;
const MAX_UPLOAD = MAX_REPLIES * 2;

const RUNNER_TEXT = {
  zh: {
    retest: '重新检测',
    expired: '结论已过期，可以重测',
    title: 'AI 味检测',
    collecting: (n: number) => `正在翻 TA 的回复 · 已读 ${n} 条`,
    narrow: (k: number) => `回复只集中在 ${k} 个人身上，至少要回给 ${MIN_AUTHORS} 个不同的人才好判`,
    sampleValue: (n: number, k: number | null) => (k ? `${n} 条 · ${k} 人` : `${n} 条`),
    judging: '模型正在品鉴…',
    samples: '样本',
    samplesWithin: (span: string) => `样本（${span}内）`,
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
    fillReply: '填入回复框',
    fillReplyTip: '打开这条帖子的回复框并放上报告图；发不发出仍由你点「回复」',
    filling: '正在填入…',
    filled: '已填入回复框，图片传完再点「回复」',
    fillFailed: {
      no_article: '这条帖子已不在页面上，滚回去再试',
      no_reply_button: '没找到回复按钮',
      no_editor: '回复框没打开',
      draft_not_empty: '回复框里已经有内容了，没动它',
      upload_timeout: '图片没传上去，先点「复制报告图」手动粘贴',
    },
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
    underReview: '社区争议中，投票还没分出结果',
    shareLink: '分享到 X',
    shareText: (name: string, pct: number, level: string) =>
      `测了一下 ${name} 的回复：AI 味 ${pct}%（${level}）`,
  },
  en: {
    retest: 'Check again',
    expired: 'This result has expired. You can check again',
    title: 'AI Flavor Check',
    collecting: (n: number) => `Reading replies · ${n} so far`,
    narrow: (k: number) => `Replies only go to ${k} people; need at least ${MIN_AUTHORS}`,
    sampleValue: (n: number, k: number | null) => (k ? `${n} · ${k} people` : String(n)),
    judging: 'The model is tasting…',
    samples: 'Replies',
    samplesWithin: (span: string) => `Replies (last ${span})`,
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
    fillReply: 'Fill reply box',
    fillReplyTip: 'Opens this post’s reply box with the image attached. You still press Reply',
    filling: 'Filling…',
    filled: 'Image attached. Press Reply when it finishes uploading',
    fillFailed: {
      no_article: 'This post scrolled away. Find it again and retry',
      no_reply_button: 'Reply button not found',
      no_editor: 'The reply box did not open',
      draft_not_empty: 'The reply box already has text. Left it untouched',
      upload_timeout: 'Upload failed. Use Copy image and paste it yourself',
    },
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
    underReview: 'Community vote is tied',
    shareLink: 'Share on X',
    shareText: (name: string, pct: number, level: string) =>
      `Checked ${name}'s replies: ${pct}% AI flavor (${level})`,
  },
} as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

function avatarOnPage(handle: string): string | null {
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href$="/photo"]')) {
    let pathname: string;
    try {
      pathname = new URL(a.getAttribute('href') ?? '', location.origin).pathname;
    } catch {
      continue;
    }
    if (pathname.toLowerCase() === `/${handle.toLowerCase()}/photo`) {
      const src = a.querySelector('img')?.src;
      if (src) return src;
    }
  }
  for (const article of document.querySelectorAll(tweetSelectors.article)) {
    const item = extractFeedItem(article, 'other');
    if (item?.author.handle.toLowerCase() !== handle.toLowerCase()) continue;
    const src = findTweetAvatarImg(article)?.src;
    if (src) return src;
  }
  return null;
}

function displayNameOn(handle: string): string | undefined {
  const lower = handle.toLowerCase();
  const profile = profileFromPath(location.pathname);
  if (profile?.handle === lower) {
    const name = document.querySelector('[data-testid="UserName"] span')?.textContent?.trim();
    if (name) return name;
  }
  for (const article of document.querySelectorAll(tweetSelectors.article)) {
    const item = extractFeedItem(article, 'other');
    if (item?.author.handle.toLowerCase() === lower && item.author.displayName) {
      return item.author.displayName;
    }
  }
  if (profile?.handle === lower) {
    const titleMatch = /^(?:\(\d+\)\s*)?(.+?)\s*\(@([a-z0-9_]{1,15})\)/i.exec(
      document.title.trim(),
    );
    if (titleMatch?.[2]?.toLowerCase() === lower && titleMatch[1]?.trim()) {
      return titleMatch[1].trim();
    }
  }
  return undefined;
}

function panel(): HTMLElement | null {
  return document.getElementById(PANEL_ID);
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

export function createAiCheckRunner(host: AiCheckRunnerHost): AiCheckRunner {
  let running: { handle: string; token: number } | null = null;
  let panelHandle: string | null = null;
  let panelPost: { handle: string; postId: string } | null = null;
  let panelPath: string | null = null;
  let token = 0;
  let stopRequested = false;
  let pending: string | null = null;
  let pendingForce = false;
  let activeCollector: ReplyCollector | null = null;
  const t = () => RUNNER_TEXT[host.getLanguage()];

  function showKnown(handle: string, k: Judged, postId?: string): void {
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
      comment: k.comment,
      postId,
    });
  }

  function closePanel(): void {
    token += 1;
    running = null;
    panelHandle = null;
    panelPost = null;
    panelPath = null;
    activeCollector = null;
    panel()?.remove();
  }

  function shell(handle: string): HTMLElement {
    ensureAiCheckStyles();
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
      const stopBtn = el('button', 'fs-ai-ghost fs-ai-stop', t().stop);
      stopBtn.type = 'button';
      stopBtn.addEventListener('click', () => {
        stopRequested = true;
        stopBtn.disabled = true;
      });
      body.appendChild(stopBtn);
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
    comment?: string | null;
    postId?: string;
  }): void {
    const lang = host.getLanguage();
    const text = t();
    const flavor = flavorOf(input.score, input.verdict, lang);
    const color = TONE_COLOR[flavor.tone];
    const cv = input.rhythm?.cv ?? 0;
    const body = shell(input.handle);
    const postId = input.postId ?? (panelPost?.handle === input.handle ? panelPost.postId : null);
    if (input.postId) panelPost = { handle: input.handle, postId: input.postId };

    const verdict = el('div', 'fs-ai-verdict');
    const pct = el('div', 'fs-ai-pct');
    pct.style.color = color;
    verdict.appendChild(pct);
    countUp(pct, flavor.percent);
    const level = el('span', 'fs-ai-level', flavor.level);
    level.style.background = color;
    verdict.appendChild(level);
    body.appendChild(verdict);

    const meter = el('div', 'fs-ai-meter');
    const dot = el('div', 'fs-ai-dot');
    dot.style.left = '0%';
    meter.appendChild(dot);
    body.appendChild(meter);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => (dot.style.left = `${flavor.percent}%`)),
    );

    if (input.comment) {
      body.appendChild(el('div', 'fs-ai-roast', `「${input.comment}」`));
    }

    const stats = el('div', 'fs-ai-stats');
    for (const [label, value] of [
      [
        input.spanS ? text.samplesWithin(formatGap(input.spanS, lang)) : text.samples,
        text.sampleValue(input.replyCount, input.authors ?? null),
      ],
      [text.gap, formatGap(input.medianGapS, lang)],
      [text.spread, input.rhythm ? spreadLabel(cv, lang) : '—'],
    ] as const) {
      const cell = el('div');
      cell.append(el('span', undefined, label), el('b', undefined, value));
      stats.appendChild(cell);
    }
    body.appendChild(stats);
    if (input.underReview) body.appendChild(el('div', 'fs-ai-note', text.underReview));
    else if (input.mineOnly) body.appendChild(el('div', 'fs-ai-note', text.mineOnly));
    else if (input.expired) body.appendChild(el('div', 'fs-ai-tally', text.expired));
    else if (input.cached) body.appendChild(el('div', 'fs-ai-tally', text.cached));

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
        const outcome = (await host
          .send({ type: AI_VOTE_MESSAGE, handle: input.handle, vote })
          .catch(() => null)) as AiVoteOutcome | null;
        voteButtons.forEach((b) => (b.disabled = false));
        if (!outcome?.ok) {
          toast(body, text.voteFailed);
          return;
        }
        voteButtons.forEach((b) => b.classList.toggle('fs-ai-voted', b === button));
        tally.textContent = tallyText(outcome.tally);
        const k = host.getKnown(input.handle);
        if (k) {
          k.votes = { ...outcome.tally };
          k.myVote = vote;
        }
      });
      voteButtons.push(button);
      votes.appendChild(button);
    }
    body.append(votes, tally);

    let avatar: Promise<ImageBitmap | null> | null = null;
    const card = async () =>
      drawShareCard({
        handle: input.handle,
        displayName: input.displayName,
        avatar: await (avatar ??= loadAvatar(avatarOnPage(input.handle))),
        authors: input.authors ?? null,
        spanS: input.spanS ?? null,
        flavor,
        comment: input.comment ?? null,
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
    const share = el('div', 'fs-ai-row fs-ai-share');
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
    const link = el('button', 'fs-ai-ghost', text.shareLink);
    link.type = 'button';
    link.addEventListener('click', () => {
      const name = input.displayName || input.handle;
      const url = `${SITE_BASE}/ai/${input.handle}`;
      const intent = new URL('https://x.com/intent/post');
      intent.searchParams.set('text', text.shareText(name, flavor.percent, flavor.level));
      intent.searchParams.set('url', url);
      window.open(intent.toString(), '_blank', 'noopener');
    });
    share.append(copy, dl, link);
    body.appendChild(share);

    if (postId) {
      const fill = el('button', 'fs-ai-primary', text.fillReply);
      fill.type = 'button';
      fill.title = text.fillReplyTip;
      fill.style.marginTop = '10px';
      fill.addEventListener('click', async () => {
        if (fill.disabled) return;
        fill.disabled = true;
        fill.textContent = text.filling;
        try {
          const blob = await canvasToBlob(await card());
          const outcome = await fillReplyComposer({
            postId,
            blob,
            filename: `ai-flavor-${input.handle}.png`,
          });
          toast(body, outcome.ok ? text.filled : text.fillFailed[outcome.reason]);
        } catch {
          toast(body, text.fillFailed.upload_timeout);
        } finally {
          fill.disabled = false;
          fill.textContent = text.fillReply;
        }
      });
      body.appendChild(fill);
    }
    if (input.expired) {
      const again = el('button', 'fs-ai-ghost', text.retest);
      again.type = 'button';
      again.style.marginTop = '10px';
      again.addEventListener('click', () => openFromTab(input.handle, true));
      body.appendChild(again);
    }
  }

  function report(outcome: 'insufficient' | 'narrow' | 'stopped' | 'no_data'): void {
    void host.send({ type: AI_OUTCOME_MESSAGE, outcome }).catch(() => undefined);
  }

  async function run(handle: string, force = false, postId?: string): Promise<void> {
    if (running?.handle === handle) return;
    const my = ++token;
    running = { handle, token: my };
    stopRequested = false;
    if (postId) panelPost = { handle, postId };
    const alive = () =>
      !host.isStopped() && token === my && profileFromPath(location.pathname)?.handle === handle;

    showProgress(handle, 0, false);
    const existing = await host.lookup(handle);
    if (!alive()) return;
    if (!force && judged(existing) && !existing.expired) {
      running = null;
      showKnown(handle, existing);
      return;
    }

    const collector = new ReplyCollector(handle);
    collector.limit = MAX_UPLOAD;
    activeCollector = collector;
    collector.observeApi(host.getApiTweets());
    let displayName: string | undefined;
    const observe = () => {
      const tweets = readPage();
      displayName ??= tweets.find((tw) => tw.handle.toLowerCase() === handle)?.displayName;
      const before = collector.size;
      collector.observe(tweets);
      return collector.size - before;
    };

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
      host
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
      sleep(1_200),
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
    const used = replies.slice(0, value.reply_count || MAX_REPLIES);
    const usedGaps = replyGaps(used);
    const rhythm: AiRhythm = {
      ...rhythmOf(used, usedGaps),
      median_gap: medianGap(usedGaps),
      authors: collector.authorCount(used.map((r) => r.id)),
      span: replySpan(used),
    };
    const prev = host.getKnown(handle);
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
      comment: value.comment ?? null,
    };
    host.setKnown(handle, entry);
    host.ensureTab();
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
      comment: value.comment ?? null,
    });
  }

  function openFromTab(handle: string, force = false): void {
    const k = host.getKnown(handle);
    if (!force && judged(k) && !k.expired) {
      showKnown(handle, k);
      return;
    }
    if (profileFromPath(location.pathname)?.tab === 'replies') {
      void run(handle, force);
      return;
    }
    pending = handle;
    pendingForce = force;
    showProgress(handle, 0, false);
    const replies = host.repliesTab(handle);
    if (replies) replies.click();
    else {
      pending = null;
      pendingForce = false;
      closePanel();
      host.openInNewTab(handle, force);
    }
  }

  function startFromPanel(handle: string, force: boolean): void {
    const profile = profileFromPath(location.pathname);
    if (profile?.handle === handle) {
      if (profile.tab === 'replies') {
        void run(handle, force);
        return;
      }
      const replies = host.repliesTab(handle);
      if (replies) {
        pending = handle;
        pendingForce = force;
        showProgress(handle, 0, false);
        replies.click();
        return;
      }
    }
    host.openInNewTab(handle, force);
    closePanel();
  }

  return {
    openFromTab,
    showKnown,
    startFromPanel,
    run,
    onApiTweets(tweets: readonly ApiTweet[]): void {
      activeCollector?.observeApi(tweets);
    },
    tick(profile): void {
      if (panelHandle && panelPath !== location.pathname && !(pending && pending === panelHandle)) {
        pending = null;
        closePanel();
      }
      if (profile?.tab === 'replies' && pending === profile.handle) {
        const force = pendingForce;
        pending = null;
        pendingForce = false;
        void run(profile.handle, force);
      }
    },
    hasPendingFor(handle: string): boolean {
      return pending === handle;
    },
    closePanel,
    stop(): void {
      pending = null;
      pendingForce = false;
      closePanel();
    },
  };
}
