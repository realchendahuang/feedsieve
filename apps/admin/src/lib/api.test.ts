import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDashboard } from './api';
import { errorText } from './errors';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

describe('管理端 API 错误处理', () => {
  it('不会把 Access HTML 登录页当成 JSON 解析异常', async () => {
    fetchMock.mockResolvedValue(
      new Response('<!doctype html><title>Access login</title>', {
        status: 401,
        headers: { 'content-type': 'text/html' },
      }),
    );

    const error = await getDashboard().catch((value: unknown) => value);
    expect(errorText(error)).toBe('Access 身份未授权');
  });

  it('保留服务端结构化错误码', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'publish_failed' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const error = await getDashboard().catch((value: unknown) => value);
    expect(errorText(error)).toBe('发布失败');
  });

  it('不会把 200 状态的 HTML fallback 当成成功 JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response('<!doctype html><div id="root"></div>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );

    const error = await getDashboard().catch((value: unknown) => value);
    expect(errorText(error)).toBe('管理端暂时不可用，请刷新后重试');
  });

  it('200 但响应结构漂移时按 invalid_response 拒绝，不静默渲染空值', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ unexpected: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const error = await getDashboard().catch((value: unknown) => value);
    expect(errorText(error)).toBe('管理端暂时不可用，请刷新后重试');
  });
});
