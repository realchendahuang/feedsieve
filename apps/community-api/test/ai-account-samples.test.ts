/**
 * AI 号广场的回复样本（ai_account_samples）：判定落库 / 裁剪 / 清除。
 *
 * 覆盖契约 §3.1 的写入与清除规则：
 * - judge（扩展直传）与 check（TikHub）判出 ai / suspect 时落库，human 时整账号清除，insufficient 不动；
 * - 每条 handle 最多留 20 条；重复判定同一批回复不产生重复行；
 * - 正文 ≤200 码点、原帖 ≤80 码点，写库前去 NUL（PG 的 text 不接受 U+0000）。
 */
import { asc, count, eq } from 'drizzle-orm';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../src/db/client';
import { aiAccountSamples, aiAccountVerdicts, meta, trainingSampleUsage } from '../src/db/schema';
import {
  MAX_SAMPLES_PER_HANDLE,
  checkAiAccount,
  saveVerdictSamples,
  type AiSampleRow,
} from '../src/ai-accounts/check';
import { judgeAiAccount } from '../src/ai-accounts/judge';
import { type VendorTimeline } from '../src/ai-accounts/evidence';

const INSTALL = 'install-0001-abcdef';
const TWITTER_EPOCH = 1288834974657n;
const DAY_MS = 86_400_000;

/** 按时间造一个合法 snowflake ID（ms 是推文的创建毫秒时间）。 */
function tweetId(ms: number, seq = 0): string {
  return (((BigInt(ms) - TWITTER_EPOCH) << 22n) | BigInt(seq & 0x3fffff)).toString();
}

/** 证据直传格式的回复：n 条，每条回复一个不同的原帖，按时间升序生成。 */
function replies(
  startMs: number,
  n: number,
  options: { stepMs?: number; tag?: string; text?: (i: number) => string } = {},
) {
  const { stepMs = 5 * 60_000, tag = 'a', text } = options;
  return Array.from({ length: n }, (_, i) => ({
    id: tweetId(startMs + i * stepMs, i),
    parent: `原帖 ${tag}${i}：今天发布了一个新模型`,
    text: text?.(i) ?? `这波确实值得关注，第 ${tag}${i} 条回复先跑通再说。`,
  }));
}

/** TikHub 时间线：n 条自己的回复，每条回复一个不同的原帖，间隔 gapS 秒。 */
function timeline(
  handle: string,
  n: number,
  startMs: number,
  gapS = 30,
  tag = 'c',
): VendorTimeline {
  const items: VendorTimeline['timeline'] = [];
  for (let i = 0; i < n; i += 1) {
    const parentMs = startMs - (n - i) * 600_000;
    const replyMs = startMs + i * gapS * 1000;
    items.push({
      tweet_id: tweetId(parentMs, i),
      created_at: new Date(parentMs).toUTCString(),
      text: `原帖 ${tag}${i}：今天发布了一个新模型`,
      in_reply_to_status_id_str: null,
      author: { screen_name: `poster${i}` },
    });
    items.push({
      tweet_id: tweetId(replyMs, i),
      created_at: new Date(replyMs).toUTCString(),
      text: `@poster${i} 这个思路挺清楚，第${tag}${i}条还得实测几轮才知道稳不稳。`,
      in_reply_to_status_id_str: tweetId(parentMs, i),
      author: { screen_name: handle },
    });
  }
  return { timeline: items, user: { rest_id: '42', blue_verified: true, protected: false } };
}

/** 当前测试注入的 Workers AI 绑定；判定默认走 workers-ai provider，TikHub 仍走 fetch。 */
let activeAi: Ai | undefined;

function stubVendors(options: { data?: VendorTimeline; score?: number } = {}) {
  const calls = { tikhub: 0, jev: 0 };
  const binding = {
    run: async () => {
      calls.jev += 1;
      return {
        model: 'jev-1.14.0',
        answers: { ai_account: { type: 'noul', noul: options.score ?? 0.9 } },
        usage: { input_tokens: 2000 },
      };
    },
  };
  activeAi = binding as unknown as Ai;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request | string | URL) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.hostname === 'api.tikhub.io') {
        calls.tikhub += 1;
        const handle = url.searchParams.get('screen_name') ?? '';
        return new Response(
          JSON.stringify({
            data:
              options.data ??
              timeline(handle, 10, Date.parse('2026-10-30T06:00:00Z')),
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    }),
  );
  return calls;
}

const keyed = (extra: Partial<Cloudflare.Env> = {}) =>
  ({ ...env, TIKHUB_API_KEY: 'tk', AI: activeAi, ...extra }) as unknown as Cloudflare.Env;

/** 当前库里的样本，按发布时间从早到晚（时间算不出的排在最后）。 */
async function samplesOf(handle: string) {
  const rows = await getDb(env)
    .select()
    .from(aiAccountSamples)
    .where(eq(aiAccountSamples.handle, handle))
    .orderBy(asc(aiAccountSamples.postedAt), asc(aiAccountSamples.tweetId));
  return rows;
}

beforeEach(async () => {
  activeAi = undefined;
  const db = getDb(env);
  await Promise.all([
    db.delete(aiAccountSamples),
    db.delete(aiAccountVerdicts),
    db.delete(trainingSampleUsage),
    db.delete(meta),
  ]);
});
afterEach(() => vi.unstubAllGlobals());

describe('judge 路径落库样本（扩展直传）', () => {
  it('判 ai 时把参与判定的回复落库：截断、去 NUL、间隔按 snowflake 配对', async () => {
    stubVendors({ score: 0.9 });
    const now = Date.parse('2026-10-30T06:00:00Z');
    const long = '很长的回复正文'.repeat(40); // 280 码点，超过 200 的写库上限
    const payload = replies(now, 10, {
      tag: 'a',
      text: (i) =>
        i === 3
          ? long
          : i === 4
            ? '有\u0000效回复'
            : `第 a${i} 条回复：先跑通再说。`,
    });
    const result = await judgeAiAccount(
      keyed(),
      // 扩展上报的列表是「从新到旧」，落库要按时间重新排
      { installation_id: INSTALL, handle: '@Bot_Sample', replies: [...payload].reverse() },
      undefined,
      now,
    );
    expect(result.status).toBe(200);

    const rows = await samplesOf('bot_sample');
    expect(rows).toHaveLength(10);
    const nowS = Math.floor(now / 1000);
    // 第一条（时间最早）没有「上一条」，间隔从第二条开始
    expect(rows[0]).toMatchObject({
      handle: 'bot_sample',
      source: 'judge',
      createdAt: nowS,
      parentId: null,
      postedAt: nowS,
      gapSeconds: null,
    });
    expect(rows[1]).toMatchObject({ postedAt: nowS + 300, gapSeconds: 300 });
    expect(rows[9]).toMatchObject({ postedAt: nowS + 9 * 300, gapSeconds: 300 });
    // 正文按码点截到 200，且 U+0000 已被去掉（PG 的 text 不接受 NUL）
    const longRow = rows.find((row) => row.text.startsWith('很长的回复正文'))!;
    expect([...longRow.text]).toHaveLength(200);
    expect(rows.some((row) => row.text === '有效回复')).toBe(true);
    expect(rows.every((row) => !row.text.includes('\u0000'))).toBe(true);
    expect(rows.every((row) => row.parentText?.startsWith('原帖 '))).toBe(true);
  });

  it('判 suspect 同样落库；重复判定同一批回复不产生重复行', async () => {
    stubVendors({ score: 0.45 });
    const now = Date.parse('2026-10-30T06:00:00Z');
    const payload = replies(now, 10);
    const first = await judgeAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'suspect_one', replies: payload },
      undefined,
      now,
    );
    expect(first.body).toMatchObject({ verdict: 'suspect' });
    const created = await samplesOf('suspect_one');
    expect(created).toHaveLength(10);
    expect(created.every((row) => row.source === 'judge')).toBe(true);

    // 过了 7 天有效期后重判：回复是同一批，ON CONFLICT DO NOTHING 保留原来的 created_at
    const later = now + 8 * DAY_MS;
    await judgeAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'suspect_one', replies: payload },
      undefined,
      later,
    );
    const again = await samplesOf('suspect_one');
    expect(again).toHaveLength(10);
    expect(again.every((row) => row.createdAt === Math.floor(now / 1000))).toBe(true);
  });

  it('重判落到 human 时删除该 handle 全部样本', async () => {
    const now = Date.parse('2026-10-30T06:00:00Z');
    stubVendors({ score: 0.9 });
    await judgeAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'flip_flop', replies: replies(now, 10) },
      undefined,
      now,
    );
    expect(await samplesOf('flip_flop')).toHaveLength(10);

    vi.unstubAllGlobals();
    stubVendors({ score: 0.05 });
    const human = await judgeAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'flip_flop', replies: replies(now + 9 * DAY_MS, 10, { tag: 'b' }) },
      undefined,
      now + 9 * DAY_MS,
    );
    expect(human.body).toMatchObject({ verdict: 'human' });
    expect(await samplesOf('flip_flop')).toEqual([]);
  });

  it('证据不足（insufficient）不写、不删', async () => {
    stubVendors({ score: 0.9 });
    const now = Date.parse('2026-10-30T06:00:00Z');
    await judgeAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'kept', replies: replies(now, 10) },
      undefined,
      now,
    );
    const before = await samplesOf('kept');
    expect(before).toHaveLength(10);

    const insufficient = await judgeAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'kept', replies: replies(now, 4) },
      undefined,
      now + 8 * DAY_MS,
    );
    expect(insufficient).toEqual({ status: 400, body: { error: 'insufficient_replies' } });
    expect(await samplesOf('kept')).toHaveLength(10);
  });

  it(`每 handle 最多留 ${MAX_SAMPLES_PER_HANDLE} 条，裁剪最旧的一批`, async () => {
    stubVendors({ score: 0.9 });
    const t0 = Date.parse('2026-10-30T06:00:00Z');
    const day = DAY_MS;
    for (const [round, tag] of ['a', 'b', 'c'].entries()) {
      const at = t0 + round * 8 * day;
      await judgeAiAccount(
        keyed(),
        { installation_id: INSTALL, handle: 'chatty', replies: replies(at, 10, { tag }) },
        undefined,
        at,
      );
    }
    const rows = await samplesOf('chatty');
    expect(rows).toHaveLength(MAX_SAMPLES_PER_HANDLE);
    // 最早一轮（tag a）被裁掉，最近两轮都在
    const parents = rows.map((row) => row.parentText ?? '');
    expect(parents.some((text) => text.includes('原帖 a'))).toBe(false);
    expect(parents.filter((text) => text.includes('原帖 b'))).toHaveLength(10);
    expect(parents.filter((text) => text.includes('原帖 c'))).toHaveLength(10);
  });
});

describe('check 路径落库样本（TikHub）', () => {
  it('判 ai 时落库，原帖 ID 从 timeline 反查；重判 human 时清除', async () => {
    const t0 = Date.parse('2026-10-30T06:00:00Z');
    stubVendors({ data: timeline('tikbot', 10, t0), score: 0.9 });
    const first = await checkAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'tikbot' },
      undefined,
      t0,
    );
    expect(first.body).toMatchObject({ verdict: 'ai' });

    const rows = await samplesOf('tikbot');
    expect(rows).toHaveLength(10);
    expect(rows[0]).toMatchObject({
      source: 'judge',
      postedAt: Math.floor(t0 / 1000),
      gapSeconds: null, // 第一条没有「上一条」
    });
    expect(rows[1]).toMatchObject({ postedAt: Math.floor(t0 / 1000) + 30, gapSeconds: 30 });
    // 原帖 ID 只有 TikHub timeline 里有，按回复 ID 反查填进 parent_id
    expect(rows[0]!.parentId).toBe(tweetId(t0 - 10 * 600_000));
    // 正文里开头的 @ 与 t.co 链接不进样本
    expect(rows.every((row) => !row.text.startsWith('@'))).toBe(true);

    vi.unstubAllGlobals();
    const later = t0 + 9 * DAY_MS;
    stubVendors({ data: timeline('tikbot', 10, later), score: 0.05 });
    const human = await checkAiAccount(
      keyed(),
      { installation_id: INSTALL, handle: 'tikbot' },
      undefined,
      later,
    );
    expect(human.body).toMatchObject({ verdict: 'human' });
    expect(await samplesOf('tikbot')).toEqual([]);
  });
});

describe('saveVerdictSamples 兜底规则', () => {
  it('insufficient 不动已有样本；human 删除；ai 写入并去重', async () => {
    const db = getDb(env);
    const nowS = Math.floor(Date.now() / 1000);
    await db.insert(aiAccountSamples).values({
      handle: 'edge',
      tweetId: '10',
      text: '旧样本',
      postedAt: nowS,
      source: 'judge',
      createdAt: nowS,
    });
    const row = (tweetId: string): AiSampleRow => ({
      tweetId,
      parentId: null,
      text: '新样本',
      parentText: null,
      postedAt: nowS,
      gapSeconds: null,
    });

    await saveVerdictSamples(keyed(), 'edge', 'insufficient', [row('11')], nowS);
    expect(await samplesOf('edge')).toHaveLength(1);

    await saveVerdictSamples(keyed(), 'edge', 'ai', [row('11'), row('11'), row('12')], nowS);
    const rows = await samplesOf('edge');
    expect(rows.map((item) => item.tweetId)).toEqual(['10', '11', '12']);

    await saveVerdictSamples(keyed(), 'edge', 'human', [row('13')], nowS);
    expect(await getDb(env).select({ n: count() }).from(aiAccountSamples)).toEqual([{ n: 0 }]);
  });
});
