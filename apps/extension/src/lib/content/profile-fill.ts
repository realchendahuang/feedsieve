/**
 * 主页补全：用户点「补全」后向下滚动，让 X 自己加载更多帖子。
 *
 * 只由用户显式触发（主页洞察面板工具条上的图标），不自动滚。停止有两个入口：
 * 面板里再点一次图标，或页面右下角常驻的「停止补全」按钮——面板关掉之后只剩后者，
 * 所以按钮跟着本轮状态走，不在面板里。
 * 每一步直接滚到当前页面底部（等同按 End），等 X 加载出下一批帖子再继续；加载快时
 * 几乎不停，最多等 1.2 秒。正常的结束条件是「到底」：连续 8 批没有新帖子。
 * 另有一条 10 分钟的保险丝，只在页面异常、永远加载不完时兜底，正常主页到不了。
 *
 * 防封号的两条约束：
 * - 同一个博主 3 分钟内只能补全一次（防连点，也防对同一个主页反复刷分页请求）；
 * - 页面在后台时不滚也不查（后台定时器被节流，容易看起来像脚本），切回前台再继续。
 */
import { tweetSelectors } from '@feedsieve/x-adapter';
import type { UiLanguage } from '../platform/i18n';

/** 保险丝：一轮最多滚 10 分钟。到底由下面的 stagnant 判断，不靠这个数。 */
export const PROFILE_FILL_MAX_MS = 10 * 60_000;
/** 等新内容时每 150ms 看一次；最多等 1.2 秒。 */
export const PROFILE_FILL_POLL_MS = 150;
export const PROFILE_FILL_WAIT_MS = 1_200;
/** 连续这么多批没有新帖子就当作到底。 */
export const PROFILE_FILL_STAGNANT_LIMIT = 8;
/** 同一个博主两次补全之间的最短间隔。 */
export const PROFILE_FILL_COOLDOWN_MS = 3 * 60_000;

export type ProfileFillStop = 'user' | 'limit' | 'stagnant' | 'not-profile' | 'cooldown';

export interface ProfileFillResult {
  ok: boolean;
  added: number;
  stopped?: ProfileFillStop;
  /** stopped 为 cooldown 时，还要等多久（毫秒）。 */
  retryAfterMs?: number;
}

export interface ProfileFillStatus {
  running: boolean;
  /** 这一轮（或刚结束的那一轮）的博主；从没跑过时为 null。 */
  handle: string | null;
  /** 这一轮已经看到的新帖子数。 */
  added: number;
  /** 上一轮的结果。面板重开时那轮的响应已经没人接收，靠它给出同样的收尾提示。 */
  last: ProfileFillResult | null;
}

export const PROFILE_FILL_STOP_CLASS = 'fs-fill-stop';
/** 补全开始 / 进度 / 结束的广播：面板重开后靠它恢复状态，不用轮询。 */
export const PROFILE_FILL_UPDATED_MESSAGE = 'feedsieve:profile-fill-updated';

const STOP_LABEL = {
  zh: '停止补全',
  en: 'Stop completing',
} as const;

/** 当前页面是不是这个博主的主页（/handle，不含子路径）。 */
export function isProfilePath(path: string, handle: string): boolean {
  return new RegExp(`^/${handle.replace(/[^a-z0-9_]/gi, '')}/?$`, 'i').test(path);
}

/**
 * 当前页面上能看到的帖子 ID。
 * X 的列表会回收 DOM（滚过去之后旧 article 会被移走），所以不能用 article 数量判断
 * 「这一批加载没有」——只能把滚动过程中见到的 ID 累积起来看有没有新面孔。
 */
export function collectPostIds(): Set<string> {
  const ids = new Set<string>();
  for (const article of document.querySelectorAll(tweetSelectors.article)) {
    const href = article.querySelector('a[href*="/status/"]')?.getAttribute('href');
    const match = href?.match(/\/status\/(\d+)/);
    if (match) ids.add(match[1]!);
  }
  return ids;
}

/** 直接滚到页面底部（等同按 End 键），让 X 加载下一批。 */
function scrollToBottom(): void {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
}

export function createProfileFill(
  options: {
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    /** 页面上的停止按钮文案跟随界面语言。 */
    getLanguage?: () => UiLanguage;
    /** 开始 / 进度 / 结束时通知扩展页（popup / 侧边栏）。 */
    onStatus?: (status: ProfileFillStatus) => void;
  } = {},
) {
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => window.setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  let running = false;
  let stopRequested = false;
  let runningHandle: string | null = null;
  let runningAdded = 0;
  /** 上一轮补全的结果：面板重开时那一轮的响应已经没人接收。 */
  let lastResult: ProfileFillResult | null = null;
  /** 每个博主上次开始补全的时间：同一个主页短时间内不重复刷分页。 */
  const lastRunAt = new Map<string, number>();
  /**
   * 页面上的停止按钮：补全期间常驻，不依赖扩展面板是否还开着。
   * 面板关掉 / 换栏目后，这是用户唯一能点到的停止入口。
   */
  let stopButton: HTMLButtonElement | null = null;
  /** 按钮上已经画出的新增数；和 runningAdded 相同就不重写 DOM。 */
  let shownAdded = -1;

  function emitStatus(): void {
    // X 重渲染时把按钮一起换掉了就补回来：停止入口不能因为页面重画而消失
    if (running && !stopButton?.isConnected) showStopButton();
    options.onStatus?.({
      running,
      handle: runningHandle,
      added: runningAdded,
      last: lastResult,
    });
  }

  function renderStopButton(): void {
    if (!stopButton || shownAdded === runningAdded) return;
    shownAdded = runningAdded;
    const label = STOP_LABEL[options.getLanguage?.() ?? 'zh'];
    const text = document.createElement('span');
    text.textContent = label;
    const parts: HTMLElement[] = [text];
    if (runningAdded > 0) {
      const count = document.createElement('span');
      count.className = 'fs-fill-stop-count';
      count.textContent = `+${runningAdded}`;
      parts.push(count);
    }
    stopButton.replaceChildren(...parts);
    stopButton.setAttribute('aria-label', label);
  }

  function showStopButton(): void {
    if (stopButton?.isConnected) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = PROFILE_FILL_STOP_CLASS;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      stopRequested = true;
      // 立刻收起：滚动循环最多再走完当前这 150ms 的等待
      hideStopButton();
    });
    document.body.appendChild(button);
    stopButton = button;
    shownAdded = -1;
    renderStopButton();
  }

  function hideStopButton(): void {
    stopButton?.remove();
    stopButton = null;
    shownAdded = -1;
  }

  /** 页面在后台时不滚也不查；切回前台再继续。等 visibilitychange，不依赖被节流的定时器。 */
  async function waitForVisible(): Promise<void> {
    while (document.hidden && !stopRequested) {
      await new Promise<void>((resolve) => {
        function wake(): void {
          document.removeEventListener('visibilitychange', wake);
          window.clearTimeout(timer);
          resolve();
        }
        // 兜底：即使事件没送来，一秒后也重新看一眼
        const timer = window.setTimeout(wake, 1_000);
        document.addEventListener('visibilitychange', wake);
      });
    }
  }

  async function fill(rawHandle: string): Promise<ProfileFillResult> {
    const handle = rawHandle.toLowerCase();
    if (running) return { ok: false, added: 0, stopped: 'user' };
    if (!handle || !isProfilePath(location.pathname, handle)) {
      return { ok: false, added: 0, stopped: 'not-profile' };
    }
    const last = lastRunAt.get(handle);
    if (last !== undefined && now() - last < PROFILE_FILL_COOLDOWN_MS) {
      return {
        ok: false,
        added: 0,
        stopped: 'cooldown',
        retryAfterMs: PROFILE_FILL_COOLDOWN_MS - (now() - last),
      };
    }
    lastRunAt.set(handle, now());
    running = true;
    stopRequested = false;
    runningHandle = handle;
    runningAdded = 0;
    lastResult = null;
    showStopButton();
    emitStatus();
    let startedAt = now();
    const seen = collectPostIds();
    const beforeCount = seen.size;
    let stagnant = 0;
    let stopped: ProfileFillStop = 'limit';
    let navigatedAway = false;
    try {
      // 正常会由 stagnant 结束；这里的时长只防页面永远加载不完
      while (now() - startedAt < PROFILE_FILL_MAX_MS) {
        if (stopRequested) {
          stopped = 'user';
          break;
        }
        // 后台标签页里不滚，等用户切回来；这段暂停不算进保险丝
        const pausedAt = now();
        await waitForVisible();
        startedAt += now() - pausedAt;
        if (stopRequested) {
          stopped = 'user';
          break;
        }
        // X 是单页应用：中途点去别的页面时，不能接着把新页面滚到底
        if (!isProfilePath(location.pathname, handle)) {
          navigatedAway = true;
          stopped = 'not-profile';
          break;
        }
        // 直接到底，等 X 加载完这一批再继续
        scrollToBottom();
        // 等 X 把这一批加载出来：加载快就立刻继续，最多等 1.2 秒
        let grew = false;
        const maxPolls = Math.ceil(PROFILE_FILL_WAIT_MS / PROFILE_FILL_POLL_MS);
        for (let poll = 0; poll < maxPolls; poll++) {
          await sleep(PROFILE_FILL_POLL_MS);
          if (stopRequested) break;
          // 中途切到后台：先停手，回到循环顶部等页面可见
          if (document.hidden) break;
          // 只有「新出现的帖子 ID」才算这一批有收获；scrollHeight 会因渲染/推荐位变化，
          // 拿它判断容易空跑
          for (const id of collectPostIds()) {
            if (!seen.has(id)) {
              seen.add(id);
              grew = true;
            }
          }
          if (grew) {
            runningAdded = Math.max(0, seen.size - beforeCount);
            renderStopButton();
            emitStatus();
            break;
          }
        }
        if (stopRequested) {
          stopped = 'user';
          break;
        }
        // 这一批是在后台被中断的，不算空转
        if (document.hidden) continue;
        // 连续多批没有新帖子就当作到底
        stagnant = grew ? 0 : stagnant + 1;
        if (stagnant >= PROFILE_FILL_STAGNANT_LIMIT) {
          stopped = 'stagnant';
          break;
        }
      }
    } finally {
      running = false;
      // handle 留到下一轮开始再换：收尾广播要带着博主，面板才认得出这是自己看的那一轮
      hideStopButton();
    }
    lastResult = {
      ok: !navigatedAway,
      added: Math.max(0, seen.size - beforeCount),
      stopped,
    };
    emitStatus();
    return lastResult;
  }

  return {
    fill,
    stop: (): void => {
      stopRequested = true;
      // 扩展重载 / 关掉主页模块时也把按钮撤掉，别在页面上留一个点不动的死按钮
      hideStopButton();
    },
    /** 给面板 / 消息路由查询：面板重开时恢复「停止」状态，不用再点一次。 */
    status: (): ProfileFillStatus => ({
      running,
      handle: runningHandle,
      added: runningAdded,
      last: lastResult,
    }),
  };
}

export type ProfileFill = ReturnType<typeof createProfileFill>;
