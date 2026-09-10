/**
 * Following 全量关注同步（从 content.ts 抽出，行为零变化）。
 *
 * 流程：用户在 popup 点「同步关注」→ start() 写 waiting 状态并跳转到
 * 自己的 x.com/<handle>/following 页 → 首页 GraphQL 响应经 xhr-bridge 进入
 * onPage() → continueSync 用 cursor 自驱分页，直到连续 3 个空页（X 到末尾后
 * 仍会继续发只含导航 cursor 的空页，单个空页可能是时间线间隙）或触达安全上限。
 *
 * 完整分页只写 draft，全部结束才原子替换正式名单 —— 失败绝不留下半截名单。
 */

import {
  parseXApiResponse,
  readCsrfToken,
  X_WEB_BEARER,
  type ParsedApiData,
} from '@feedsieve/x-adapter';
import {
  clearFollowingSyncDraft,
  getFollowingSyncDraft,
  getFollowingSyncState,
  getSelfHandle,
  replaceFollowingAccounts,
  setFollowingSyncDraft,
  setFollowingSyncState,
} from './following-allowlist';

export interface FollowingSyncDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** 分页取数（默认真实实现：csrf + fetch + parseXApiResponse；测试注入替身）。 */
  fetchPage?: (sourceUrl: string, cursor: string) => Promise<ParsedApiData>;
  /** 跳转到自己的关注页（默认 location.assign）。 */
  navigate?: (url: string) => void;
  /** 分页安全上限（防 cursor 环导致的无限循环）。 */
  maxPages?: number;
  /** 相邻分页请求间隔。 */
  pageIntervalMs?: number;
  /** 状态超过该时长未更新视为同步被打断（页面关闭等）。 */
  interruptionWindowMs?: number;
  /** 429/5xx/超时的单次退避。 */
  retryBackoffMs?: number;
}

export type FollowingSyncStartResult =
  | { status: 'navigating'; url: string }
  | { status: 'error'; error: string };

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function createFollowingSync(deps: FollowingSyncDeps = {}) {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const navigate = deps.navigate ?? ((url: string) => location.assign(url));
  const maxPages = deps.maxPages ?? 1000;
  const pageIntervalMs = deps.pageIntervalMs ?? 650;
  const interruptionWindowMs = deps.interruptionWindowMs ?? 60_000;
  const retryBackoffMs = deps.retryBackoffMs ?? 1200;
  /** 同页重入保护：分页循环进行中，后续同一页/重复响应直接并入现有 Promise。 */
  let running: Promise<void> | null = null;

  /** popup「同步关注」入口：写 waiting 状态并跳转，交给页面触发首页 GraphQL。 */
  async function start(): Promise<FollowingSyncStartResult> {
    const selfHandle = await getSelfHandle();
    if (!selfHandle) {
      return { status: 'error', error: 'self_handle_unknown' };
    }
    const startedAt = now();
    await clearFollowingSyncDraft();
    await setFollowingSyncState({
      status: 'waiting',
      collected: 0,
      startedAt,
      updatedAt: startedAt,
    });
    const url = `https://x.com/${selfHandle}/following`;
    // 用户显式点了同步；进入 X 自己的关注页触发首页 GraphQL，
    // 之后由 onPage 使用 cursor 继续分页。
    navigate(url);
    return { status: 'navigating', url };
  }

  /** xhr-bridge 送来的 Following 页响应（含首页与后续分页）。 */
  async function onPage(parsed: ParsedApiData): Promise<void> {
    const syncState = await getFollowingSyncState();
    if (syncState.status !== 'waiting' && syncState.status !== 'running') return;
    if (now() - syncState.updatedAt > interruptionWindowMs) {
      await setFollowingSyncState({
        ...syncState,
        status: 'error',
        updatedAt: now(),
        error: 'following_sync_interrupted',
      });
      return;
    }
    if (running) return running;
    running = continueSync(parsed).finally(() => {
      running = null;
    });
    return running;
  }

  async function continueSync(firstPage: ParsedApiData): Promise<void> {
    const started = await getFollowingSyncState();
    const startedAt = started.startedAt ?? now();
    let draft = await getFollowingSyncDraft();
    const byHandle = new Map(draft.map((item) => [item.handle, item]));
    const addPage = (page: ParsedApiData): number => {
      const sizeBefore = byHandle.size;
      for (const account of page.following ?? []) {
        const handle = account.handle.trim().replace(/^@+/, '').toLowerCase();
        if (!handle) continue;
        const existing = byHandle.get(handle);
        byHandle.set(handle, {
          handle,
          ...(account.xUserId || existing?.xUserId
            ? { xUserId: account.xUserId ?? existing?.xUserId }
            : {}),
        });
      }
      return byHandle.size - sizeBefore;
    };

    try {
      let page = firstPage;
      let sourceUrl = page.sourceUrl;
      const seenCursors = new Set<string>();
      let consecutivePagesWithoutNewAccounts = 0;
      let reachedSafetyLimit = true;
      for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
        const added = addPage(page);
        consecutivePagesWithoutNewAccounts =
          added === 0 ? consecutivePagesWithoutNewAccounts + 1 : 0;
        draft = [...byHandle.values()];
        await setFollowingSyncDraft(draft);
        await setFollowingSyncState({
          status: 'running',
          collected: draft.length,
          startedAt,
          updatedAt: now(),
        });

        // X 的 Following 时间线到末尾后仍会继续发只含导航 cursor 的空页；
        // 连续空页才是稳定终止信号，单个空页仍允许跨越时间线间隙。
        if (consecutivePagesWithoutNewAccounts >= 3) {
          reachedSafetyLimit = false;
          break;
        }

        const cursor = page.followingCursor;
        if (!cursor) {
          reachedSafetyLimit = false;
          break;
        }
        if (!sourceUrl || seenCursors.has(cursor)) {
          throw new Error(!sourceUrl ? 'following_source_url_missing' : 'following_cursor_loop');
        }
        seenCursors.add(cursor);
        await sleep(pageIntervalMs);
        page = await (deps.fetchPage ?? defaultFetchPage)(sourceUrl, cursor);
        sourceUrl = page.sourceUrl ?? sourceUrl;
      }

      if (reachedSafetyLimit) {
        throw new Error('following_page_limit_reached');
      }

      const complete = [...byHandle.values()];
      await replaceFollowingAccounts(complete);
      await clearFollowingSyncDraft();
      await setFollowingSyncState({
        status: 'complete',
        collected: complete.length,
        startedAt,
        updatedAt: now(),
      });
    } catch (error) {
      await setFollowingSyncState({
        status: 'error',
        collected: byHandle.size,
        startedAt,
        updatedAt: now(),
        error: error instanceof Error ? error.message : 'following_sync_failed',
      });
    }
  }

  /** 默认分页取数：复用页面会话（csrf + cookie）请求 Following 时间线下一页。 */
  async function defaultFetchPage(
    sourceUrl: string,
    cursor: string,
  ): Promise<ParsedApiData> {
    const csrf = readCsrfToken();
    if (!csrf) throw new Error('missing_csrf');
    const url = new URL(sourceUrl);
    const rawVariables = url.searchParams.get('variables');
    if (!rawVariables) throw new Error('following_variables_missing');
    const variables = JSON.parse(rawVariables) as Record<string, unknown>;
    variables.cursor = cursor;
    url.searchParams.set('variables', JSON.stringify(variables));
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(url.toString(), {
          method: 'GET',
          credentials: 'include',
          signal: controller.signal,
          headers: {
            Authorization: X_WEB_BEARER,
            'X-Twitter-Auth-Type': 'OAuth2Session',
            'X-Twitter-Active-User': 'yes',
            'X-Csrf-Token': csrf,
          },
        });
        if (!response.ok) {
          if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
            await sleep(retryBackoffMs);
            continue;
          }
          throw new Error(`following_http_${response.status}`);
        }
        const page = parseXApiResponse(url.toString(), await response.json());
        return { ...page, sourceUrl: url.toString() };
      } catch (error) {
        if (attempt === 0 && (error as { name?: string })?.name === 'AbortError') {
          await sleep(retryBackoffMs);
          continue;
        }
        if ((error as { name?: string })?.name === 'AbortError') {
          throw new Error('following_request_timeout', { cause: error });
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error('following_request_failed');
  }

  return { start, onPage };
}

export type FollowingSync = ReturnType<typeof createFollowingSync>;
