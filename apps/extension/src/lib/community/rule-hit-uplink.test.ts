import { describe, expect, it, vi } from 'vitest';
import {
  createRuleHitQueue,
  createRuleHitUplink,
  RULE_HIT_INTERVAL_MS,
  RULE_HIT_MAX_PER_ROUND,
  toReportableHit,
  type RuleHitItem,
} from './rule-hit-uplink';

const NOW = Date.UTC(2026, 9, 31, 12);
const RULE = 'keyword:official:adult-gray-traffic-0123456789abcdef';

function memory(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  return {
    get: async (key: string) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: async (items: Record<string, unknown>) => {
      Object.assign(data, structuredClone(items));
    },
  };
}

function setup(overrides: { allowed?: () => boolean; response?: () => Response } = {}) {
  let now = NOW;
  const post = vi.fn<(body: { session_id: string; hits: RuleHitItem[] }) => Promise<Response>>(
    async () => overrides.response?.() ?? new Response('{}', { status: 200 }),
  );
  const uplink = createRuleHitUplink({
    isAllowed: async () => overrides.allowed?.() ?? true,
    post,
    storage: memory(),
    // 跳过「第一次延后 2 分钟」
    stateStorage: memory({ ruleHitUplinkStateV1: { nextUploadAt: 0 } }),
    now: () => now,
    randomId: () => 'session-0000000000000001',
  });
  return { uplink, post, advance: (ms: number) => (now += ms) };
}

const hit = (handle: string, ruleId = RULE) => ({ handle, rule_id: ruleId, source: 'heuristic' });

describe('toReportableHit', () => {
  it('keeps official rules and built-in heuristics only', () => {
    expect(toReportableHit({ handle: '@Spam_A', ruleId: RULE, source: 'heuristic' })).toEqual({
      handle: 'spam_a',
      rule_id: RULE,
      source: 'heuristic',
    });
    expect(
      toReportableHit({ handle: 'a', ruleId: 'weak-signal-combo', source: 'heuristic' }),
    ).not.toBeNull();
    // 个人自定义词、名单命中不报
    expect(
      toReportableHit({ handle: 'a', ruleId: 'keyword:custom:x1', source: 'heuristic' }),
    ).toBeNull();
    expect(toReportableHit({ handle: 'a', ruleId: 'list', source: 'community-list' })).toBeNull();
    expect(
      toReportableHit({
        handle: 'a',
        ruleId: 'contact-number-bait',
        source: 'heuristic',
        fingerprint: 'not-hex',
        postId: '123',
      }),
    ).toEqual({ handle: 'a', rule_id: 'contact-number-bait', source: 'heuristic', post_id: '123' });
  });
});

describe('createRuleHitQueue', () => {
  it('dedupes per page and sends in one batch', () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => undefined);
    const queue = createRuleHitQueue({ send });
    queue.push(toReportableHit({ handle: 'a', ruleId: RULE, source: 'heuristic' }));
    queue.push(toReportableHit({ handle: 'a', ruleId: RULE, source: 'heuristic' }));
    queue.push(toReportableHit({ handle: 'b', ruleId: RULE, source: 'heuristic' }));
    queue.push(null);
    vi.advanceTimersByTime(5_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown as [RuleHitItem[]])[0].map((h) => h.handle)).toEqual([
      'a',
      'b',
    ]);
    vi.useRealTimers();
  });
});

describe('createRuleHitUplink', () => {
  it('uploads hits once per account, rule and day', async () => {
    const { uplink, post, advance } = setup();
    await uplink.observe([hit('a'), hit('b'), hit('c', 'keyword:custom:x1')]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![0].hits.map((h) => h.handle)).toEqual(['a', 'b']);
    advance(RULE_HIT_INTERVAL_MS);
    await uplink.observe([hit('a'), hit('d')]);
    expect(post.mock.calls[1]![0].hits.map((h) => h.handle)).toEqual(['d']);
    // 第二天同一个账号同一条规则可以再报
    advance(24 * 3_600_000);
    await uplink.observe([hit('a')]);
    expect(post.mock.calls[2]![0].hits.map((h) => h.handle)).toEqual(['a']);
  });

  it('sends at most one round and keeps the rest for later', async () => {
    const { uplink, post } = setup();
    await uplink.observe(
      Array.from({ length: RULE_HIT_MAX_PER_ROUND + 30 }, (_, i) => hit(`u${i}`)),
    );
    const sent = post.mock.calls.flatMap(([body]) => body.hits);
    expect(sent).toHaveLength(RULE_HIT_MAX_PER_ROUND);
    expect(uplink.pendingCount()).toBe(30);
  });

  it('waits as long as the server says when rate limited', async () => {
    const { uplink, post, advance } = setup({
      response: () =>
        new Response(JSON.stringify({ retry_after_ms: 3 * 3_600_000 }), { status: 429 }),
    });
    await uplink.observe([hit('a')]);
    advance(2 * 3_600_000);
    await uplink.observe([hit('b')]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(uplink.pendingCount()).toBe(2);
  });

  it('stops collecting when the user turns it off', async () => {
    let allowed = true;
    const { uplink, post, advance } = setup({ allowed: () => allowed });
    await uplink.observe([hit('a')]);
    allowed = false;
    advance(RULE_HIT_INTERVAL_MS);
    await uplink.observe([hit('b')]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(uplink.pendingCount()).toBe(0);
  });
});
