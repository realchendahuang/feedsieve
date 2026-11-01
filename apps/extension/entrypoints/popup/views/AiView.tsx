/**
 * 「AI 味」视图：当前标签页这个账号的 AI 味结论、我测过的账号、评论区处理设置。
 *
 * 结论来自服务端（可公开的）或本机记录（自己测过、还没被第二个人印证的，只有本人能看到）。
 * 「开始检测 / 重新检测 / 测测我自己」让 X 页面去那个人的回复页开测（页面端见 ai-check.ts），
 * 测完这里自动刷新。查询不花 token；只有真的去测才会调判定。
 */
import { useCallback, useEffect, useState } from 'react';
import { profileFromPath } from '@feedsieve/x-adapter';
import type { UiLanguage } from '../../../src/lib/platform/i18n';
import { flavorOf, type AiVerdict } from '@feedsieve/shared';
import { formatGap, spreadLabel } from '../../../src/lib/ai-check/share-card';
import {
  AI_RECORDS_KEY,
  AI_SETTINGS_KEY,
  DEFAULT_AI_SETTINGS,
  getAiSettings,
  setAiSettings,
  type AiCheckRecord,
  type AiCheckSettings,
  type AiLookupOutcome,
  type AiRhythm,
  type AiVoteOutcome,
} from '../../../src/lib/ai-check/client';
import { getSelfHandle } from '../../../src/lib/community/following-allowlist';
import { AppIcon, HelpIcon, Toggle } from './shared';

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
    pendingOther: '有人测过，等第二个人复核',
    underReview: '复核中',
    start: '开始检测',
    retest: '重新检测',
    expired: '结论已过期',
    mineOnly: '只有你能看到 · 再有一人测到同样结果才公开',
    samples: '样本',
    sampleValue: (n: number, k: number) => `${n} 条 · ${k} 人`,
    spanLine: (span: string) => `最近 ${span}内的回复`,
    gap: '间隔',
    spread: '长短波动',
    voteAi: '是 AI',
    voteHuman: '是真人',
    tally: (ai: number, human: number) =>
      ai + human === 0 ? '还没人投票' : `${ai} 人认为是 AI · ${human} 人认为是真人`,
    listed: '已进社区 AI 号名单',
    started: '已在 X 页面开始检测',
    needXTab: '先在当前窗口打开 X',
    voteFailed: '投票没成功，稍后再试',
    history: '我测过的',
    historyEmpty: '还没测过账号',
    myVote: { ai: '我投：AI', human: '我投：真人' },
    checkSelf: '测测我自己',
    noSelf: '先在 X 上登录并打开任意页面',
    settings: '评论区',
    settingsHint:
      '已进社区 AI 号名单、或你测出 AI 味偏重的账号，在评论区和时间线上怎么显示。已关注和个人白名单里的账号默认不处理。',
    mode: '遇到 AI 号',
    modes: { off: '不处理', mark: '标记', fold: '折叠' },
    scope: '识别范围',
    scopeHint: '「仅蓝V」按页面上的认证标记判断，不影响黄推识别。',
    scopes: { all: '全部', blue: '仅蓝V', skipBlue: '跳过蓝V' },
    markFollowing: '标记已关注账号',
    markFollowingHint:
      '默认关：不把检测结论贴到你关注的人身上。打开后已关注账号也照常标记 / 折叠；个人白名单仍然不处理。',
  },
  en: {
    current: 'This account',
    currentHint:
      'Reads the account’s 6–10 most recent public replies and asks a model once whether they are AI-written. Your own result is visible only to you until someone else gets the same result; up to 20 new checks per day.',
    noAccount: 'Open an X profile or post',
    notChecked: 'Not checked yet',
    pendingOther: 'Checked once, waiting for a second check',
    underReview: 'Under review',
    start: 'Check',
    retest: 'Check again',
    expired: 'Result expired',
    mineOnly: 'Only you can see this until someone else gets the same result',
    samples: 'Replies',
    sampleValue: (n: number, k: number) => `${n} · ${k} people`,
    spanLine: (span: string) => `Replies from the last ${span}`,
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
    history: 'Checked',
    historyEmpty: 'No accounts checked yet',
    myVote: { ai: 'My vote: AI', human: 'My vote: human' },
    checkSelf: 'Check myself',
    noSelf: 'Sign in to X and open any page first',
    settings: 'Replies',
    settingsHint:
      'How accounts on the community AI list, or ones you found AI-heavy, show up in replies and timelines. Followed and allowlisted accounts are left alone by default.',
    mode: 'AI accounts',
    modes: { off: 'Ignore', mark: 'Mark', fold: 'Fold' },
    scope: 'Scope',
    scopeHint: '“Blue only” uses the verified badge on the page. Spam detection is unaffected.',
    scopes: { all: 'All', blue: 'Blue only', skipBlue: 'Skip blue' },
    markFollowing: 'Mark followed accounts',
    markFollowingHint:
      'Off by default: keeps results off people you follow. Turn it on to mark / fold followed accounts too; your allowlist is still left alone.',
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

export function AiView({
  language,
  notify,
  sendToXPage,
}: {
  language: UiLanguage;
  notify: (message: string | null) => void;
  sendToXPage: (message: { type: string; handle?: string; force?: boolean }) => Promise<unknown>;
}) {
  const c = COPY[language];
  const handle = useActiveAccount();
  // 查询结果按账号存：当前账号还没查回来就算加载中（不在 effect 里同步 setState）
  const [result, setResult] = useState<{ handle: string; value: AiLookupOutcome } | null>(null);
  const [records, setRecords] = useState<AiCheckRecord[]>([]);
  const [settings, setSettings] = useState<AiCheckSettings>(DEFAULT_AI_SETTINGS);
  const [voting, setVoting] = useState(false);

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
  useEffect(() => {
    void getAiSettings()
      .then(setSettings)
      .catch(() => undefined);
  }, []);
  // 页面上测完 / 投完票会写本机记录：这里跟着刷新
  useEffect(() => {
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
      if (area !== 'local') return;
      if (changes[AI_RECORDS_KEY]) {
        loadRecords();
        loadLookup(handle);
      }
      if (changes[AI_SETTINGS_KEY]) {
        void getAiSettings()
          .then(setSettings)
          .catch(() => undefined);
      }
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, [handle, loadLookup, loadRecords]);

  async function start(target: string | null, force = false): Promise<void> {
    if (!target) return;
    try {
      await sendToXPage({ type: 'feedsieve:ai-start', handle: target, force });
      notify(c.started);
    } catch {
      notify(c.needXTab);
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

  async function updateSettings(patch: Partial<AiCheckSettings>): Promise<void> {
    setSettings(await setAiSettings(patch));
  }

  const lookup: AiLookupOutcome | 'loading' | null = !handle
    ? null
    : result?.handle === handle
      ? result.value
      : 'loading';
  const shown = handle && lookup && lookup !== 'loading' ? shownFrom(handle, lookup) : null;
  const myVote = lookup && lookup !== 'loading' ? lookup.myVote : null;
  const remote = lookup && lookup !== 'loading' ? lookup.remote : null;

  return (
    <div className="view ai-view">
      <section className="block" aria-label={c.current}>
        <div className="block-head">
          <h2>{handle ? `@${handle}` : c.current}</h2>
          <HelpIcon text={c.currentHint} />
          <button
            type="button"
            className="text-button toolbar-end"
            onClick={() => void checkSelf()}
          >
            {c.checkSelf}
          </button>
        </div>
        {!handle ? (
          <div className="empty-state is-clean">
            <AppIcon name="detect" size={18} />
            <p>{c.noAccount}</p>
          </div>
        ) : lookup === 'loading' ? (
          <div className="loading-list" aria-hidden="true">
            <span />
            <span />
          </div>
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
            <span className="row-meta">
              {remote?.under_review
                ? c.underReview
                : remote?.pending
                  ? c.pendingOther
                  : c.notChecked}
            </span>
            <button type="button" className="primary-button" onClick={() => void start(handle)}>
              {c.start}
            </button>
          </div>
        )}
      </section>

      <section className="block" aria-label={c.history}>
        <div className="block-head">
          <h2>{c.history}</h2>
          {records.length ? <span className="count">{records.length}</span> : null}
        </div>
        {records.length === 0 ? (
          <div className="empty-state is-clean">
            <p>{c.historyEmpty}</p>
          </div>
        ) : (
          records.map((record) => {
            const flavor =
              record.score !== null && record.verdict !== 'insufficient'
                ? flavorOf(
                    record.score,
                    record.verdict,
                    record.rhythm ?? null,
                    language,
                    record.handle,
                  )
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
                {record.vote ? <span className="row-meta">{c.myVote[record.vote]}</span> : null}
                {flavor ? (
                  <span className="row-value ai-row-pct" style={{ color: TONE_COLOR[flavor.tone] }}>
                    {flavor.level} · {flavor.percent}%
                  </span>
                ) : (
                  <span className="row-value">—</span>
                )}
              </button>
            );
          })
        )}
      </section>

      <section className="block" aria-label={c.settings}>
        <div className="block-head">
          <h2>{c.settings}</h2>
          <HelpIcon text={c.settingsHint} />
        </div>
        <div className="row">
          <span className="row-label">
            <span>{c.mode}</span>
          </span>
          <div className="row-control segmented" role="radiogroup" aria-label={c.mode}>
            {(['off', 'mark', 'fold'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={settings.mode === mode}
                className={settings.mode === mode ? 'is-selected' : ''}
                onClick={() => void updateSettings({ mode })}
              >
                {c.modes[mode]}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <span className="row-label">
            <span>{c.scope}</span>
            <HelpIcon text={c.scopeHint} />
          </span>
          <div className="row-control segmented" role="radiogroup" aria-label={c.scope}>
            {(['all', 'blue', 'skipBlue'] as const).map((scope) => (
              <button
                key={scope}
                type="button"
                role="radio"
                aria-checked={settings.scope === scope}
                className={settings.scope === scope ? 'is-selected' : ''}
                onClick={() => void updateSettings({ scope })}
              >
                {c.scopes[scope]}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <span className="row-label">
            <span>{c.markFollowing}</span>
            <HelpIcon text={c.markFollowingHint} />
          </span>
          <Toggle
            checked={settings.markFollowing}
            label={c.markFollowing}
            onChange={(next) => void updateSettings({ markFollowing: next })}
          />
        </div>
      </section>
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
  const flavor = flavorOf(value.score, verdict, value.rhythm, language, value.handle);
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
      <p className="ai-roast">「{flavor.roast}」</p>
      <div className="ai-stats">
        <div>
          <span>{c.samples}</span>
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
      {value.rhythm?.span ? (
        <p className="row-meta ai-tally">{c.spanLine(formatGap(value.rhythm.span, language))}</p>
      ) : null}
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
