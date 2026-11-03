/**
 * X 原生静音词客户端（隔离世界）。
 *
 * 请求本身和 X 网页端手动添加静音词一致：web bearer + ct0 CSRF +
 * `x-client-transaction-id`。transaction id 由 MAIN world 的 mute-bridge 生成，
 * 这里只发 list / create / destroy 三个固定端点。
 *
 * 所有失败都返回结构化结果，不抛异常：原生同步不可用时，本地折叠继续工作。
 */
import { normalizeMutePhrase, normalizeNativeMute, type NativeMute } from './mute-store';

const BEARER =
  'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const BASE = 'https://x.com/i/api/1.1/mutes/keywords';
const SIGN_BASE = '/1.1/mutes/keywords';
const REQUEST_EVENT = 'feedsieve:mute-transaction-id';
const RESULT_EVENT = 'feedsieve:mute-transaction-id-result';
const TID_TIMEOUT_MS = 6_000;
const FETCH_TIMEOUT_MS = 15_000;

/** X 网页端自己发静音词时带的面：首页、回复、通知。 */
const MUTE_SURFACES = 'home_timeline,notifications,tweet_replies';

export type NativeMuteFailure =
  | 'signer_unavailable'
  | 'signer_timeout'
  | 'missing_csrf'
  | 'auth_required'
  | 'rate_limited'
  | 'http_error'
  | 'network_error'
  | 'invalid_response';

export type NativeMuteResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: NativeMuteFailure; status?: number; retryAfterMs?: number };

function readCsrfToken(): string | null {
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith('ct0=')) {
      return trimmed.substring('ct0='.length) || null;
    }
  }
  return null;
}

function requestTransactionId(path: string, method: string): Promise<string> {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `tid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  return new Promise((resolve, reject) => {
    let done = false;
    const cleanup = (): void => {
      done = true;
      window.clearTimeout(timer);
      document.removeEventListener(RESULT_EVENT, onResult);
    };
    const onResult = (event: Event): void => {
      let detail: { id?: unknown; tid?: unknown; error?: unknown };
      try {
        detail = JSON.parse((event as CustomEvent<string>).detail) as {
          id?: unknown;
          tid?: unknown;
          error?: unknown;
        };
      } catch {
        return;
      }
      if (detail.id !== id) return;
      cleanup();
      if (typeof detail.tid === 'string' && detail.tid) resolve(detail.tid);
      else reject(new Error(typeof detail.error === 'string' ? detail.error : 'signer_failed'));
    };
    const timer = window.setTimeout(() => {
      if (done) return;
      cleanup();
      reject(new Error('signer_timeout'));
    }, TID_TIMEOUT_MS);
    document.addEventListener(RESULT_EVENT, onResult);
    try {
      document.dispatchEvent(
        new CustomEvent(REQUEST_EVENT, {
          bubbles: true,
          detail: JSON.stringify({ id, path, method }),
        }),
      );
    } catch {
      cleanup();
      reject(new Error('signer_unavailable'));
    }
  });
}

async function call(
  op: 'list' | 'create' | 'destroy',
  options: { method: 'GET' | 'POST'; body?: string },
): Promise<Response> {
  const csrf = readCsrfToken();
  if (!csrf) throw new Error('missing_csrf');
  const signPath = `${SIGN_BASE}/${op}.json`;
  const tid = await requestTransactionId(signPath, options.method);
  return fetch(`${BASE}/${op}.json`, {
    method: options.method,
    credentials: 'include',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      accept: '*/*',
      authorization: BEARER,
      'x-csrf-token': csrf,
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-client-language': document.documentElement.lang || 'zh-cn',
      'x-client-transaction-id': tid,
      ...(options.body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(options.body ? { body: options.body } : {}),
  });
}

function failureFromError(error: unknown): NativeMuteResult<never> {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'missing_csrf') return { ok: false, code: 'missing_csrf' };
  if (message === 'signer_timeout') return { ok: false, code: 'signer_timeout' };
  if (message === 'signer_unavailable' || message === 'signer_failed' || message === 'unsupported_path') {
    return { ok: false, code: 'signer_unavailable' };
  }
  return { ok: false, code: 'network_error' };
}

async function readFailure(
  response: Response,
): Promise<NativeMuteResult<never>> {
  const status = response.status;
  if (status === 401 || status === 403) return { ok: false, code: 'auth_required', status };
  if (status === 429) {
    const retryAfter = Number(response.headers.get('retry-after') ?? 0);
    return {
      ok: false,
      code: 'rate_limited',
      status,
      ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterMs: retryAfter * 1000 } : {}),
    };
  }
  return { ok: false, code: 'http_error', status };
}

function parseList(payload: unknown): NativeMute[] | null {
  const value = payload as { muted_keywords?: unknown } | null;
  if (!Array.isArray(value?.muted_keywords)) return null;
  return value.muted_keywords
    .map((entry) => normalizeNativeMute(entry))
    .filter((entry): entry is NativeMute => entry !== null);
}

async function request(
  op: 'list' | 'create' | 'destroy',
  options: { method: 'GET' | 'POST'; body?: string },
): Promise<NativeMuteResult<NativeMute[]>> {
  let response: Response;
  try {
    response = await call(op, options);
  } catch (error) {
    return failureFromError(error);
  }
  if (!response.ok) return readFailure(response);
  try {
    const payload = (await response.json()) as unknown;
    const list = parseList(payload);
    return list ? { ok: true, data: list } : { ok: false, code: 'invalid_response' };
  } catch {
    return { ok: false, code: 'invalid_response' };
  }
}

export function listNativeMutes(): Promise<NativeMuteResult<NativeMute[]>> {
  return request('list', { method: 'GET' });
}

export async function createNativeMute(
  keyword: string,
): Promise<NativeMuteResult<{ mute: NativeMute | null; list: NativeMute[] }>> {
  const phrase = normalizeMutePhrase(keyword);
  if (!phrase) return { ok: false, code: 'invalid_response' };
  const body = new URLSearchParams({
    keyword: phrase,
    mute_surfaces: MUTE_SURFACES,
    mute_options: '',
    duration: '',
  }).toString();
  const result = await request('create', { method: 'POST', body });
  if (!result.ok) return result;
  const key = phrase.normalize('NFKC').toLocaleLowerCase();
  const mute =
    result.data.find((entry) => entry.keyword.normalize('NFKC').toLocaleLowerCase() === key) ?? null;
  return { ok: true, data: { mute, list: result.data } };
}

export async function destroyNativeMutes(
  ids: readonly string[],
): Promise<NativeMuteResult<NativeMute[]>> {
  const valid = ids.filter((id) => /^[0-9]{1,20}$/.test(id));
  if (valid.length === 0) return { ok: false, code: 'invalid_response' };
  const body = new URLSearchParams({ ids: valid.join(',') }).toString();
  return request('destroy', { method: 'POST', body });
}
