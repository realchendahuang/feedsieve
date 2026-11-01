/**
 * 主页补全：用户点「补全」后向下滚动，让 X 自己加载更多帖子。
 *
 * 只由用户显式触发（主页洞察面板工具条上的图标），不自动滚；随时可以再点一次停止。
 * 节奏按人的翻页习惯来：一次翻将近一屏，停 1–2.2 秒再翻下一屏，间隔带随机；
 * 连续几次没有新帖子就停，避免滚过空白区继续空跑。
 */
import { tweetSelectors } from '@feedsieve/x-adapter';

export const PROFILE_FILL_MAX_STEPS = 40;
/** 每步翻多少：将近一屏（视口高度 × 0.9–1.15，随机）。 */
export const PROFILE_FILL_STEP_MIN_RATIO = 0.9;
export const PROFILE_FILL_STEP_MAX_RATIO = 1.15;
export const PROFILE_FILL_STEP_MIN_MS = 1_000;
export const PROFILE_FILL_STEP_MAX_MS = 2_200;
export const PROFILE_FILL_TARGET_POSTS = 300;

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

/** 每一步停多久：1–2.2 秒之间随机，间隔不固定，更像真人翻页。 */
function stepDelay(random: () => number): number {
  return Math.round(
    PROFILE_FILL_STEP_MIN_MS + random() * (PROFILE_FILL_STEP_MAX_MS - PROFILE_FILL_STEP_MIN_MS),
  );
}

/** 每一步翻多远：一屏上下随机浮动，不会每次都是同一个距离。 */
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
    let last = before;
    let stopped: ProfileFillStop = 'limit';
    try {
      for (let step = 0; step < PROFILE_FILL_MAX_STEPS; step++) {
        if (stopRequested) {
          stopped = 'user';
          break;
        }
        // 一屏一屏地翻，像人在快速往下滚
        window.scrollBy({ top: stepDistance(random), behavior: 'smooth' });
        await sleep(stepDelay(random));
        const now = countArticles();
        if (now >= before + PROFILE_FILL_TARGET_POSTS) break;
        stagnant = now === last ? stagnant + 1 : 0;
        last = now;
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
