/**
 * 主页补全：用户点「补全」后向下滚动，让 X 自己加载更多帖子。
 *
 * 只由用户显式触发（主页洞察面板工具条上的图标），不自动滚；随时可以再点一次停止。
 * 一次翻 8–12 屏，然后等 X 把这一批加载出来（最多等 1.5 秒，加载快时立刻继续），
 * 一直滚到没有新帖子为止（连续 5 批没有增长），或到 30 批的保险上限。
 */
import { tweetSelectors } from '@feedsieve/x-adapter';

export const PROFILE_FILL_MAX_STEPS = 30;
/** 每步翻多少：8–12 屏（视口高度 × 8–12，随机），一次甩很远。 */
export const PROFILE_FILL_STEP_MIN_RATIO = 8;
export const PROFILE_FILL_STEP_MAX_RATIO = 12;
/** 等新内容时每 150ms 看一次；最多等 1.5 秒。 */
export const PROFILE_FILL_POLL_MS = 150;
export const PROFILE_FILL_WAIT_MS = 1_500;

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

/** 每一步翻多远：8–12 屏随机，一次甩一大截。 */
function stepDistance(random: () => number): number {
  const ratio =
    PROFILE_FILL_STEP_MIN_RATIO +
    random() * (PROFILE_FILL_STEP_MAX_RATIO - PROFILE_FILL_STEP_MIN_RATIO);
  return Math.round(window.innerHeight * ratio);
}

export function createProfileFill(
  options: { sleep?: (ms: number) => Promise<void>; random?: () => number } = {},
) {
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => window.setTimeout(resolve, ms)));
  const random = options.random ?? (() => Math.random());
  let running = false;
  let stopRequested = false;

  async function fill(handle: string): Promise<ProfileFillResult> {
    if (running) return { ok: false, added: 0, stopped: 'user' };
    if (!isProfilePath(location.pathname, handle)) {
      return { ok: false, added: 0, stopped: 'not-profile' };
    }
    running = true;
    stopRequested = false;
    const before = countArticles();
    let stagnant = 0;
    let stopped: ProfileFillStop = 'limit';
    try {
      for (let step = 0; step < PROFILE_FILL_MAX_STEPS; step++) {
        if (stopRequested) {
          stopped = 'user';
          break;
        }
        const beforeHeight = document.documentElement.scrollHeight;
        const beforeCount = countArticles();
        // 一次翻 8–12 屏，像人快速往下甩
        window.scrollBy({ top: stepDistance(random), behavior: 'smooth' });
        // 等 X 把这一批加载出来：加载快就立刻继续，最多等 1.5 秒
        let grew = false;
        const maxPolls = Math.ceil(PROFILE_FILL_WAIT_MS / PROFILE_FILL_POLL_MS);
        for (let poll = 0; poll < maxPolls; poll++) {
          await sleep(PROFILE_FILL_POLL_MS);
          if (stopRequested) break;
          if (
            document.documentElement.scrollHeight > beforeHeight ||
            countArticles() > beforeCount
          ) {
            grew = true;
            break;
          }
        }
        if (stopRequested) {
          stopped = 'user';
          break;
        }
        // 连续 5 批没有增长就当作到底
        stagnant = grew ? 0 : stagnant + 1;
        if (stagnant >= 5) {
          stopped = 'stagnant';
          break;
        }
      }
    } finally {
      running = false;
    }
    return { ok: true, added: countArticles() - before, stopped };
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
