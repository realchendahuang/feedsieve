/**
 * 主页补全：用户点「补全」后向下滚动，让 X 自己加载更多帖子。
 *
 * 只由用户显式触发（主页洞察面板工具条上的图标），不自动滚；随时可以再点一次停止。
 * 每一步直接滚到当前页面底部（等同按 End），等 X 加载出下一批帖子再继续；加载快时
 * 几乎不停，最多等 1.2 秒。一直到底（连续 4 批没有新内容），或到 40 批的保险上限。
 */
import { tweetSelectors } from '@feedsieve/x-adapter';

export const PROFILE_FILL_MAX_STEPS = 200;
/** 等新内容时每 150ms 看一次；最多等 1.2 秒。 */
export const PROFILE_FILL_POLL_MS = 150;
export const PROFILE_FILL_WAIT_MS = 1_200;
/** 连续这么多批没有新帖子就当作到底。 */
export const PROFILE_FILL_STAGNANT_LIMIT = 8;

export type ProfileFillStop = 'user' | 'limit' | 'stagnant' | 'not-profile';

export interface ProfileFillResult {
  ok: boolean;
  added: number;
  stopped?: ProfileFillStop;
}

/** 当前页面是不是这个博主的主页（/handle，不含子路径）。 */
export function isProfilePath(path: string, handle: string): boolean {
  return new RegExp(`^/${handle.replace(/[^a-z0-9_]/gi, '')}/?$`, 'i').test(path);
}

export function countArticles(): number {
  return document.querySelectorAll(tweetSelectors.article).length;
}

/**
 * 当前页面上能看到的帖子 ID。
 * X 的列表会回收 DOM（滚过去之后旧 article 会被移走），所以不能用 article 数量判断
 * 「这一批加载没有」——只能把滚动过程中见到的 ID 累积起来看有没有新面孔。
 */
export function collectPostIds(): Set<string> {
  const ids = new Set<string>();
  for (const article of document.querySelectorAll(tweetSelectors.article)) {
    const href = article
      .querySelector('a[href*="/status/"]')
      ?.getAttribute('href');
    const match = href?.match(/\/status\/(\d+)/);
    if (match) ids.add(match[1]!);
  }
  return ids;
}

/** 直接滚到页面底部（等同按 End 键），让 X 加载下一批。 */
function scrollToBottom(): void {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
}

export function createProfileFill(options: { sleep?: (ms: number) => Promise<void> } = {}) {
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => window.setTimeout(resolve, ms)));
  let running = false;
  let stopRequested = false;

  async function fill(handle: string): Promise<ProfileFillResult> {
    if (running) return { ok: false, added: 0, stopped: 'user' };
    if (!isProfilePath(location.pathname, handle)) {
      return { ok: false, added: 0, stopped: 'not-profile' };
    }
    running = true;
    stopRequested = false;
    const seen = collectPostIds();
    const beforeCount = seen.size;
    let stagnant = 0;
    let stopped: ProfileFillStop = 'limit';
    try {
      for (let step = 0; step < PROFILE_FILL_MAX_STEPS; step++) {
        if (stopRequested) {
          stopped = 'user';
          break;
        }
        // 直接到底，等 X 加载完这一批再继续
        scrollToBottom();
        // 等 X 把这一批加载出来：加载快就立刻继续，最多等 1.5 秒
        let grew = false;
        const maxPolls = Math.ceil(PROFILE_FILL_WAIT_MS / PROFILE_FILL_POLL_MS);
        for (let poll = 0; poll < maxPolls; poll++) {
          await sleep(PROFILE_FILL_POLL_MS);
          if (stopRequested) break;
          // 只有「新出现的帖子 ID」才算这一批有收获；scrollHeight 会因渲染/推荐位变化，
          // 拿它判断容易空跑
          for (const id of collectPostIds()) {
            if (!seen.has(id)) {
              seen.add(id);
              grew = true;
            }
          }
          if (grew) break;
        }
        if (stopRequested) {
          stopped = 'user';
          break;
        }
        // 连续多批没有新帖子就当作到底
        stagnant = grew ? 0 : stagnant + 1;
        if (stagnant >= PROFILE_FILL_STAGNANT_LIMIT) {
          stopped = 'stagnant';
          break;
        }
      }
    } finally {
      running = false;
    }
    return { ok: true, added: Math.max(0, seen.size - beforeCount), stopped };
  }

  return {
    fill,
    stop: (): void => {
      stopRequested = true;
    },
    isRunning: (): boolean => running,
  };
}

export type ProfileFill = ReturnType<typeof createProfileFill>;
