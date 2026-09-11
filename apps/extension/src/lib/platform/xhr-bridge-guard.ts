/**
 * MAIN-world 桥数据消毒（review F1：xhr-bridge 事件伪造防御）。
 *
 * `feedsieve:xhr-items` 派发在两个 world 共享的 document 上，任何在 x.com 页面
 * 执行的脚本都能伪造该事件。本模块把不可信输入收敛成一组严格校验过的基本类型
 * 字段：handle 必须是 1-15 位 [A-Za-z0-9_]（小写化），xUserId 必须是 1-20 位
 * 数字；非法条目整条静默丢弃，绝不进入存储或破坏性动作路径。
 *
 * 残余假设（无法在跨 world 边界根除）：能在 x.com 执行 JS 的攻击者本就能观测
 * 用户会话；消毒只把伪造数据的破坏力限制在「合法形态的数据」之内。因此拉黑等
 * 破坏性动作对缓存 id 另有信任策略（见 content.ts blockOne：detection /
 * community 来源的破坏性动作不信任缓存 id，执行期按 handle 现解析）。
 */

/** 严格 handle 形态：小写无 @，1-15 位字母数字下划线（与 X screen_name 规则一致）。 */
export const STRICT_HANDLE_RE = /^[a-z0-9_]{1,15}$/;

/** X rest_id 形态：纯数字 1-20 位。 */
export const X_USER_ID_RE = /^\d{1,20}$/;

/** 不可信输入 → 严格 handle；非法返回 null（静默丢弃语义）。 */
export function normalizeStrictHandle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^@+/, '').toLowerCase();
  return STRICT_HANDLE_RE.test(normalized) ? normalized : null;
}

/** 不可信输入 → 严格 rest_id；非法返回 undefined。 */
export function sanitizeXUserId(value: unknown): string | undefined {
  return typeof value === 'string' && X_USER_ID_RE.test(value) ? value : undefined;
}

// ---------- 时间线解析节流（性能，不涉及正确性） ----------

/**
 * X 会自动轮询首页时间线（HomeTimeline / HomeLatestTimeline），被动滚动时
 * 每次响应都在页面主线程整包 JSON.parse + 遍历，是扩展在 x.com 上最大的
 * 常驻开销。对这两个端点做按端点名的最小间隔节流：间隔内的重复响应直接
 * 跳过解析。
 *
 * 只降开销、不保关键数据：跳过的响应多半是同一批推文的重复轮询；即使恰好
 * 夹带新作者，黄框标注走 DOM、拉黑按 handle 现解析（blockOne 信任策略），
 * rest_id 缓存会在下一次未节流的解析里补齐。
 *
 * 明确不节流的端点：Following（分页 650ms 一页，跳页会断 cursor 链）、
 * TweetDetail / ListMembers / AccountSettings（低频单发，节流无收益还可能
 * 丢关键数据）。
 */
const THROTTLED_TIMELINE_ENDPOINTS = ['HomeTimeline', 'HomeLatestTimeline'] as const;

/** 同一端点两次解析的最小间隔（ms）。 */
export const TIMELINE_PARSE_THROTTLE_MS = 1000;

/** 该 URL 是否属于被节流的时间线端点；返回节流键（端点名）或 null（不节流）。 */
export function timelineParseThrottleKey(url: string): string | null {
  for (const key of THROTTLED_TIMELINE_ENDPOINTS) {
    if (url.includes(key)) return key;
  }
  return null;
}

export interface ParseThrottle {
  /** 该响应是否应被解析（节流窗口外 / 非时间线端点恒为 true）。 */
  allow(url: string, at?: number): boolean;
  /** 记录一次实际解析（只有真正解析过才 mark，否则节流永远不解除）。 */
  mark(url: string, at?: number): void;
}

/** 按端点名的解析节流器；now 可注入便于单测。 */
export function createParseThrottle(
  options: { intervalMs?: number; now?: () => number } = {},
): ParseThrottle {
  const intervalMs = options.intervalMs ?? TIMELINE_PARSE_THROTTLE_MS;
  const now = options.now ?? (() => Date.now());
  const lastParseAt = new Map<string, number>();
  return {
    allow(url: string, at: number = now()): boolean {
      const key = timelineParseThrottleKey(url);
      if (!key) return true;
      const last = lastParseAt.get(key);
      return last === undefined || at - last >= intervalMs;
    },
    mark(url: string, at: number = now()): void {
      const key = timelineParseThrottleKey(url);
      if (!key) return;
      lastParseAt.set(key, at);
    },
  };
}

export interface SanitizedBridgeData {
  /** handle -> rest_id 入库条目（全部通过严格校验） */
  idEntries: Array<{ handle: string; xUserId: string }>;
  /** 明确 following === true 的账号（本地关注保护） */
  followedEntries: Array<{ handle: string; xUserId?: string }>;
  /** 作者 bio（检测增强；handle 已小写去重） */
  bios: Array<{ handle: string; bio: string }>;
  /** 当前登录账号（严格校验后的小写 handle） */
  selfHandle?: string;
  isFollowingPage: boolean;
  /** Following 页全量账号（分页同步用） */
  following: Array<{ handle: string; xUserId?: string }>;
  followingCursor?: string;
  sourceUrl?: string;
}

/**
 * 把桥事件 detail（JSON 解析后的 unknown）收敛成可安全消费的子集。
 * 返回 null 表示整体形态非法（不是对象 / matchedEndpoints 不是字符串数组）。
 */
export function sanitizeBridgePayload(raw: unknown): SanitizedBridgeData | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.matchedEndpoints)) return null;
  const matchedEndpoints = data.matchedEndpoints.filter(
    (endpoint): endpoint is string => typeof endpoint === 'string',
  );

  const idEntries: SanitizedBridgeData['idEntries'] = [];
  const followedEntries: SanitizedBridgeData['followedEntries'] = [];
  const bios: SanitizedBridgeData['bios'] = [];
  const seenBios = new Set<string>();

  // timeline 响应：作者字段逐个校验，任一字段非法只丢该账号，不影响其余数据
  const tweets = Array.isArray(data.tweets) ? data.tweets : [];
  for (const tweet of tweets) {
    const author =
      tweet && typeof tweet === 'object' ? (tweet as { author?: unknown }).author : undefined;
    if (!author || typeof author !== 'object') continue;
    const raw = author as {
      handle?: unknown;
      xUserId?: unknown;
      bio?: unknown;
      following?: unknown;
    };
    const handle = normalizeStrictHandle(raw.handle);
    if (!handle) continue;
    const xUserId = sanitizeXUserId(raw.xUserId);
    if (xUserId) {
      idEntries.push({ handle, xUserId });
    }
    if (raw.following === true) {
      followedEntries.push({ handle, ...(xUserId ? { xUserId } : {}) });
    }
    if (typeof raw.bio === 'string' && raw.bio && !seenBios.has(handle)) {
      seenBios.add(handle);
      bios.push({ handle, bio: raw.bio });
    }
  }

  // list 成员：rest_id 必需（idEntries 的存量来源之一），非法成员整条丢弃
  const listMembers = Array.isArray(data.listMembers) ? data.listMembers : [];
  for (const member of listMembers) {
    const raw = member && typeof member === 'object' ? (member as Record<string, unknown>) : {};
    const handle = normalizeStrictHandle(raw.handle);
    const xUserId = sanitizeXUserId(raw.xUserId);
    if (handle && xUserId) {
      idEntries.push({ handle, xUserId });
    }
  }

  // following 数组：Following 页与 timeline 内嵌关系共用；id 可选
  const following: SanitizedBridgeData['following'] = [];
  const rawFollowing = Array.isArray(data.following) ? data.following : [];
  for (const account of rawFollowing) {
    const raw = account && typeof account === 'object' ? (account as Record<string, unknown>) : {};
    const handle = normalizeStrictHandle(raw.handle);
    if (!handle) continue;
    const xUserId = sanitizeXUserId(raw.xUserId);
    following.push({ handle, ...(xUserId ? { xUserId } : {}) });
    followedEntries.push({ handle, ...(xUserId ? { xUserId } : {}) });
    if (xUserId) {
      idEntries.push({ handle, xUserId });
    }
  }

  const selfHandle = normalizeStrictHandle(data.selfHandle) ?? undefined;
  const followingCursor =
    typeof data.followingCursor === 'string' && data.followingCursor.length > 0
      ? data.followingCursor
      : undefined;
  const sourceUrl =
    typeof data.sourceUrl === 'string' && data.sourceUrl.length > 0 ? data.sourceUrl : undefined;

  return {
    idEntries,
    followedEntries,
    bios,
    ...(selfHandle ? { selfHandle } : {}),
    isFollowingPage: matchedEndpoints.includes('Following'),
    following,
    ...(followingCursor ? { followingCursor } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}
