// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runNativeAction, X_WEB_BEARER } from './block';

function mockFetch(status: number): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({ ok: status < 400, status });
}

afterEach(() => {
  document.cookie = 'ct0=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('runNativeAction', () => {
  it('sends the same request the X web client sends when blocking', async () => {
    document.cookie = 'ct0=csrf-token-123';
    const fetchMock = mockFetch(200);

    const result = await runNativeAction('block', '900000000000000001', fetchMock as unknown as typeof fetch);

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://x.com/i/api/1.1/blocks/create.json',
      expect.objectContaining({
        method: 'POST',
        body: 'user_id=900000000000000001',
      }),
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['X-Csrf-Token']).toBe('csrf-token-123');
    expect(headers['X-Twitter-Auth-Type']).toBe('OAuth2Session');
    expect(headers.Authorization).toBe(X_WEB_BEARER);
  });

  it('hits destroy.json for unblock', async () => {
    document.cookie = 'ct0=csrf-token-123';
    const fetchMock = mockFetch(200);

    await runNativeAction('unblock', '900000000000000001', fetchMock as unknown as typeof fetch);

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('blocks/destroy.json');
  });

  it.each([
    [403, 'auth_required'],
    [429, 'rate_limited'],
    [500, 'http_error'],
  ])('maps HTTP %i to %s failure', async (status, code) => {
    document.cookie = 'ct0=csrf-token-123';
    const result = await runNativeAction('block', '1', mockFetch(status) as unknown as typeof fetch);
    expect(result).toMatchObject({ ok: false, code });
  });

  it('fails honestly when csrf cookie is missing', async () => {
    const result = await runNativeAction('block', '1', mockFetch(200) as unknown as typeof fetch);
    expect(result).toMatchObject({ ok: false, code: 'missing_csrf' });
  });

  it('returns network_error when fetch throws', async () => {
    document.cookie = 'ct0=csrf-token-123';
    const failing = vi.fn().mockRejectedValue(new Error('offline'));
    const result = await runNativeAction('block', '1', failing as unknown as typeof fetch);
    expect(result).toMatchObject({ ok: false, code: 'network_error', message: 'offline' });
  });
});
