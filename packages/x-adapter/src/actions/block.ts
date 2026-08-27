/**
 * 原生拉黑执行器 —— 经生产验证的标准路径。
 *
 * 两个成熟项目（PureTwitter 闭源 / Twitter-Block-With-Love MIT）独立收敛到同一实现：
 * 调用 X 网页端自己使用的 `1.1/blocks/create.json` 端点，用页面自身的登录会话
 * （公开 web client bearer + `ct0` CSRF）。这就是用户在页面点 Block 时浏览器发的同一个请求，
 * 不涉及 OAuth / Developer API。
 *
 * 必须在 x.com 页面上下文执行（content script ISOLATED world 即可）：
 * 需要 document.cookie 的 ct0 与页面会话凭证。
 *
 * 参考：docs/research/PURETWITTER_MECHANISM.md、third_party/tbwl/index.user.js
 */

export const X_WEB_BEARER =
  'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

export type NativeActionFailureCode =
  | 'auth_required'
  | 'rate_limited'
  | 'http_error'
  | 'network_error'
  | 'missing_csrf';

export type NativeActionResult =
  | { ok: true; handle?: string }
  | { ok: false; code: NativeActionFailureCode; message?: string };

export type NativeActionType = 'block' | 'unblock';

const ENDPOINTS: Record<NativeActionType, string> = {
  block: 'https://x.com/i/api/1.1/blocks/create.json',
  unblock: 'https://x.com/i/api/1.1/blocks/destroy.json',
};

export function readCsrfToken(): string | null {
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith('ct0=')) {
      return trimmed.substring('ct0='.length) || null;
    }
  }
  return null;
}

/**
 * 拉黑 / 取消拉黑一个账号（按 x_user_id）。
 *
 * 结果必须如实：网络失败、认证过期、限流都返回结构化错误，绝不假装成功。
 */
export async function runNativeAction(
  type: NativeActionType,
  xUserId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NativeActionResult> {
  const csrf = readCsrfToken();
  if (!csrf) {
    return {
      ok: false,
      code: 'missing_csrf',
      message: 'ct0 cookie 不可读（未登录或页面上下文错误）',
    };
  }

  try {
    const response = await fetchImpl(ENDPOINTS[type], {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        Authorization: X_WEB_BEARER,
        'X-Twitter-Auth-Type': 'OAuth2Session',
        'X-Twitter-Active-User': 'yes',
        'X-Csrf-Token': csrf,
      },
      body: `user_id=${encodeURIComponent(xUserId)}`,
    });

    if (response.ok) {
      return { ok: true };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, code: 'auth_required', message: `HTTP ${response.status}` };
    }
    if (response.status === 429) {
      return { ok: false, code: 'rate_limited', message: 'HTTP 429' };
    }
    return { ok: false, code: 'http_error', message: `HTTP ${response.status}` };
  } catch (error) {
    return {
      ok: false,
      code: 'network_error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
