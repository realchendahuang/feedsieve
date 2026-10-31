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

    const outcome = await resolveUserIdByHandle('spamking88', fetchMock as unknown as typeof fetch);

    expect(outcome).toEqual({ ok: true, xUserId: '900000000000000001' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/i/api/graphql/32pL5BWe9WKeSK1MoPvFQQ/UserByScreenName');
    expect(url).toContain(`screen_name%22%3A%22spamking88%22`);
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Csrf-Token']).toBe('csrf-token-123');
    expect(headers['X-Twitter-Auth-Type']).toBe('OAuth2Session');
  });

  it('账号已注销/被封（UserUnavailable）-> no_user，与解析失败分开', async () => {
    document.cookie = 'ct0=csrf-token-123';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { user: { result: { __typename: 'UserUnavailable' } } } }),
    });
    expect(await resolveUserIdByHandle('ghost', fetchMock as unknown as typeof fetch)).toEqual({
      ok: false,
      code: 'no_user',
    });
  });

  it('200 但 data.user 缺失（X 对死账号的现行形状）-> no_user', async () => {
    document.cookie = 'ct0=csrf-token-123';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    });
    expect(await resolveUserIdByHandle('ghost', fetchMock as unknown as typeof fetch)).toEqual({
      ok: false,
      code: 'no_user',
    });
  });

  it('账号在但响应没有 rest_id（形状迁移）-> parse，绝不伪装成查无此人', async () => {
    document.cookie = 'ct0=csrf-token-123';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { user: { result: { __typename: 'User' } } } }),
    });
    expect(await resolveUserIdByHandle('alive', fetchMock as unknown as typeof fetch)).toEqual({
      ok: false,
      code: 'parse',
    });
  });

  it('200 + errors code 88（限流）-> rate_limited', async () => {
    document.cookie = 'ct0=csrf-token-123';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ errors: [{ code: 88, message: 'Rate limit exceeded' }] }),
    });
    expect(await resolveUserIdByHandle('x', fetchMock as unknown as typeof fetch)).toEqual({
      ok: false,
      code: 'rate_limited',
    });
  });

  it('200 + 其它 errors -> parse（契约异常）', async () => {
    document.cookie = 'ct0=csrf-token-123';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ errors: [{ code: 32, message: 'Could not authenticate' }] }),
    });
    expect(await resolveUserIdByHandle('x', fetchMock as unknown as typeof fetch)).toEqual({
      ok: false,
      code: 'parse',
    });
  });

  it('429 -> rate_limited（携带 statusCode）；500 -> http_error；403 -> no_csrf', async () => {
    document.cookie = 'ct0=csrf-token-123';
    const http429 = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    expect(await resolveUserIdByHandle('x', http429 as unknown as typeof fetch)).toEqual({
      ok: false,
      code: 'rate_limited',
      statusCode: 429,
    });
    const http500 = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    expect(await resolveUserIdByHandle('x', http500 as unknown as typeof fetch)).toEqual({
      ok: false,
      code: 'http_error',
      statusCode: 500,
    });
    const http403 = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    expect(await resolveUserIdByHandle('x', http403 as unknown as typeof fetch)).toEqual({
      ok: false,
      code: 'no_csrf',
      statusCode: 403,
    });
  });

  it('网络异常 -> network_error', async () => {
    document.cookie = 'ct0=csrf-token-123';
    const netFail = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await resolveUserIdByHandle('x', netFail as unknown as typeof fetch)).toEqual({
      ok: false,
      code: 'network_error',
    });
  });

  it('csrf 缺失 -> no_csrf 且不发请求', async () => {
    const fetchMock = vi.fn();
    expect(await resolveUserIdByHandle('x', fetchMock as unknown as typeof fetch)).toEqual({
      ok: false,
      code: 'no_csrf',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
