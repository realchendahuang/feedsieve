/**
 * 主页补全：用户点「补全」后向下滚动，让 X 自己加载更多帖子。
 *
 * 只由用户显式触发（主页洞察面板工具条上的图标），不自动滚；随时可以再点一次停止。
 * 滚动刻意放慢、带随机停顿，模仿人滑手机：每次只滚半屏左右、间隔 1.8–3.6 秒，
 * 避免被 X 当成脚本操作。最多 PROFILE_FILL_MAX_STEPS 步、或新增 PROFILE_FILL_TARGET_POSTS 条、
 * 或连续三次没有新帖子就停。
 */
import { tweetSelectors } from '@feedsieve/x-adapter';

export const PROFILE_FILL_MAX_STEPS = 24;
/** 每步滚动的距离：大约半屏，不是一次翻到底。 */
export const PROFILE_FILL_STEP_PX = 480;
export const PROFILE_FILL_STEP_MIN_MS = 1_800;
export const PROFILE_FILL_STEP_MAX_MS = 3_600;
export const PROFILE_FILL_TARGET_POSTS = 100;

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

/** 每一步停多久：1.8–3.6 秒之间随机，和真人滑动的节奏接近。 */
function stepDelay(random: () => number): number {
  return Math.round(
    PROFILE_FILL_STEP_MIN_MS + random() * (PROFILE_FILL_STEP_MAX_MS - PROFILE_FILL_STEP_MIN_MS),
  );
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
    let last = before;
    let stopped: ProfileFillStop = 'limit';
    try {
      for (let step = 0; step < PROFILE_FILL_MAX_STEPS; step++) {
        if (stopRequested) {
          stopped = 'user';
          break;
        }
        // 半屏左右的小步 + 平滑滚动，看起来像人往下滑
        window.scrollBy({ top: PROFILE_FILL_STEP_PX, behavior: 'smooth' });
        await sleep(stepDelay(random));
        const now = countArticles();
        if (now >= before + PROFILE_FILL_TARGET_POSTS) break;
        stagnant = now === last ? stagnant + 1 : 0;
        last = now;
        if (stagnant >= 3) {
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
