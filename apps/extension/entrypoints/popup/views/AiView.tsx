/**
 * 「AI 味」视图：当前标签页这个账号的 AI 味结论、我测过的账号。
 * 评论区怎么显示这类账号属于设置，收在齿轮页里（见 settings/AiDisplaySettings）。
 *
 * 结论来自服务端（可公开的）或本机记录（自己测过、还没被第二个人印证的，只有本人能看到）。
 * 「开始检测 / 重新检测 / 测测我自己」让 X 页面去那个人的回复页开测（页面端见 ai-check.ts），
 * 测完这里自动刷新。查询不花 token；只有真的去测才会调判定。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { profileFromPath } from '@feedsieve/x-adapter';
import { UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';
import { flavorOf, type AiVerdict } from '@feedsieve/shared';
import { formatGap, spreadLabel } from '../../../src/lib/ai-check/share-card';
import {
  AI_RECORDS_KEY,
  type AiCheckRecord,
  type AiLookupOutcome,
  type AiRhythm,
  type AiVoteOutcome,
} from '../../../src/lib/ai-check/client';
import { getSelfHandle } from '../../../src/lib/community/following-allowlist';
import {
  getBlockedAccounts,
  subscribeBlocked,
  type BlockedAccount,
} from '../../../src/lib/community/blocked-accounts';
import {
  blockQueueProgress,
  getPersistentBlockQueue,
  subscribePersistentBlockQueue,
  type PersistentBlockQueueState,
} from '../../../src/lib/queue/block-queue-store';
import { DEFAULT_PRESET, SAFETY_PRESETS } from '../../../src/lib/queue/block-safety';
import {
  AppIcon,
  EmptyState,
  FAILURE_LABELS,
  HelpIcon,
  OfficialLinkIcon,
  SkeletonList,
} from './shared';
import { useListPosition } from './use-list-position';
import QueuePanel from './QueuePanel';

/**
 * 预览里没有头像（扩展不请求主页数据），用 handle 首字母做占位：
 * 跳过 `_`、`.`、emoji 这些非字母数字字符，中文名取第一个汉字，取不到用 `?`。
 */
function initialOf(handle: string): string {
  const match = handle.match(/[\p{L}\p{N}]/u);
  return match ? match[0].toUpperCase() : '?';
}

const TONE_COLOR = {
  ai: 'var(--tone-ai)',
  mixed: 'var(--tone-mixed)',
  human: 'var(--tone-human)',
} as const;

const COPY = {
  zh: {
    current: '当前账号',
    currentHint:
      '读这个账号最近 6–10 条公开回复，交给模型判一次是不是 AI 代写。一个人测出的结果只有本人能看到，再有一人测到同样结果才对所有人公开；每天最多新测 20 个账号。',
    noAccount: '打开一个 X 账号的主页或帖子',
    notChecked: '还没人测过',
    pendingOther: '有人测过，等第二个人确认',
    underReview: '社区争议中',
    communityHuman: (ai: number, human: number) => `社区结论：真人（AI ${ai} · 真人 ${human}）`,
    communityAi: (ai: number, human: number) => `社区认为这是 AI（AI ${ai} · 真人 ${human}）`,
    communityContested: (ai: number, human: number) => `社区争议中：AI ${ai} · 真人 ${human}`,
    start: '开始检测',
    retest: '重新检测',
    expired: '结论已过期',
    mineOnly: '只有你能看到 · 再有一人测到同样结果才公开',
    samples: '样本',
    samplesWithin: (span: string) => `样本（${span}内）`,
    sampleValue: (n: number, k: number) => `${n} 条 · ${k} 人`,
    gap: '间隔',
    spread: '长短波动',
    voteAi: '是 AI',
    voteHuman: '是真人',
    tally: (ai: number, human: number) =>
      ai + human === 0 ? '还没人投票' : `${ai} 人认为是 AI · ${human} 人认为是真人`,
    listed: '已进社区伪人名单',
    started: '已在 X 页面开始检测',
    needXTab: '先在当前窗口打开 X',
    voteFailed: '投票没成功，稍后再试',
    history: '我测过的',
    historyEmpty: '还没测过账号',
    myVote: { ai: '我投：AI', human: '我投：真人' },
    checkSelf: '测测我自己',
    noSelf: '先在 X 上登录并打开任意页面',
    aiListTitle: '社区伪人名单',
    aiListMeta: (total: number, eligible: number) => `已收录 ${total} 个 · 可屏蔽 ${eligible} 个`,
    aiListEmpty: '暂无可屏蔽账号',
    aiViewSite: '查看全部 AI 号',
    aiListHint:
      '只批量屏蔽已进社区公共名单的账号；疑似号不在范围内。拉黑由本机队列逐个执行，受每日额度限制，可随时暂停或取消。',
    aiBlockAll: '一键屏蔽',
    aiPreviewTitle: (n: number) => `将屏蔽 ${n} 个账号`,
    aiPreviewConfirm: (n: number) => `确认屏蔽 ${n} 个`,
    aiPreviewCancel: '取消',
    aiNoScore: '无模型分数',
    aiScoreLine: (p: number) => `AI 味 ${p}%`,
    aiMonthCount: (n: number) => `本月已屏蔽 ${n} 个 AI 号`,
    aiConfirmBlockAll: (count: number) => `再点一次：屏蔽 ${count} 个`,
    aiBlocked: (count: number) => `已加入拉黑队列（${count} 个）`,
  },
  en: {
    current: 'This account',
    currentHint:
      'Reads the account’s 6–10 most recent public replies and asks a model once whether they are AI-written. Your own result is visible only to you until someone else gets the same result; up to 20 new checks per day.',
    noAccount: 'Open an X profile or post',
    notChecked: 'Not checked yet',
    pendingOther: 'Checked once, waiting for a second check',
    underReview: 'Community is split',
    communityHuman: (ai: number, human: number) =>
      `Community verdict: human (AI ${ai} · human ${human})`,
    communityAi: (ai: number, human: number) => `Community verdict: AI (AI ${ai} · human ${human})`,
    communityContested: (ai: number, human: number) =>
      `Community is split: AI ${ai} · human ${human}`,
    start: 'Check',
    retest: 'Check again',
    expired: 'Result expired',
    mineOnly: 'Only you can see this until someone else gets the same result',
    samples: 'Replies',
    samplesWithin: (span: string) => `Replies (last ${span})`,
    sampleValue: (n: number, k: number) => `${n} · ${k} people`,
    gap: 'Gap',
    spread: 'Variety',
    voteAi: 'It’s AI',
    voteHuman: 'It’s human',
    tally: (ai: number, human: number) =>
      ai + human === 0 ? 'No votes yet' : `${ai} say AI · ${human} say human`,
    listed: 'On the community AI list',
    started: 'Check started on the X page',
    needXTab: 'Open X in this window first',
    voteFailed: 'Vote failed. Try later',
    history: 'My checks',
    historyEmpty: 'No accounts checked yet',
    myVote: { ai: 'My vote: AI', human: 'My vote: human' },
    checkSelf: 'Check myself',
    noSelf: 'Sign in to X and open any page first',
    aiListTitle: 'Community AI list',
    aiListMeta: (total: number, eligible: number) => `${total} listed · ${eligible} blockable`,
    aiListEmpty: 'Nothing to block',
    aiViewSite: 'View all AI accounts',
    aiListHint:
      'Only accounts already on the community public list are included; suspected accounts are left out. Blocks run one by one from this browser, count against the daily limit, and can be paused or cancelled anytime.',
    aiBlockAll: 'Block all',
    aiPreviewTitle: (n: number) => `Blocking ${n} accounts`,
    aiPreviewConfirm: (n: number) => `Confirm ${n}`,
    aiPreviewCancel: 'Cancel',
    aiNoScore: 'No model score',
    aiScoreLine: (p: number) => `AI ${p}%`,
    aiMonthCount: (n: number) => `Blocked ${n} AI accounts this month`,
    aiConfirmBlockAll: (count: number) => `Click again: block ${count}`,
    aiBlocked: (count: number) => `Added to block queue (${count})`,
  },
} as const;

/** 当前标签页的账号：主页、帖子详情都算（帖子取作者）。 */
export function accountFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/^(www\.)?x\.com$/.test(parsed.hostname)) return null;
  const profile = profileFromPath(parsed.pathname);
  if (profile) return profile.handle;
  const status = /^\/([A-Za-z0-9_]{1,15})\/status\/\d+/.exec(parsed.pathname);
  return status ? status[1]!.toLowerCase() : null;
}

function useActiveAccount(): string | null {
  const [handle, setHandle] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const query = (): void => {
      void browser.tabs
        .query({ active: true, currentWindow: true })
        .then((tabs) => {
          if (active) setHandle(accountFromUrl(tabs[0]?.url));
        })
        .catch(() => undefined);
    };
    const onUpdated = (_id: number, change: { url?: string }, tab: { active?: boolean }): void => {
      if (change.url && tab.active) query();
    };
    query();
    browser.tabs.onActivated?.addListener(query);
    browser.tabs.onUpdated?.addListener(onUpdated);
    return () => {
      active = false;
      browser.tabs.onActivated?.removeListener(query);
      browser.tabs.onUpdated?.removeListener(onUpdated);
    };
  }, []);
  return handle;
}

/** 面板里展示用的结论（服务端可公开的，或本机自己测的） */
interface ShownResult {
  handle: string;
  verdict: AiVerdict;
  score: number;
  replyCount: number;
  rhythm: AiRhythm | null;
  /** 判定模型给的一句话锐评；没有就用本地档位评语 */
  comment?: string | null;
  expired: boolean;
  mineOnly: boolean;
  votes: { ai_count: number; human_count: number; listed: boolean } | null;
}

function shownFrom(handle: string, outcome: AiLookupOutcome): ShownResult | null {
  const remote = outcome.remote;
  if (remote?.verdict && remote.score !== null && remote.verdict !== 'insufficient') {
    return {
      handle,
      verdict: remote.verdict,
      score: remote.score,
      replyCount: remote.reply_count,
      rhythm: remote.rhythm,
      comment: remote.comment ?? null,
      expired: remote.expired,
      mineOnly: false,
      votes: remote.votes,
    };
  }
  const mine = outcome.mine;
  if (mine && mine.score !== null && mine.verdict !== 'insufficient') {
    return {
      handle,
      verdict: mine.verdict,
      score: mine.score,
      replyCount: mine.replyCount ?? 0,
      rhythm: mine.rhythm ?? null,
      expired: mine.expiresAt ? mine.expiresAt * 1000 <= Date.now() : false,
      mineOnly: mine.confirmed !== true,
      votes: remote?.votes ?? null,
    };
  }
  return null;
}

async function openOnX(path: string): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const url = `https://x.com${path}`;
  if (tab?.id && /^https:\/\/(www\.)?x\.com\//.test(tab.url ?? '')) {
    await browser.tabs.update(tab.id, { url });
  } else {
    await browser.tabs.create({ url });
  }
}

/** 社区伪人名单队列收尾后的失败项：如实展示失败码，不留无声的死循环。 */
function AiFailedList({
  items,
  language,
}: {
  items: Array<{ handle: string; code?: string }>;
  language: UiLanguage;
}) {
  const t = UI_COPY[language];
  if (items.length === 0) return null;
  return (
    <ul className="failed-list" role="status">
      {items.map((item) => (
        <li key={item.handle}>
          <span>@{item.handle}</span>
          <span>{FAILURE_LABELS[language][item.code ?? ''] ?? item.code ?? t.unknown}</span>
        </li>
      ))}
    </ul>
  );
}

export function AiView({
  language,
  notify,
  sendToXPage,
  onOpenSettings,
  aiEligible,
  aiListCount,
}: {
  language: UiLanguage;
  notify: (message: string | null) => void;
  sendToXPage: (message: {
    type: string;
    handle?: string;
    force?: boolean;
    items?: Array<{ handle: string; xUserId?: string; category: string }>;
  }) => Promise<unknown>;
  onOpenSettings: () => void;
  /** 社区伪人名单里已进公共名单（listed=1）、且不在白名单 / 关注 / 已拉黑里的账号（App 计算） */
  aiEligible: Array<{ handle: string; score: number | null }>;
  /** 社区伪人名单总条目数（行内「已收录 N 个」） */
  aiListCount: number;
}) {
  const c = COPY[language];
  const t = UI_COPY[language];
  const handle = useActiveAccount();
  // 查询结果按账号存：当前账号还没查回来就算加载中（不在 effect 里同步 setState）
  const [result, setResult] = useState<{ handle: string; value: AiLookupOutcome } | null>(null);
  const [records, setRecords] = useState<AiCheckRecord[]>([]);
  /** 「我测过的」默认折叠：历史多的时候不能把一键屏蔽顶出弹窗 */
  const [historyOpen, setHistoryOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [voting, setVoting] = useState(false);
  // 检测是在 X 页面上跑的异步任务：按钮在飞行中禁用，避免连点排一队重复检测
  const [checking, setChecking] = useState(false);
  // 批量屏蔽队列（全局单例）：只认 source === 'ai-batch' 的那支
  const [queue, setQueue] = useState<PersistentBlockQueueState | null>(null);
  // 入队请求在飞：按钮禁用，避免连点排出第二支队列
  const [blocking, setBlocking] = useState(false);
  // 一键屏蔽前先看要屏蔽谁：展开预览，确认后才真正入队
  const [previewOpen, setPreviewOpen] = useState(false);
  /** 本月通过「伪人名单」拉黑的 AI 号数量（只读本机记账，origin === 'ai-batch'） */
  const [blockedThisMonth, setBlockedThisMonth] = useState(0);

  useEffect(() => {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    const count = (accounts: BlockedAccount[]): number =>
      accounts.filter((account) => account.origin === 'ai-batch' && account.blockedAt >= monthStart)
        .length;
    void getBlockedAccounts().then((accounts) => setBlockedThisMonth(count(accounts)));
    // 队列执行期间每成功一个都会写本机记账，这里跟着涨
    return subscribeBlocked((accounts) => setBlockedThisMonth(count(accounts)));
  }, []);

  // 切走再回来：回到上次看的位置
  useListPosition({
    storageKey: 'aiPositionV1',
    pageKey: 'ai',
    rootRef,
    ready: records.length > 0,
  });

  const loadRecords = useCallback(() => {
    void browser.runtime
      .sendMessage({ type: 'feedsieve:ai-checks' })
      .then((list) => setRecords(Array.isArray(list) ? (list as AiCheckRecord[]) : []))
      .catch(() => undefined);
  }, []);

  const loadLookup = useCallback((target: string | null) => {
    if (!target) return;
    void browser.runtime
      .sendMessage({ type: 'feedsieve:ai-lookup', handle: target })
      .then((value) =>
        setResult({
          handle: target,
          value: (value as AiLookupOutcome | null) ?? { remote: null, myVote: null, mine: null },
        }),
      )
      .catch(() =>
        setResult({ handle: target, value: { remote: null, myVote: null, mine: null } }),
      );
  }, []);

  useEffect(() => loadLookup(handle), [handle, loadLookup]);
  useEffect(loadRecords, [loadRecords]);
  // 页面上测完 / 投完票会写本机记录：这里跟着刷新
  useEffect(() => {
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
      if (area !== 'local') return;
      if (changes[AI_RECORDS_KEY]) {
        loadRecords();
        loadLookup(handle);
      }
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, [handle, loadLookup, loadRecords]);
  // 社区伪人名单的队列进度：名单同步由 App（数据层）负责，这里只订阅队列状态
  useEffect(() => {
    void getPersistentBlockQueue()
      .then(setQueue)
      .catch(() => undefined);
    return subscribePersistentBlockQueue(setQueue);
  }, []);

  async function start(target: string | null, force = false): Promise<void> {
    if (!target || checking) return;
    setChecking(true);
    try {
      await sendToXPage({ type: 'feedsieve:ai-start', handle: target, force });
      notify(c.started);
    } catch {
      notify(c.needXTab);
    } finally {
      setChecking(false);
    }
  }

  async function checkSelf(): Promise<void> {
    const self = await getSelfHandle().catch(() => null);
    if (!self) {
      notify(c.noSelf);
      return;
    }
    await start(self);
  }

  async function vote(choice: 'ai' | 'human'): Promise<void> {
    if (!handle) return;
    setVoting(true);
    const outcome = (await browser.runtime
      .sendMessage({ type: 'feedsieve:ai-vote', handle, vote: choice })
      .catch(() => null)) as AiVoteOutcome | null;
    setVoting(false);
    if (!outcome?.ok) {
      notify(c.voteFailed);
      return;
    }
    setResult((prev) =>
      prev
        ? {
            handle: prev.handle,
            value: {
              ...prev.value,
              myVote: choice,
              remote: prev.value.remote
                ? {
                    ...prev.value.remote,
                    votes: {
                      ai_count: outcome.tally.ai_count,
                      human_count: outcome.tally.human_count,
                      listed: outcome.tally.listed,
                    },
                  }
                : prev.value.remote,
            },
          }
        : prev,
    );
  }

  async function controlQueue(action: 'resume' | 'pause' | 'cancel'): Promise<void> {
    try {
      await sendToXPage({ type: `feedsieve:block-queue-${action}` });
    } catch {
      notify(c.needXTab);
    }
  }

  /**
   * 一键屏蔽：把已进社区公共名单、且不在白名单 / 关注 / 已拉黑里的 AI 号入队，
   * 由 X 页面上的队列逐个执行原生拉黑；进度和失败项就在本区块里跟进。
   */
  /** 预览里点「确认屏蔽」：收起面板后才入队，入队失败会 notify 提示 */
  async function confirmAiBlock(): Promise<void> {
    setPreviewOpen(false);
    await startAiBlock();
  }

  async function startAiBlock(): Promise<void> {
    if (aiEligible.length === 0 || blocking) return;
    setBlocking(true);
    notify(null);
    try {
      const result = (await sendToXPage({
        type: 'feedsieve:ai-block-start',
        items: aiEligible.map((entry) => ({ handle: entry.handle, category: 'ai_slop' })),
      })) as { status?: string; count?: number } | undefined;
      if (result?.status !== 'started') throw new Error('ai_queue_not_started');
      setQueue(await getPersistentBlockQueue());
      notify(c.aiBlocked(result.count ?? aiEligible.length));
    } catch {
      notify(c.needXTab);
    } finally {
      setBlocking(false);
    }
  }

  const lookup: AiLookupOutcome | 'loading' | null = !handle
    ? null
    : result?.handle === handle
      ? result.value
      : 'loading';
  const shown = handle && lookup && lookup !== 'loading' ? shownFrom(handle, lookup) : null;
  const myVote = lookup && lookup !== 'loading' ? lookup.myVote : null;
  const remote = lookup && lookup !== 'loading' ? lookup.remote : null;

  // 社区伪人名单行：未同步过（总数为 0）先显示省略号，同步由 App 触发
  const aiMeta = aiListCount === 0 ? '…' : c.aiListMeta(aiListCount, aiEligible.length);
  const queueSummary = blockQueueProgress(queue);
  const queueDone = queueSummary.success + queueSummary.failed;
  const queueActive = Boolean(
    queue && queueSummary.total > 0 && (queue.status === 'running' || queue.status === 'paused'),
  );
  // 队列收尾后的失败项留在这里，原因如实展示，避免无声的死循环
  const aiFailedTasks =
    queue && queue.source === 'ai-batch' && !queueActive
      ? queue.tasks
          .filter((task) => task.status === 'failed')
          .map((task) => ({ handle: task.handle, code: task.failureCode }))
      : [];
  const queueStatusLabel = queue
    ? {
        running: t.queueRunning,
        paused: t.queuePaused,
        completed: t.queueCompleted,
        cancelled: t.queueCancelled,
      }[queue.status]
    : '';
  // 只有额度用尽 / 短窗限流两种暂停需要解释
  const queuePauseNote =
    queue?.status === 'paused' && queue.pauseReason === 'quota_exhausted'
      ? t.queuePausedQuota(SAFETY_PRESETS[DEFAULT_PRESET].dailyLimit)
      : queue?.status === 'paused' && queue.pauseReason === 'rate_limit_storm'
        ? t.queuePausedRateLimit
        : null;

  return (
    <div className="view ai-view" ref={rootRef}>
      <section className="block" aria-label={c.current}>
        <div className="block-head">
          <h2>{handle ? `@${handle}` : c.current}</h2>
          <HelpIcon text={c.currentHint} />
          <button
            type="button"
            className="text-button toolbar-end"
            disabled={checking}
            onClick={() => void checkSelf()}
          >
            {c.checkSelf}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={UI_COPY[language].aiSettings}
            title={UI_COPY[language].aiSettings}
            onClick={onOpenSettings}
          >
            <AppIcon name="settings" size={15} />
          </button>
        </div>
        {!handle ? (
          <EmptyState icon="detect" className="is-clean">
            {c.noAccount}
          </EmptyState>
        ) : lookup === 'loading' ? (
          <SkeletonList />
        ) : remote?.contested || (remote?.under_review && !remote?.contested) ? (
          <CommunityResult
            language={language}
            votes={remote.votes}
            myVote={myVote}
            voting={voting}
            onVote={(choice) => void vote(choice)}
            kind="contested"
          />
        ) : remote?.public && remote.verdict === 'human' ? (
          <CommunityResult
            language={language}
            votes={remote.votes}
            myVote={myVote}
            voting={voting}
            onVote={(choice) => void vote(choice)}
            kind="human"
          />
        ) : remote?.public && remote.score === null ? (
          <CommunityResult
            language={language}
            votes={remote.votes}
            myVote={myVote}
            voting={voting}
            onVote={(choice) => void vote(choice)}
            kind="ai"
          />
        ) : shown ? (
          <AiResult
            language={language}
            value={shown}
            myVote={myVote}
            voting={voting}
            onVote={(choice) => void vote(choice)}
            onRetest={() => void start(handle, true)}
          />
        ) : (
          <div className="ai-empty">
            <span className="row-meta">{remote?.pending ? c.pendingOther : c.notChecked}</span>
            <button
              type="button"
              className="primary-button"
              disabled={checking}
              onClick={() => void start(handle)}
            >
              {c.start}
            </button>
          </div>
        )}
      </section>

      <section className="block" aria-label={c.aiListTitle}>
        <div className="row community-row">
          <div className="row-label">
            <strong>{c.aiListTitle}</strong>
            <span className="row-meta">{aiMeta}</span>
          </div>
          <HelpIcon text={c.aiListHint} />
          <OfficialLinkIcon target="ai" label={c.aiViewSite} />
          <button
            type="button"
            className="secondary-button"
            disabled={blocking || queueActive || aiEligible.length === 0}
            onClick={() => {
              notify(null);
              setPreviewOpen(true);
            }}
          >
            {aiEligible.length === 0 ? c.aiListEmpty : c.aiBlockAll}
          </button>
        </div>
        {previewOpen ? (
          <div className="ai-preview" aria-label={c.aiPreviewTitle(aiEligible.length)}>
            <p className="ai-preview-title">{c.aiPreviewTitle(aiEligible.length)}</p>
            <ul className="ai-preview-list">
              {aiEligible.map((entry) => (
                <li key={entry.handle} className="ai-preview-row">
                  <span className="ai-preview-avatar" aria-hidden="true">
                    {initialOf(entry.handle)}
                  </span>
                  <span className="ai-preview-handle">@{entry.handle}</span>
                  <span className="ai-preview-score">
                    {entry.score == null
                      ? c.aiNoScore
                      : c.aiScoreLine(Math.round((entry.score * 100) / 5) * 5)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="ai-preview-actions">
              <button
                type="button"
                className="primary-button"
                disabled={blocking}
                onClick={() => void confirmAiBlock()}
              >
                {c.aiPreviewConfirm(aiEligible.length)}
              </button>
              <button type="button" className="text-button" onClick={() => setPreviewOpen(false)}>
                {c.aiPreviewCancel}
              </button>
            </div>
          </div>
        ) : null}
        {queueActive && queue && queue.source === 'ai-batch' ? (
          <QueuePanel
            language={language}
            queue={queue}
            done={queueDone}
            total={queueSummary.total}
            statusLabel={queueStatusLabel}
            pauseNote={queuePauseNote}
            onControl={(action) => void controlQueue(action)}
          />
        ) : null}
        {blockedThisMonth > 0 ? (
          <p className="ai-month-count">{c.aiMonthCount(blockedThisMonth)}</p>
        ) : null}
        {aiFailedTasks.length > 0 ? (
          <>
            <p className="result">
              {t.queueProgress(queueDone, queueSummary.total)} · {queueStatusLabel}
            </p>
            <AiFailedList items={aiFailedTasks} language={language} />
          </>
        ) : null}
      </section>
      <section className="block" aria-label={c.history}>
        {records.length === 0 ? (
          <>
            <div className="block-head">
              <h2>{c.history}</h2>
            </div>
            <EmptyState className="is-clean">{c.historyEmpty}</EmptyState>
          </>
        ) : (
          <>
            <button
              type="button"
              className="block-head block-head-toggle"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((value) => !value)}
            >
              <h2>{c.history}</h2>
              <span className="count">{records.length}</span>
              <AppIcon name="chevron" size={14} className="chevron-toggle" />
            </button>
            {historyOpen
              ? records.map((record) => {
                  const flavor =
                    record.score !== null && record.verdict !== 'insufficient'
                      ? flavorOf(record.score, record.verdict, language)
                      : null;
                  return (
                    <button
                      key={record.handle}
                      type="button"
                      className="row ai-row"
                      onClick={() => void openOnX(`/${record.handle}`)}
                    >
                      <span className="row-label">
                        <span>@{record.handle}</span>
                      </span>
                      {record.vote ? (
                        <span className="row-meta">{c.myVote[record.vote]}</span>
                      ) : null}
                      {flavor ? (
                        <span
                          className="row-value ai-row-pct"
                          style={{ color: TONE_COLOR[flavor.tone] }}
                        >
                          {flavor.level} · {flavor.percent}%
                        </span>
                      ) : (
                        <span className="row-value">—</span>
                      )}
                    </button>
                  );
                })
              : null}
          </>
        )}
      </section>
    </div>
  );
}

function CommunityResult({
  language,
  votes,
  myVote,
  voting,
  onVote,
  kind,
}: {
  language: UiLanguage;
  votes: { ai_count: number; human_count: number; listed: boolean };
  myVote: 'ai' | 'human' | null;
  voting: boolean;
  onVote: (choice: 'ai' | 'human') => void;
  kind: 'ai' | 'human' | 'contested';
}) {
  const c = COPY[language];
  const color =
    kind === 'human' ? TONE_COLOR.human : kind === 'ai' ? TONE_COLOR.ai : TONE_COLOR.mixed;
  return (
    <div className="ai-empty">
      <span className="row-meta" style={{ color }}>
        {kind === 'human'
          ? c.communityHuman(votes.ai_count, votes.human_count)
          : kind === 'ai'
            ? c.communityAi(votes.ai_count, votes.human_count)
            : c.communityContested(votes.ai_count, votes.human_count)}
      </span>
      <div className="button-row ai-votes">
        {(['ai', 'human'] as const).map((choice) => (
          <button
            key={choice}
            type="button"
            className={`secondary-button${myVote === choice ? ' is-selected' : ''}`}
            disabled={voting}
            aria-pressed={myVote === choice}
            onClick={() => onVote(choice)}
          >
            {choice === 'ai' ? c.voteAi : c.voteHuman}
          </button>
        ))}
      </div>
      <p className="row-meta ai-tally">{c.tally(votes.ai_count, votes.human_count)}</p>
    </div>
  );
}

function AiResult({
  language,
  value,
  myVote,
  voting,
  onVote,
  onRetest,
}: {
  language: UiLanguage;
  value: ShownResult;
  myVote: 'ai' | 'human' | null;
  voting: boolean;
  onVote: (choice: 'ai' | 'human') => void;
  onRetest: () => void;
}) {
  const c = COPY[language];
  const verdict = value.verdict as 'ai' | 'suspect' | 'human';
  const flavor = flavorOf(value.score, verdict, language);
  const color = TONE_COLOR[flavor.tone];
  const votes = value.votes ?? { ai_count: 0, human_count: 0, listed: false };
  return (
    <div className="ai-result">
      <div className="ai-hero">
        <span className="ai-pct" style={{ color }}>
          {flavor.percent}
          <small>%</small>
        </span>
        <span className="ai-level" style={{ background: color }}>
          {flavor.level}
        </span>
      </div>
      <div className="ai-meter">
        <span style={{ left: `${flavor.percent}%` }} />
      </div>
      {value.comment ? <p className="ai-roast">「{value.comment}」</p> : null}
      <div className="ai-stats">
        <div>
          <span>
            {value.rhythm?.span
              ? c.samplesWithin(formatGap(value.rhythm.span, language))
              : c.samples}
          </span>
          <b>
            {value.rhythm?.authors
              ? c.sampleValue(value.replyCount, value.rhythm.authors)
              : value.replyCount}
          </b>
        </div>
        <div>
          <span>{c.gap}</span>
          <b>{formatGap(value.rhythm?.median_gap ?? null, language)}</b>
        </div>
        <div>
          <span>{c.spread}</span>
          <b>{value.rhythm ? spreadLabel(value.rhythm.cv, language) : '—'}</b>
        </div>
      </div>
      {value.mineOnly ? <p className="ai-note">{c.mineOnly}</p> : null}
      <div className="button-row ai-votes">
        {(['ai', 'human'] as const).map((choice) => (
          <button
            key={choice}
            type="button"
            className={`secondary-button${myVote === choice ? ' is-selected' : ''}`}
            disabled={voting}
            aria-pressed={myVote === choice}
            onClick={() => onVote(choice)}
          >
            {choice === 'ai' ? c.voteAi : c.voteHuman}
          </button>
        ))}
      </div>
      <p className="row-meta ai-tally">
        {c.tally(votes.ai_count, votes.human_count)}
        {votes.listed ? ` · ${c.listed}` : ''}
      </p>
      {value.expired ? (
        <div className="ai-empty">
          <span className="row-meta">{c.expired}</span>
          <button type="button" className="secondary-button" onClick={onRetest}>
            {c.retest}
          </button>
        </div>
      ) : null}
    </div>
  );
}
