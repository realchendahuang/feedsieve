import { env } from 'cloudflare:workers';
import { count, eq, like } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { applySnapshotDelta, sha256Hex } from '@feedsieve/community-lists';
import worker from '../src/index';
import { getDb } from '../src/db/client';
import {
  accountHealth,
  accounts,
  installations,
  meta,
  rescues,
  ruleHits,
  trainingSampleUsage,
} from '../src/db/schema';
import {
  autoMuteNoisyRules,
  cleanupRuleHits,
  ingestRuleHits,
  isCorroborated,
  loadHitSignals,
  loadRuleFeedback,
  readRuleMutes,
  RULE_HIT_POLICY,
  setRuleMute,
  shouldAutoMute,
} from '../src/rule-hits';
import { listingReason } from '../src/lib/listing';
import { generateSnapshot, getSnapshotFile, SNAPSHOT_PACK } from '../src/snapshot';

const ORIGIN = 'https://api.example.com';
const RULE = 'keyword:official:adult-gray-traffic-0123456789abcdef';

function session(n: number): string {
  return `0000000000000000-${String(n).padStart(4, '0')}`;
}

function hit(handle: string, overrides: Record<string, unknown> = {}) {
  return {
    handle,
    rule_id: RULE,
    source: 'heuristic',
    category: 'adult_gray_traffic',
    fingerprint: 'aaaaaaaaaaaaaaaa',
    post_id: '1850000000000000001',
    ...overrides,
  };
}

/** 每个会话来自不同的 /24 网段。 */
async function hitsFrom(sessions: number[], items: Array<Record<string, unknown>>) {
  for (const n of sessions) {
    const result = await ingestRuleHits(
      env,
      { session_id: session(n), hits: items },
      `198.51.${n}.9`,
    );
    expect(result.status).toBe(200);
  }
}

async function report(installationId: string, handle: string) {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/v1/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        reports: [{ handle, reason: 'other' }],
      }),
    }),
    env,
  );
  expect(res.status).toBe(200);
}

function install(n: number): string {
  return `rrrrrrrr-${String(4000 + n)}-4000-8000-rrrrrrrrrrrr`;
}

async function snapshotBody(): Promise<{
  entries: Array<{ handle: string; category: string; listed_by?: string }>;
  muted_rules?: string[];
}> {
  const published = await generateSnapshot(env, 0, { bypassDailyOnce: true });
  return JSON.parse((await getSnapshotFile(env, published.version, SNAPSHOT_PACK))!);
}

beforeEach(async () => {
  const db = getDb(env);
  await Promise.all([
    db.delete(ruleHits),
    db.delete(rescues),
    db.delete(meta).where(like(meta.key, 'rule_mute%')),
    db.delete(trainingSampleUsage).where(like(trainingSampleUsage.identity, 'hit-%')),
  ]);
});

describe('POST /v1/rule-hits', () => {
  it('records official rule hits once per session, account, rule and day', async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}/v1/rule-hits`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.5' },
        body: JSON.stringify({
          session_id: session(1),
          hits: [
            hit('spam_one'),
            hit('spam_one'),
            hit('spam_two', { rule_id: 'weak-signal-combo', category: 'bogus' }),
            hit('spam_three', { rule_id: 'keyword:custom:my-word' }), // 个人自定义词不收
            hit('Bad Handle'),
          ],
        }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accepted: 3,
      rejected: 2,
      next_upload_ms: RULE_HIT_POLICY.uploadIntervalMs,
    });
    // 同一会话当天再报一次：不加行
    await ingestRuleHits(env, { session_id: session(1), hits: [hit('spam_one')] }, '203.0.113.5');
    const rows = await getDb(env)
      .select({ handle: ruleHits.handle, category: ruleHits.category, net: ruleHits.net })
      .from(ruleHits)
      .orderBy(ruleHits.handle);
    expect(rows.map((row) => row.handle)).toEqual(['spam_one', 'spam_two']);
    expect(rows[1]!.category).toBeNull();
    expect(rows[0]!.net).toMatch(/^[0-9a-f]{16}$/);
  });

  it('rejects malformed requests and rate limits a session', async () => {
    expect((await ingestRuleHits(env, { hits: [hit('a')] }, undefined)).status).toBe(400);
    expect(
      (await ingestRuleHits(env, { session_id: session(2), hits: [] }, undefined)).status,
    ).toBe(400);
    expect(
      (await ingestRuleHits(env, { session_id: session(2), hits: [hit('a_user')] }, undefined))
        .status,
    ).toBe(200);
    await getDb(env)
      .update(trainingSampleUsage)
      .set({ count: RULE_HIT_POLICY.sessionDaily })
      .where(like(trainingSampleUsage.identity, 'hit-session:%'));
    const limited = await ingestRuleHits(
      env,
      { session_id: session(2), hits: [hit('b_user')] },
      undefined,
    );
    expect(limited).toMatchObject({ status: 429, body: { error: 'rate_limited' } });
  });

  it('cleans up hits older than 30 days', async () => {
    await hitsFrom([1], [hit('old_user')]);
    await cleanupRuleHits(env, Date.now() + 31 * 86_400_000);
    const [row] = await getDb(env).select({ n: count() }).from(ruleHits);
    expect(row?.n).toBe(0);
  });
});

describe('rule feedback', () => {
  /** 误标只算注册满 7 天的安装 */
  async function rescue(handle: string, installation: string, ruleId = RULE, ageDays = 30) {
    const now = Math.floor(Date.now() / 1000);
    await getDb(env)
      .insert(installations)
      .values({ id: installation, firstSeenAt: now - ageDays * 86_400, lastSeenAt: now })
      .onConflictDoNothing();
    await getDb(env)
      .insert(rescues)
      .values({
        handle,
        installationId: installation,
        createdAt: Math.floor(Date.now() / 1000),
        detectionSource: 'heuristic',
        ruleId,
      });
  }

  it('measures how often a rule is marked as a false positive and mutes noisy rules', async () => {
    const handles = Array.from(
      { length: RULE_HIT_POLICY.muteMinHitAccounts },
      (_, i) => `acct_${i}`,
    );
    await hitsFrom(
      [1],
      handles.map((handle) => hit(handle)),
    );
    // 一半以上被不同安装点了误标
    for (let i = 0; i < 16; i += 1) await rescue(handles[i]!, `install-${i}`);
    // 另一条规则命中多、误标少
    await hitsFrom(
      [2],
      handles.map((handle) => hit(handle, { rule_id: 'contact-number-bait' })),
    );
    await rescue('acct_0', 'install-x', 'contact-number-bait');

    const feedback = await loadRuleFeedback(env);
    const noisy = feedback.find((item) => item.rule_id === RULE)!;
    expect(noisy).toMatchObject({ hit_accounts: 30, rescue_accounts: 16, rescue_installs: 16 });
    expect(noisy.fp_rate).toBeCloseTo(16 / 30, 3);
    expect(feedback.find((item) => item.rule_id === 'contact-number-bait')?.fp_rate).toBeCloseTo(
      1 / 30,
      3,
    );

    // 第一次满足先记下，连续满足 6 小时才静音
    expect(await autoMuteNoisyRules(env)).toEqual([]);
    expect(
      await autoMuteNoisyRules(env, Date.now() + RULE_HIT_POLICY.muteHoldHours * 3_600_000),
    ).toEqual([RULE]);
    expect((await readRuleMutes(env))[RULE]).toMatchObject({ state: 'muted', by: 'auto' });
    // 静音的规则随快照下发
    expect((await snapshotBody()).muted_rules).toEqual([RULE]);

    // 维护者恢复后不再自动静音
    expect(await setRuleMute(env, RULE, false)).toBe(true);
    expect(await autoMuteNoisyRules(env)).toEqual([]);
    expect(
      await autoMuteNoisyRules(env, Date.now() + 2 * RULE_HIT_POLICY.muteHoldHours * 3_600_000),
    ).toEqual([]);
    expect((await snapshotBody()).muted_rules).toBeUndefined();
  });

  it('ignores false-positive votes from installs registered less than a week ago', async () => {
    const handles = Array.from(
      { length: RULE_HIT_POLICY.muteMinHitAccounts },
      (_, i) => `acct_${i}`,
    );
    await hitsFrom(
      [1],
      handles.map((handle) => hit(handle)),
    );
    // 注册不满 7 天的安装刷误标：不算
    for (let i = 0; i < 16; i += 1) await rescue(handles[i]!, `fresh-${i}`, RULE, 1);
    const noisy = (await loadRuleFeedback(env)).find((item) => item.rule_id === RULE)!;
    expect(noisy).toMatchObject({ hit_accounts: 30, rescue_accounts: 0, rescue_installs: 0 });
    expect(shouldAutoMute(noisy)).toBe(false);
  });

  it('counts false positives that rule_hits can no longer link to, and mutes at the threshold', async () => {
    const handles = Array.from(
      { length: RULE_HIT_POLICY.muteMinHitAccounts },
      (_, i) => `acct_${i}`,
    );
    await hitsFrom(
      [1],
      handles.map((handle) => hit(handle)),
    );
    // 上报节流后 rule_hits 里查不到这些账号的命中记录，但误标票本身就是对这条规则的直接反馈。
    // 误标安装数在 14 天窗口内可能远多于能关联上命中的账号，所以不能再要求反查 rule_hits。
    const ghosts = Array.from({ length: 40 }, (_, i) => `ghost_${i}`);
    const vote = async (from: number, to: number) => {
      for (let i = from; i < to; i += 1) await rescue(ghosts[i]!, `rescue-${i}`);
    };

    await vote(0, 10); // 安装数够，但 fp_rate = 10/30 < muteFpRate：不静音
    let noisy = (await loadRuleFeedback(env)).find((item) => item.rule_id === RULE)!;
    expect(noisy).toMatchObject({ hit_accounts: 30, rescue_accounts: 10, rescue_installs: 10 });
    expect(noisy.fp_rate).toBeCloseTo(10 / 30, 3);
    expect(shouldAutoMute(noisy)).toBe(false);
    expect(await autoMuteNoisyRules(env)).toEqual([]);

    await vote(10, 16); // 16/30 ≥ muteFpRate：命中静音阈值
    noisy = (await loadRuleFeedback(env)).find((item) => item.rule_id === RULE)!;
    expect(noisy.fp_rate).toBeCloseTo(16 / 30, 3);
    expect(shouldAutoMute(noisy)).toBe(true);
    // 第一次满足先记下，连续满足 6 小时才静音
    expect(await autoMuteNoisyRules(env)).toEqual([]);
    expect(
      await autoMuteNoisyRules(env, Date.now() + RULE_HIT_POLICY.muteHoldHours * 3_600_000),
    ).toEqual([RULE]);
    expect((await readRuleMutes(env))[RULE]).toMatchObject({ state: 'muted', by: 'auto' });

    // 误标账号数超过命中账号数（命中上报不全）：fp_rate 封顶 1
    await vote(16, 40);
    noisy = (await loadRuleFeedback(env)).find((item) => item.rule_id === RULE)!;
    expect(noisy).toMatchObject({ rescue_accounts: 40, state: 'muted' });
    expect(noisy.fp_rate).toBe(1);
  });

  it('does not mute on thin evidence', async () => {
    await hitsFrom([1], [hit('only_one')]);
    await rescue('only_one', 'install-1');
    expect(await autoMuteNoisyRules(env)).toEqual([]);
  });

  it('serves the feedback table to maintainers only', async () => {
    const response = await worker.fetch(new Request(`${ORIGIN}/api/admin/rule-feedback`), env);
    expect(response.status).not.toBe(200);
  });
});

describe('corroborated listing', () => {
  it('lists an account with two votes once rule hits come from three networks', async () => {
    await report(install(1), 'corro_user');
    await report(install(2), 'corro_user');
    expect((await snapshotBody()).entries.map((entry) => entry.handle)).not.toContain('corro_user');

    await hitsFrom([1, 2], [hit('corro_user')]);
    expect((await snapshotBody()).entries.map((entry) => entry.handle)).not.toContain('corro_user');

    await hitsFrom([3], [hit('corro_user')]);
    const entry = (await snapshotBody()).entries.find((item) => item.handle === 'corro_user');
    // 人工票全是「其他」：分类取规则命中的分类
    expect(entry).toMatchObject({ listed_by: 'corroborated', category: 'adult_gray_traffic' });
  });

  it('counts networks within one day, so one machine over several days is still one network', async () => {
    const db = getDb(env);
    const today = new Date();
    const days = [0, 1, 2].map((n) =>
      new Date(today.getTime() - n * 86_400_000).toISOString().slice(0, 10),
    );
    await db.insert(ruleHits).values(
      days.map((day, n) => ({
        handle: 'one_machine',
        ruleId: RULE,
        day,
        reporter: `reporter-${n}`,
        // 网段哈希每天换：同一台机器三天是三个不同的值
        net: `net-of-day-${n}`,
        source: 'heuristic',
        createdAt: Math.floor(Date.now() / 1000),
      })),
    );
    expect((await loadHitSignals(env)).get('one_machine')).toBeUndefined();
  });

  it('never lists on rule hits alone, and a false-positive vote blocks corroboration', async () => {
    await hitsFrom([1, 2, 3, 4, 5], [hit('hits_only')]);
    await report(install(10), 'hits_only');
    const signals = await loadHitSignals(env);
    expect(signals.get('hits_only')?.nets).toBe(5);
    expect(isCorroborated({ report_count: 1, rescue_count: 0 }, signals.get('hits_only'))).toBe(
      false,
    );
    expect(isCorroborated({ report_count: 3, rescue_count: 1 }, signals.get('hits_only'))).toBe(
      false,
    );
  });

  it('ignores hits from muted rules and counts same-template campaigns', async () => {
    await hitsFrom([1, 2, 3], [hit('muted_user')]);
    await setRuleMute(env, RULE, true);
    expect(
      (await loadHitSignals(env, Date.now(), new Set([RULE]))).get('muted_user'),
    ).toBeUndefined();

    // 三个账号同一正文指纹、来自三个网段：同模板批量号
    await hitsFrom(
      [4],
      [hit('camp_a', { rule_id: 'weak-signal-combo', fingerprint: 'bbbbbbbbbbbbbbbb' })],
    );
    await hitsFrom(
      [5],
      [hit('camp_b', { rule_id: 'weak-signal-combo', fingerprint: 'bbbbbbbbbbbbbbbb' })],
    );
    await hitsFrom(
      [6],
      [hit('camp_c', { rule_id: 'weak-signal-combo', fingerprint: 'bbbbbbbbbbbbbbbb' })],
    );
    const signals = await loadHitSignals(env, Date.now(), new Set([RULE]));
    expect(signals.get('camp_a')?.campaign).toBe(true);
    expect(isCorroborated({ report_count: 2, rescue_count: 0 }, signals.get('camp_a'))).toBe(true);
  });
});

describe('listing policy v4', () => {
  const base = {
    report_count: 3,
    rescue_count: 0,
    status_v2: 'new',
    distinct_days: 1,
    dead: false,
  };

  it('needs independence on top of three net votes', () => {
    expect(listingReason(base, undefined)).toBeNull();
    expect(listingReason({ ...base, distinct_days: 2 }, undefined)).toBe('consensus');
    expect(listingReason({ ...base, status_v2: 'strong' }, undefined)).toBe('consensus');
    expect(listingReason({ ...base, report_count: 5 }, undefined)).toBe('consensus');
    expect(listingReason({ ...base, distinct_days: 3, dead: true }, undefined)).toBeNull();
  });

  it('drops accounts confirmed dead from the published list', async () => {
    for (const n of [21, 22, 23, 24, 25]) await report(install(n), 'dead_user');
    expect((await snapshotBody()).entries.map((entry) => entry.handle)).toContain('dead_user');
    const [before] = await getDb(env)
      .select({ listed: accounts.listed })
      .from(accounts)
      .where(eq(accounts.handle, 'dead_user'));
    expect(before?.listed).toBe(1);
    await getDb(env)
      .insert(accountHealth)
      .values({ handle: 'dead_user', state: 'dead', source: 'cron-prober', updatedAt: 1 });
    expect((await snapshotBody()).entries.map((entry) => entry.handle)).not.toContain('dead_user');
    const [row] = await getDb(env)
      .select({ n: accounts.reportCount })
      .from(accounts)
      .where(eq(accounts.handle, 'dead_user'));
    // 票还在：只是不下发
    expect(row?.n).toBe(5);
    // 公开名单口径写回 accounts.listed：后台、热榜、主页洞察都按它判断
    const [flag] = await getDb(env)
      .select({ listed: accounts.listed })
      .from(accounts)
      .where(eq(accounts.handle, 'dead_user'));
    expect(flag?.listed).toBe(0);
  });
});

describe('GET /v1/snapshots/delta/:from/:to', () => {
  it('serves a delta that rebuilds the newer signed file exactly', async () => {
    for (const n of [31, 32, 33, 34, 35]) await report(install(n), 'delta_one');
    const first = await generateSnapshot(env, 0, { bypassDailyOnce: true });
    for (const n of [41, 42, 43, 44, 45]) await report(install(n), 'delta_two');
    const second = await generateSnapshot(env, 0, { bypassDailyOnce: true });
    expect(second.version).not.toBe(first.version);

    const response = await worker.fetch(
      new Request(`${ORIGIN}/v1/snapshots/delta/${first.version}/${second.version}`),
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('immutable');
    const delta = (await response.json()) as { entries: { upsert: Array<{ handle: string }> } };
    expect(delta.entries.upsert.map((entry) => entry.handle)).toContain('delta_two');
    const base = (await getSnapshotFile(env, first.version, SNAPSHOT_PACK))!;
    const rebuilt = applySnapshotDelta(base, delta)!;
    expect(await sha256Hex(rebuilt)).toBe(second.files[SNAPSHOT_PACK]!.sha256);

    const missing = await worker.fetch(
      new Request(`${ORIGIN}/v1/snapshots/delta/2000.01.01.1/${second.version}`),
      env,
    );
    expect(missing.status).toBe(404);
  });
});
