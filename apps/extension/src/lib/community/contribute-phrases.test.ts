// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contributeKeywordPhrases } from './contribute';

let storage: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage = {
    communitySettings: { enabled: true, strength: 'standard', autoContribute: true },
    installationId: 'install-0123456789',
  };
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(storage, patch)),
      },
    },
    runtime: {
      getManifest: () => ({ version: '0.8.0' }),
    },
  });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

describe('关键词短语贡献', () => {
  it('POST 仅携带短语与安装 ID，recorded 回报成功', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ results: [{ phrase: '同城上门', status: 'recorded' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const outcome = await contributeKeywordPhrases(['同城上门']);
    expect(outcome).toEqual({ status: 'recorded' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/keyword-contributions');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      installation_id: 'install-0123456789',
      phrases: ['同城上门'],
    });
    // 红线口径：绝不携带短语之外的本地数据（无账号/名单/历史）
    const serialized = String(init.body);
    expect(serialized).not.toContain('blockedAccounts');
    expect(serialized).not.toContain('handle');
  });

  it('服务端 duplicate（幂等重试）同样向用户回报成功', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ results: [{ phrase: '同城上门', status: 'duplicate' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(await contributeKeywordPhrases(['同城上门'])).toEqual({ status: 'recorded' });
  });

  it('autoContribute 关闭 = 不参与社区：零网络请求', async () => {
    storage.communitySettings = { enabled: true, strength: 'standard', autoContribute: false };
    expect(await contributeKeywordPhrases(['同城上门'])).toEqual({ status: 'community_disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('非 2xx / 其他状态回落 failed', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 429 }));
    expect(await contributeKeywordPhrases(['词'])).toEqual({ status: 'failed' });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ results: [{ status: 'rejected' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(await contributeKeywordPhrases(['词'])).toEqual({ status: 'failed' });
  });
});
