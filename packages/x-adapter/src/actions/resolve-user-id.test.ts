// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveUserIdByHandle } from './resolve-user-id';

afterEach(() => {
  document.cookie = 'ct0=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('resolveUserIdByHandle', () => {
  it('resolves rest_id via UserByScreenName with the page session', async () => {
    document.cookie = 'ct0=csrf-token-123';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { user: { result: { __typename: 'User', rest_id: '900000000000000001' } } },
      }),
    });

    const id = await resolveUserIdByHandle('spamking88', fetchMock as unknown as typeof fetch);

    expect(id).toBe('900000000000000001');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/i/api/graphql/32pL5BWe9WKeSK1MoPvFQQ/UserByScreenName');
    expect(url).toContain(`screen_name%22%3A%22spamking88%22`);
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Csrf-Token']).toBe('csrf-token-123');
    expect(headers['X-Twitter-Auth-Type']).toBe('OAuth2Session');
  });

  it('returns null for UserUnavailable', async () => {
    document.cookie = 'ct0=csrf-token-123';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { user: { result: { __typename: 'UserUnavailable' } } } }),
    });
    expect(await resolveUserIdByHandle('ghost', fetchMock as unknown as typeof fetch)).toBeNull();
  });

  it('returns null when csrf cookie is missing', async () => {
    const fetchMock = vi.fn();
    expect(await resolveUserIdByHandle('x', fetchMock as unknown as typeof fetch)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null on HTTP error or network failure', async () => {
    document.cookie = 'ct0=csrf-token-123';
    const httpFail = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    expect(await resolveUserIdByHandle('x', httpFail as unknown as typeof fetch)).toBeNull();
    const netFail = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await resolveUserIdByHandle('x', netFail as unknown as typeof fetch)).toBeNull();
  });
});
