// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommunityEntry } from '@feedsieve/community-lists';

const mockRuntimeData = vi.hoisted(() => ({
  snapshot: null as Record<string, unknown> | null,
}));

vi.mock('../platform/runtime-data', () => ({
  loadRuntimeData: vi.fn(async () => mockRuntimeData.snapshot),
}));

import { createCommunityWorker } from './community-worker';
import { loadSlimCommunityRuntime } from './community-runtime-client';
import { requestOfficialPauseCheck, SNAPSHOT_KEY } from './community-settings';
import {
  COMMUNITY_LOOKUP_MESSAGE,
  COMMUNITY_RUNTIME_MESSAGE,
} from './community-protocol';

function makeEntry(overrides: Partial<CommunityEntry> = {}): CommunityEntry {
  return {
    handle: 'spam_one',
    x_user_id: '1001',
    category: 'copy_paste',
    sources: ['community'],
    community_score: 0.9,
    report_count: 5,
    rescue_count: 0,
    net_votes: 5,
    fingerprints: ['0123456789abcdef'],
    domains: ['evil.example'],
    campaign_entry_id: 'spam_lead',
    campaign_size: 4,
    first_seen_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-02T00:00:00.000Z',
    evidence_post_ids: ['1'],
    ...overrides,
  };
}

function makeSnapshotBody(version: string, entries: CommunityEntry[]) {
  return `${JSON.stringify({
    schema_version: 2,
    snapshot_version: version,
    generated_at: '2026-11-02T00:00:00.000Z',
    entries,
    verified: [
      {
        handle: 'legit_verified',
        x_user_id: null,
        rescue_count: 4,
        report_count: 0,
        net_votes: 4,
        first_seen_at: '2026-11-01T00:00:00.000Z',
        updated_at: '2026-11-02T00:00:00.000Z',
      },
    ],
    whitelist: [
      {
        handle: 'official_friend',
        x_user_id: null,
        name: null,
        avatar_url: null,
        note: 'whitelist note',
        added_at: '2026-11-01T00:00:00.000Z',
      },
    ],
    muted_rules: ['noisy-rule'],
    kill_switch: { destructive_actions_disabled: true, reason: '紧急制动' },
  })}\n`;
}

describe('community-worker & community-runtime-client（精简下发 + 命中按批补查）', () => {
  let storage: Record<string, unknown>;
  let listeners: Array<(changes: Record<string, unknown>, areaName: string) => void>;

  beforeEach(() => {
    storage = {};
    listeners = [];
    const leadEntry = makeEntry({ handle: 'spam_lead', campaign_entry_id: 'spam_lead', campaign_size: 4 });
    const memberEntry = makeEntry({
      handle: 'spam_two',
      x_user_id: '1002',
      fingerprints: ['fedcba9876543210'],
      domains: ['scam.example'],
      campaign_entry_id: 'spam_lead',
      campaign_size: 4,
    });
    mockRuntimeData.snapshot = {
      schema_version: 2,
      snapshot_version: '2026.11.01.1',
      generated_at: '2026-11-01T00:00:00.000Z',
      entries: [leadEntry],
    };
    storage[SNAPSHOT_KEY] = {
      snapshot_version: '2026.11.02.1',
      body: makeSnapshotBody('2026.11.02.1', [leadEntry, memberEntry]),
      synced_at: 2,
    };
    storage.communitySettings = { enabled: true, strength: 'standard', autoContribute: true };

    vi.stubGlobal('browser', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
          set: vi.fn(async (patch: Record<string, unknown>) => {
            Object.assign(storage, patch);
          }),
          remove: vi.fn(async (key: string) => {
            delete storage[key];
          }),
        },
        onChanged: {
          addListener: vi.fn((fn) => listeners.push(fn)),
          removeListener: vi.fn((fn) => {
            listeners = listeners.filter((item) => item !== fn);
          }),
        },
      },
      runtime: {
        sendMessage: vi.fn(async () => undefined),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('standard 档不下发指纹与域名，deep_clean 档下发，且与随包同版本时不重复传 builtinHandles', async () => {
    const worker = createCommunityWorker();
    worker.register();

    const standardRes = (await worker.handleMessage({
      type: COMMUNITY_RUNTIME_MESSAGE,
    })) as Awaited<ReturnType<typeof worker.getRuntimeResponse>>;
    expect(standardRes.community?.version).toBe('2026.11.02.1');
    expect(standardRes.community?.handles).toEqual(['spam_lead', 'spam_two']);
    expect(standardRes.community?.verified).toEqual(['legit_verified']);
    expect(standardRes.community?.whitelist).toEqual(['official_friend']);
    expect(standardRes.community?.mutedRules).toEqual(['noisy-rule']);
    expect(standardRes.community?.fingerprints).toEqual([]);
    expect(standardRes.community?.domains).toEqual([]);
    expect(standardRes.builtinHandles).toEqual(['spam_lead']);
    expect(standardRes.builtinSameAsCommunity).toBeUndefined();

    // 切换为 deep_clean 后返回指纹/域名，移除远端快照回退到随包版本后去重 builtinHandles
    storage.communitySettings = { enabled: true, strength: 'deep_clean', autoContribute: true };
    delete storage[SNAPSHOT_KEY];
    for (const listener of listeners) {
      listener({ [SNAPSHOT_KEY]: { oldValue: true, newValue: undefined } }, 'local');
    }

    const deepRes = (await worker.handleMessage({
      type: COMMUNITY_RUNTIME_MESSAGE,
    })) as Awaited<ReturnType<typeof worker.getRuntimeResponse>>;
    expect(deepRes.community?.version).toBe('2026.11.01.1');
    expect(deepRes.community?.fingerprints).toEqual(['0123456789abcdef']);
    expect(deepRes.community?.domains).toEqual(['evil.example']);
    expect(deepRes.builtinSameAsCommunity).toBe(true);
    expect(deepRes.builtinHandles).toEqual([]);

    worker.dispose();
  });

  it('runtime 客户端在命中时按微任务批量查 SW 并缓存结果，不重复请求已查条目', async () => {
    storage.communitySettings = { enabled: true, strength: 'deep_clean', autoContribute: true };
    const worker = createCommunityWorker();
    const sentMessages: Array<{ type: string; handles?: string[]; fingerprints?: string[] }> = [];
    const enrichedBatches: Array<ReadonlySet<string>> = [];

    const client = await loadSlimCommunityRuntime({
      send: async (msg) => {
        const typed = msg as { type: string; handles?: string[]; fingerprints?: string[] };
        sentMessages.push(typed);
        return worker.handleMessage(msg);
      },
      onEnriched: (handles) => enrichedBatches.push(handles),
    });

    expect(client.community?.handleSet.has('spam_two')).toBe(true);
    expect(client.community?.index.lookup('spam_two')).toBeNull();

    // 同一轮扫描触发多次：应合并为单次 COMMUNITY_LOOKUP_MESSAGE
    client.requestEnrichment({ handle: '@Spam_Two' });
    client.requestEnrichment({ handle: 'spam_two' });
    client.requestEnrichment({ handle: 'fp_match', fingerprint: 'fedcba9876543210' });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const lookupCalls = sentMessages.filter((m) => m.type === COMMUNITY_LOOKUP_MESSAGE);
    expect(lookupCalls).toHaveLength(1);
    expect(lookupCalls[0]).toMatchObject({
      type: COMMUNITY_LOOKUP_MESSAGE,
      handles: ['spam_two'],
      fingerprints: ['fedcba9876543210'],
    });
    expect(enrichedBatches).toHaveLength(1);
    expect([...enrichedBatches[0]!].sort()).toEqual(['fp_match', 'spam_two']);

    expect(client.community?.index.lookup('spam_two')?.category).toBe('copy_paste');
    expect(client.community?.campaignByFingerprint.get('fedcba9876543210')).toBe('spam_lead');
    expect(client.community?.campaignById.get('spam_lead')?.campaign_size).toBe(4);

    // 已解析过的结果不会再次发 IPC
    client.requestEnrichment({ handle: 'spam_two' });
    client.requestEnrichment({ handle: 'fp_match', fingerprint: 'fedcba9876543210' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sentMessages.filter((m) => m.type === COMMUNITY_LOOKUP_MESSAGE)).toHaveLength(1);

    client.dispose();
  });

  it('requestOfficialPauseCheck 在后台不可达时通过轻量读取快照 kill_switch 保守降级', async () => {
    vi.mocked(browser.runtime.sendMessage).mockRejectedValueOnce(new Error('SW asleep'));
    const pause = await requestOfficialPauseCheck();
    expect(pause).toEqual({ destructive_actions_disabled: true, reason: '紧急制动' });
  });
});
