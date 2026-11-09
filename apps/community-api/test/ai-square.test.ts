/**
 * AI 号广场（/ai）的查询口径：可公示范围、kind、主页画像、样本排序与截断。
 * 契约见 docs/internal/21-AI号广场-接口契约.md §2–§3.2；
 * 「可公示」必须与 lookup.ts 同源，所以这里直接从库里种判定 / 票 / 画像 / 样本再查。
 */
import { getDb } from '../src/db/client';
import {
  aiAccountAudits,
  aiAccountSamples,
  aiAccountVerdicts,
  aiAccountVotes,
  profileAccounts,
} from '../src/db/schema';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { getAiSquareDetail, listAiSquare } from '../src/ai-accounts/square';

const NOW = Date.parse('2026-11-07T08:00:00Z');
const NOW_S = Math.floor(NOW / 1000);
const DAY = 86_400;

type Verdict = 'ai' | 'suspect' | 'human' | 'insufficient';

/** 种一条判定；默认「已被第二个安装印证 + 未过期」，即广场口径下可公示。 */
async function seedVerdict(
  handle: string,
  verdict: Verdict,
  extra: {
    score?: number | null;
    confirmed?: number;
    judgedAt?: number;
    expiresAt?: number;
    replyCount?: number;
    rhythm?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
    blueVerified?: number | null;
  } = {},
): Promise<void> {
  await getDb(env)
    .insert(aiAccountVerdicts)
    .values({
      handle,
      verdict,
      score: extra.score === undefined ? 0.9 : extra.score,
      confirmed: extra.confirmed ?? 1,
      replyCount: extra.replyCount ?? 20,
      rhythm: extra.rhythm ?? null,
      displayName: extra.displayName ?? null,
      avatarUrl: extra.avatarUrl ?? null,
      blueVerified: extra.blueVerified ?? null,
      questionVersion: 1,
      judgedAt: extra.judgedAt ?? NOW_S - DAY,
      expiresAt: extra.expiresAt ?? NOW_S + 7 * DAY,
    });
}

/** 直接种票（不走 voteAiAccount，避免每日限额干扰；票表读的是同一份聚合）。 */
async function seedVotes(handle: string, ai: number, human = 0): Promise<void> {
  const rows = [
    ...Array.from({ length: ai }, (_, i) => ({
      handle,
      installationId: `install-ai-${handle}-${i}`,
      vote: 'ai' as const,
    })),
    ...Array.from({ length: human }, (_, i) => ({
      handle,
      installationId: `install-human-${handle}-${i}`,
      vote: 'human' as const,
    })),
  ];
  if (!rows.length) return;
  await getDb(env)
    .insert(aiAccountVotes)
    .values(rows.map((row) => ({ ...row, createdAt: NOW_S, updatedAt: NOW_S })));
}

async function seedProfile(handle: string): Promise<void> {
  await getDb(env)
    .insert(profileAccounts)
    .values({
      handle,
      displayName: 'Bot 的昵称',
      avatarUrl: 'https://pbs.twimg.com/profile_images/1/bot.jpg',
      verified: 1,
      followers: 1234,
      followingCount: 56,
      tweets: 7890,
      // profile_accounts.joined_at 沿用毫秒
      joinedAt: Date.parse('2020-01-02T03:04:05Z'),
      updatedAt: NOW_S,
    });
}

/** 种一条维护者审计收录（AI 号广场的第三个来源）。 */
async function seedAudit(
  handle: string,
  extra: {
    category?: string;
    note?: string;
    evidencePostId?: string | null;
    active?: number;
    updatedAt?: number;
  } = {},
): Promise<void> {
  await getDb(env)
    .insert(aiAccountAudits)
    .values({
      handle,
      category: extra.category ?? 'ai_slop',
      note: extra.note ?? '维护者审计收录：模板化 AI 回复，逐条核对后收录。',
      evidencePostId: extra.evidencePostId ?? '2111625358101635562',
      active: extra.active ?? 1,
      createdAt: NOW_S - DAY,
      updatedAt: extra.updatedAt ?? NOW_S - DAY,
    });
}

/** 种一条回复样本（source 默认 judge，和扩展上报落库一致）。 */
async function seedSample(
  handle: string,
  tweetId: string,
  extra: {
    text?: string;
    parentText?: string | null;
    postedAt?: number | null;
    gapSeconds?: number | null;
    createdAt?: number;
  } = {},
): Promise<void> {
  await getDb(env)
    .insert(aiAccountSamples)
    .values({
      handle,
      tweetId,
      parentId: null,
      text: extra.text ?? `第 ${tweetId} 条回复`,
      parentText: extra.parentText ?? null,
      postedAt: extra.postedAt === undefined ? null : extra.postedAt,
      gapSeconds: extra.gapSeconds ?? null,
      source: 'judge',
      createdAt: extra.createdAt ?? NOW_S - DAY,
    });
}

beforeEach(async () => {
  const db = getDb(env);
  await Promise.all([
    db.delete(aiAccountAudits),
    db.delete(aiAccountSamples),
    db.delete(aiAccountVerdicts),
    db.delete(aiAccountVotes),
    db.delete(profileAccounts),
  ]);
});

describe('AI 号广场：可公示范围', () => {
  it('真人票 ≥3 的账号不进广场，详情也返回 null', async () => {
    await seedVerdict('humanvoted', 'ai');
    // AI 票 1、真人票 3：lookup 口径判为真人，广场不得展示
    await seedVotes('humanvoted', 1, 3);
    // 对照：普通可公示账号要能查出来
    await seedVerdict('stillbot', 'ai');

    const data = await listAiSquare(env, NOW);
    expect(data.entries.map((entry) => entry.handle)).toEqual(['stillbot']);
    expect(data.counts.all).toBe(1);
    expect(await getAiSquareDetail(env, 'humanvoted', NOW)).toBeNull();
  });

  it('AI 号 kind=ai，疑似号 kind=suspect，两者分开计数', async () => {
    await seedVerdict('aibot', 'ai', { score: 0.93 });
    await seedVerdict('suspectbot', 'suspect', { score: 0.51 });

    const data = await listAiSquare(env, NOW);
    const byHandle = new Map(data.entries.map((entry) => [entry.handle, entry]));
    expect(byHandle.get('aibot')).toMatchObject({ kind: 'ai', score: 0.93 });
    expect(byHandle.get('suspectbot')).toMatchObject({ kind: 'suspect', score: 0.51 });
    expect(data.counts).toEqual({ all: 2, ai: 1, suspect: 1, audit: 0, listed: 0 });
  });

  it('未确认、过期、判为真人的判定不算可公示', async () => {
    await seedVerdict('unconfirmed', 'ai', { confirmed: 0 });
    await seedVerdict('expired', 'ai', { expiresAt: NOW_S - 1 });
    await seedVerdict('humanverdict', 'human');

    const data = await listAiSquare(env, NOW);
    expect(data.entries).toEqual([]);
    expect(await getAiSquareDetail(env, 'expired', NOW)).toBeNull();
  });

  it('社区「是 AI」票 ≥3 但还没有判定的账号也进广场：kind=ai、score=null、listed=true', async () => {
    await seedVotes('votedonly', 3);

    const data = await listAiSquare(env, NOW);
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0]).toMatchObject({
      handle: 'votedonly',
      kind: 'ai',
      score: null,
      listed: true,
      judgedAt: null,
      votes: { ai_count: 3, human_count: 0 },
    });
  });

  it('列表按 listed → score 倒序排', async () => {
    // listed：票数进名单；另外两个只靠判定公示
    await seedVerdict('listedbot', 'ai', { score: 0.5 });
    await seedVotes('listedbot', 3);
    await seedVerdict('highbot', 'ai', { score: 0.95 });
    await seedVerdict('lowbot', 'ai', { score: 0.55 });

    const data = await listAiSquare(env, NOW);
    expect(data.entries.map((entry) => entry.handle)).toEqual(['listedbot', 'highbot', 'lowbot']);
  });

  it('详情忽略 @ 与大小写；不合法或没收录的 handle 返回 null', async () => {
    await seedVerdict('botcase', 'ai');

    expect(await getAiSquareDetail(env, '@BotCase', NOW)).toMatchObject({
      handle: 'botcase',
      kind: 'ai',
    });
    expect(await getAiSquareDetail(env, 'nobody', NOW)).toBeNull();
    expect(await getAiSquareDetail(env, 'bad!handle', NOW)).toBeNull();
  });
});

describe('AI 号广场：主页画像', () => {
  it('没采过主页时 profile 为 null（页面才能隐藏，而不是显示 0）', async () => {
    await seedVerdict('noprofile', 'ai');

    const entry = await getAiSquareDetail(env, 'noprofile', NOW);
    expect(entry).toMatchObject({ handle: 'noprofile', profile: null });
  });

  it('采过主页时返回公开数字，注册时间保持毫秒', async () => {
    await seedVerdict('withprofile', 'ai');
    await seedProfile('withprofile');

    const entry = await getAiSquareDetail(env, 'withprofile', NOW);
    expect(entry?.profile).toEqual({
      followers: 1234,
      following: 56,
      tweets: 7890,
      joinedAt: Date.parse('2020-01-02T03:04:05Z'),
      verified: true,
    });
  });
});

describe('AI 号广场：回复样本', () => {
  it('列表页每人最多 3 条，按发帖时间倒序', async () => {
    await seedVerdict('bot', 'ai');
    for (let i = 0; i < 5; i += 1) {
      await seedSample('bot', `t${i}`, { postedAt: NOW_S - i * 100 });
    }

    const data = await listAiSquare(env, NOW);
    expect(data.entries[0]?.samples.map((sample) => sample.tweetId)).toEqual(['t0', 't1', 't2']);
  });

  it('详情最多 12 条', async () => {
    await seedVerdict('bot', 'ai');
    for (let i = 0; i < 15; i += 1) {
      await seedSample('bot', `t${i}`, { postedAt: NOW_S - i * 100 });
    }

    const entry = await getAiSquareDetail(env, 'bot', NOW);
    expect(entry?.samples).toHaveLength(12);
    expect(entry?.samples[0]?.tweetId).toBe('t0');
    expect(entry?.samples[11]?.tweetId).toBe('t11');
  });

  it('没有 posted_at 的样本按 created_at 参与倒序', async () => {
    await seedVerdict('bot', 'ai');
    await seedSample('bot', 'older', { postedAt: NOW_S - 1000 });
    await seedSample('bot', 'newer-no-posted-at', {
      postedAt: null,
      createdAt: NOW_S - 10,
    });

    const entry = await getAiSquareDetail(env, 'bot', NOW);
    expect(entry?.samples.map((sample) => sample.tweetId)).toEqual(['newer-no-posted-at', 'older']);
  });

  it('正文按码点截断到 120，附原帖摘要、间隔与 X 链接', async () => {
    await seedVerdict('bot', 'ai');
    await seedSample('bot', 'tlong', {
      text: '很'.repeat(200),
      parentText: '原帖摘要',
      postedAt: NOW_S - 100,
      gapSeconds: 42,
    });
    await seedSample('bot', 'temoji', {
      text: '😀'.repeat(130),
      postedAt: NOW_S - 200,
    });

    const entry = await getAiSquareDetail(env, 'bot', NOW);
    const long = entry?.samples.find((sample) => sample.tweetId === 'tlong');
    const emoji = entry?.samples.find((sample) => sample.tweetId === 'temoji');
    expect(long).toMatchObject({
      text: '很'.repeat(120),
      parentText: '原帖摘要',
      postedAt: NOW_S - 100,
      gapSeconds: 42,
      url: 'https://x.com/bot/status/tlong',
    });
    expect([...(long?.text ?? '')]).toHaveLength(120);
    // 多字节字符按码点截，不出现半个字符
    expect([...(emoji?.text ?? '')]).toHaveLength(120);
    expect(emoji?.text).toBe('😀'.repeat(120));
  });

  it('不可公示账号的样本不会出现在广场', async () => {
    await seedVerdict('humanvoted', 'ai');
    await seedVotes('humanvoted', 0, 3);
    await seedSample('humanvoted', 't1', { postedAt: NOW_S - 100 });

    const data = await listAiSquare(env, NOW);
    expect(data.entries).toEqual([]);
  });
});

describe('AI 号广场：维护者审计收录', () => {
  it('没有模型判定/社区票的审计条目也能进广场，且单独计数', async () => {
    await seedAudit('auditedbot', {
      category: 'ai_slop',
      note: '2026-10 审计收录：同一分钟给 5 人回同句式俏皮话。',
      evidencePostId: '2111625358101635562',
    });

    const data = await listAiSquare(env, NOW);
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0]).toMatchObject({
      handle: 'auditedbot',
      kind: 'ai',
      origin: 'maintainer',
      score: null,
      listed: false,
      votes: { ai_count: 0, human_count: 0 },
      rhythm: null,
      samples: [],
      audit: {
        category: 'ai_slop',
        note: '2026-10 审计收录：同一分钟给 5 人回同句式俏皮话。',
        evidencePostIds: ['2111625358101635562'],
      },
    });
    // 审计条目不混进「AI 号」统计，单独一栏
    expect(data.counts).toEqual({ all: 1, ai: 0, suspect: 0, audit: 1, listed: 0 });
  });

  it('已有模型判定的账号只合并审计说明，不重复出条目也不覆盖分数', async () => {
    await seedVerdict('mergedbot', 'ai', { score: 0.88 });
    await seedAudit('mergedbot', { category: 'bot_spam', note: '审计说明：模板化回复。' });

    const data = await listAiSquare(env, NOW);
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0]).toMatchObject({
      handle: 'mergedbot',
      origin: 'model',
      score: 0.88,
      audit: { category: 'bot_spam', note: '审计说明：模板化回复。' },
    });
    expect(data.counts).toEqual({ all: 1, ai: 1, suspect: 0, audit: 1, listed: 0 });
  });

  it('社区已认定真人的账号即使有审计收录也不进广场', async () => {
    await seedVotes('humanbyvotes', 0, 3);
    await seedAudit('humanbyvotes');

    const data = await listAiSquare(env, NOW);
    expect(data.entries).toEqual([]);
    expect(await getAiSquareDetail(env, 'humanbyvotes', NOW)).toBeNull();
  });

  it('未过期的已确认 human 判定同样挡掉审计条目（过期后不挡）', async () => {
    await seedVerdict('humanverdict2', 'human');
    await seedAudit('humanverdict2');
    expect((await listAiSquare(env, NOW)).entries).toEqual([]);

    // 判定过期后不再算「已公开认定真人」，审计条目恢复展示
    await seedVerdict('humanverdict2', 'human', { expiresAt: NOW_S - 1 }).catch(() => undefined);
    await getDb(env)
      .update(aiAccountVerdicts)
      .set({ expiresAt: NOW_S - 1 });
    expect((await listAiSquare(env, NOW)).entries.map((entry) => entry.handle)).toEqual([
      'humanverdict2',
    ]);
  });

  it('审计条目的详情页可查，带审计说明与主页画像（没画像时 null）', async () => {
    await seedAudit('auditdetail', { category: 'adult_gray_traffic', note: '色情引流模板号。' });
    await seedProfile('auditdetail');

    const entry = await getAiSquareDetail(env, '@AuditDetail', NOW);
    expect(entry).toMatchObject({
      handle: 'auditdetail',
      origin: 'maintainer',
      audit: { category: 'adult_gray_traffic', note: '色情引流模板号。' },
      profile: { followers: 1234 },
    });
    expect(await getAiSquareDetail(env, 'nobody-audit', NOW)).toBeNull();
  });

  it('active=0 的审计条目不下发', async () => {
    await seedAudit('retiredaudit', { active: 0 });

    expect((await listAiSquare(env, NOW)).entries).toEqual([]);
    expect(await getAiSquareDetail(env, 'retiredaudit', NOW)).toBeNull();
  });
});
