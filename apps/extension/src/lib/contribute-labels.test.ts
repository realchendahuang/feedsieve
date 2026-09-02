// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syncLocalLabels } from './contribute';

let storage: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;

function resultResponse(items: Array<{ handle: string; status: string }>): Response {
  return new Response(JSON.stringify({ results: items }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  storage = {
    communitySettings: { enabled: true, strength: 'standard', autoContribute: true },
  };
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(storage, patch)),
      },
    },
    runtime: {
      getManifest: () => ({ version: '0.7.1' }),
    },
  });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

describe('本地黑白名单同步', () => {
  it('升级后补传历史黑名单与白名单，并以同步状态防止重复发送', async () => {
    storage.blockedAccounts = [
      { handle: 'old_block', xUserId: '123', blockedAt: 100 },
      {
        handle: 'rich_block',
        blockedAt: 200,
        category: 'copy_paste',
        contentFingerprint: '0123456789abcdef',
        linkDomains: ['spam.example'],
      },
    ];
    storage.allowlist = [
      {
        handle: 'legit_creator',
        xUserId: '456',
        addedAt: 300,
        detectionSource: 'heuristic',
        ruleId: 'default-name-digits',
        detectionReason: '正常账号',
      },
    ];
    fetchMock
      .mockResolvedValueOnce(
        resultResponse([
          { handle: 'old_block', status: 'recorded' },
          { handle: 'rich_block', status: 'recorded' },
        ]),
      )
      .mockResolvedValueOnce(resultResponse([{ handle: 'legit_creator', status: 'unknown' }]));

    await expect(syncLocalLabels()).resolves.toEqual({
      blocked: 2,
      allowed: 1,
      retracted: 0,
      pending: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const reportBody = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(reportBody).toMatchObject({
      client_version: '0.7.1',
      reports: [
        { handle: 'old_block', x_user_id: '123', reason: 'other' },
        {
          handle: 'rich_block',
          reason: 'copy_paste',
          content_fingerprint: '0123456789abcdef',
          link_domains: ['spam.example'],
        },
      ],
    });
    const rescueBody = JSON.parse(
      (fetchMock.mock.calls[1]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(rescueBody).toMatchObject({
      rescues: [
        {
          handle: 'legit_creator',
          x_user_id: '456',
          detection_source: 'heuristic',
          rule_id: 'default-name-digits',
          detection_reason: '正常账号',
        },
      ],
    });

    fetchMock.mockClear();
    await expect(syncLocalLabels()).resolves.toMatchObject({ pending: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('同一账号取较新的本地判断，删除名单后撤回当前票', async () => {
    storage.blockedAccounts = [{ handle: 'changed_mind', blockedAt: 100, category: 'other' }];
    storage.allowlist = [{ handle: 'changed_mind', addedAt: 200 }];
    fetchMock.mockResolvedValueOnce(
      resultResponse([{ handle: 'changed_mind', status: 'unknown' }]),
    );

    await syncLocalLabels();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/v1/rescues');

    storage.allowlist = [];
    fetchMock.mockResolvedValueOnce(
      resultResponse([{ handle: 'changed_mind', status: 'recorded' }]),
    );
    await syncLocalLabels();
    expect(String(fetchMock.mock.calls[1]![0])).toContain('/v1/reports');

    storage.blockedAccounts = [];
    fetchMock.mockResolvedValueOnce(
      resultResponse([{ handle: 'changed_mind', status: 'retracted' }]),
    );
    await expect(syncLocalLabels()).resolves.toMatchObject({ retracted: 1, pending: 0 });
    expect(String(fetchMock.mock.calls[2]![0])).toContain('/v1/labels/retract');
  });

  it('云端批量拉黑只执行用户动作，不把名单条目再次回灌成社区举报', async () => {
    storage.blockedAccounts = [
      {
        handle: 'cloud_spam',
        blockedAt: 100,
        category: 'other',
        origin: 'community-batch',
        communityVote: false,
      },
    ];
    storage.followingAllowlistV1 = [
      { handle: 'private_follow', protectedAt: 100, source: 'full-sync' },
    ];

    await expect(syncLocalLabels()).resolves.toEqual({
      blocked: 0,
      allowed: 0,
      retracted: 0,
      pending: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
