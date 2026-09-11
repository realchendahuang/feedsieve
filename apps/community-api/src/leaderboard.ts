/**
 * 打野排位赛：击杀事件、赛季、榜单聚合与懒重算。
 *
 * 计分完全由服务端从共识数据派生，客户端报数不作数：
 * - 开火 = active_labels 中 label='blocked' 的当前票（每安装每账号一票）。
 * - 确认击杀 = 账号收敛为 strong（净票 >= communityNetThreshold）且不在
 *   维护者白名单。consensus_events 是「当前处于共识内」的锚点：达标时刻
 *   写入、翻案回落时删除。确认发生在赛季窗口内且猎手当前仍投 blocked 票
 *   → +1。
 * - 首杀 = 账号最早的上报安装，且上报时间落在同一窗口 → 额外 +1。
 * - 误伤 = 当前票命中 verified（抢救净票 >= 同阈值）或维护者白名单 → 扣分。
 *   误伤不设窗口：白名单 / 翻案生效即全量结账。
 *
 * 聚合结果写 meta 缓存，脏标记懒重算（markSnapshotDirty 同模式）——没人
 * 访问时零聚合开销，写路径（票变化 / 事件变化 / 档案修改 / 赛季结算）只打
 * 标记。结算（赛季跨周）由 cron 消费。
 */

import { POLICY } from './reports';

export const LEADERBOARD = {
  killScore: 1,
  firstBloodScore: 1,
  falsePositivePenalty: 2,
  /** 结榜称号（如「猎黄人」）要求的命中率与最少开火数 */
  accuracyFloorForTitle: 0.8,
  minShotsForTitle: 10,
  /** 榜单展示行数上限；缓存保存全量（供 me 定位） */
  topSize: 200,
  /** 缓存最大新鲜期（秒）；脏标记立即重算，否则最多陈旧这么久 */
  cacheMaxAgeSeconds: 90,
  /** 全量聚合最小间隔（秒）：脏标记被刷屏时榜单最多陈旧这么久，换取确定性的 CPU 上限 */
  minRecomputeIntervalSeconds: 300,
  /**
   * 称号阶梯：按累计确认击杀（全赛季合计）晋升、只升不降。阈值是数据，
   * 上线后按玩家分布调；阶梯与词义见 docs/HUNTING.md §6。
   */
  titles: [
    { kills: 1, name: '滤福娃' },
    { kills: 10, name: '鞭福娃' },
    { kills: 100, name: '滤福侠' },
    { kills: 500, name: '鞭福侠' },
    { kills: 1000, name: '滤福王' },
    { kills: 2000, name: '鞭福王' },
    { kills: 5000, name: '滤福王中王' },
    { kills: 10000, name: '鞭福王中王' },
  ],
} as const;

type TitleLadder = (typeof LEADERBOARD)['titles'][number];

/** 由累计击杀派生阶梯称号（0 杀无称号；周结算称号 title 列独立并存） */
export function ladderTitle(careerKills: number): string | null {
  let earned: TitleLadder | null = null;
  for (const tier of LEADERBOARD.titles) {
    if (careerKills >= tier.kills) earned = tier;
    else break;
  }
  return earned?.name ?? null;
}

export interface SeasonWindow {
  id: number;
  starts_at: number;
  ends_at: number;
}

export interface HunterRow {
  id: string;
  name: string;
  bio: string | null;
  /** 周结算发放的永久荣誉称号（猎黄人），不清除 */
  title: string | null;
  /** 称号阶梯派生头衔（按累计击杀），随排名流动升级 */
  tier: string | null;
  /** 累计确认击杀（全赛季合计，称号阶梯依据） */
  career_kills: number;
  x_handle: string | null;
  email_verified: boolean;
  kills: number;
  first_bloods: number;
  false_positives: number;
  shots: number;
  score: number;
  accuracy: number;
}

export interface SeasonChampion {
  id: string;
  name: string;
  kills: number;
  accuracy: number;
}

export interface LeaderboardData {
  computed_at: number;
  /** 周榜的赛季窗口；总榜为 null */
  season: SeasonWindow | null;
  rows: HunterRow[];
  /** 最近一个已结算赛季（页脚「上届冠军」） */
  last_season?: { id: number; champions: SeasonChampion[] };
}

/** 匿名猎手展示名：installation 哈希前 6 位，如 猎手#A3F2C1 */
export function hunterDisplayName(installHash: string, displayName: string | null): string {
  const trimmed = displayName?.trim();
  if (trimmed) return trimmed;
  return `猎手#${installHash.slice(0, 6).toUpperCase()}`;
}

/** me 高亮标识：加盐哈希前 12 位 hex，不可逆、可进 URL */
export function mePrefix(installHash: string): string {
  return installHash.slice(0, 12);
}

// D1 batch 与单条查询的绑定参数上限一致，按 100 分片。
const D1_CHUNK = 100;

const DIRTY_KEY = 'leaderboard_dirty';
const CACHE_KEY = 'leaderboard_cache';
/** 总榜独立缓存键（同口径无时间窗） */
const CACHE_KEY_ALL = 'leaderboard_cache_all';
/** 上次全量聚合时间（meta）；节流窗口内即便脏标记已置也不重算，防重算滥用 */
const LAST_RECOMPUTE_KEY = 'leaderboard_last_recompute_at';

export async function markLeaderboardDirty(env: Cloudflare.Env): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO meta (key, value) VALUES (?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
    .bind(DIRTY_KEY, String(Math.floor(Date.now() / 1000)))
    .run();
}

async function clearLeaderboardDirty(env: Cloudflare.Env, value: string): Promise<void> {
  // 值不匹配说明读取后有新变更：不清，留给下次重算。
  await env.DB.prepare('DELETE FROM meta WHERE key = ?1 AND value = ?2')
    .bind(DIRTY_KEY, value)
    .run();
}

/**
 * ISO 周（UTC 周一 00:00 为界）。id = isoYear * 100 + week，如 202637。
 * 周四判定法：周四落在哪一年，这一周就属于哪一年。
 */
export function isoWeek(now: Date): SeasonWindow {
  const dayZero = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const monday = new Date(dayZero);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const startsAt = Math.floor(monday.getTime() / 1000);
  const thursday = new Date(monday.getTime() + 3 * 86400000);
  const isoYear = thursday.getUTCFullYear();
  const jan4 = Date.UTC(isoYear, 0, 4);
  const week1Monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * 86400000;
  const week = Math.floor((monday.getTime() - week1Monday) / (7 * 86400000)) + 1;
  return { id: isoYear * 100 + week, starts_at: startsAt, ends_at: startsAt + 7 * 86400 };
}

/** 榜单读取时惰性保证「当前窗口」赛季行存在（结算由 cron 负责）。 */
export async function ensureCurrentSeason(env: Cloudflare.Env): Promise<SeasonWindow> {
  const season = isoWeek(new Date());
  await env.DB.prepare(
    `INSERT INTO seasons (id, starts_at, ends_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(id) DO NOTHING`,
  )
    .bind(season.id, season.starts_at, season.ends_at)
    .run();
  return season;
}

export interface ConsensusTransition {
  strong: boolean;
  xUserId: string | null;
}

/**
 * 把一次状态收敛的结果同步进 consensus_events：
 * 进入 strong 且不在白名单 → 记/刷新达标时刻；跌出（回落或进白名单）→ 删除。
 * 幂等：事件表本就是「当前共识内」的镜像。有实际增删时打榜单脏标记。
 */
export async function syncConsensusEvents(
  env: Cloudflare.Env,
  transitions: Map<string, ConsensusTransition>,
): Promise<void> {
  if (transitions.size === 0) return;
  const handles = [...transitions.keys()];
  const existing = new Set<string>();
  const whitelisted = new Set<string>();
  const statements: D1PreparedStatement[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (let index = 0; index < handles.length; index += D1_CHUNK) {
    const chunk = handles.slice(index, index + D1_CHUNK);
    const inClause = chunk.map((_, offset) => `?${offset + 1}`).join(', ');
    const [events, whitelist] = await Promise.all([
      env.DB.prepare(`SELECT handle FROM consensus_events WHERE handle IN (${inClause})`)
        .bind(...chunk)
        .all<{ handle: string }>(),
      env.DB.prepare(
        `SELECT handle FROM maintainer_whitelist WHERE active = 1 AND handle IN (${inClause})`,
      )
        .bind(...chunk)
        .all<{ handle: string }>(),
    ]);
    for (const row of events.results) existing.add(row.handle);
    for (const row of whitelist.results) whitelisted.add(row.handle);
  }

  for (const [handle, transition] of transitions) {
    const shouldCount = transition.strong && !whitelisted.has(handle);
    if (shouldCount && !existing.has(handle)) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO consensus_events (handle, x_user_id, confirmed_at, updated_at)
           VALUES (?1, ?2, ?3, ?3)
           ON CONFLICT(handle) DO UPDATE SET
             x_user_id = excluded.x_user_id,
             confirmed_at = excluded.confirmed_at,
             updated_at = excluded.updated_at`,
        )
          .bind(handle, transition.xUserId, now),
      );
    } else if (!shouldCount && existing.has(handle)) {
      statements.push(
        env.DB.prepare('DELETE FROM consensus_events WHERE handle = ?1').bind(handle),
      );
    }
  }

  if (statements.length > 0) {
    for (let index = 0; index < statements.length; index += D1_CHUNK) {
      await env.DB.batch(statements.slice(index, index + D1_CHUNK));
    }
    await markLeaderboardDirty(env);
  }
}

/**
 * 一次榜单聚合。season 非空 = 周榜（各维度限赛季窗口）；season 为 null =
 * 总榜（同口径、不设时间窗，无首杀概念）。纯读聚合 + 猎手档案点查。
 */
async function aggregateLeaderboard(
  env: Cloudflare.Env,
  season: SeasonWindow | null,
): Promise<{ rows: HunterRow[] }> {
  const since = season ? Math.floor(season.starts_at) : null;
  // 开火数/误伤以 reports 拉黑证据为准（append-only）：先拉黑后改判的历史
  // 不会从战报里消失——打错的野同样要结账；击杀才要求当前仍投 blocked 票。
  const [shots, kills, firstBloodRows, falsePositives, careerKills] = await Promise.all([
    (since
      ? env.DB.prepare(
          `SELECT installation_id AS iid, COUNT(*) AS n FROM reports
           WHERE created_at >= ?1 GROUP BY installation_id`,
        ).bind(since)
      : env.DB.prepare(
          `SELECT installation_id AS iid, COUNT(*) AS n FROM reports
           GROUP BY installation_id`,
        )
    ).all<{ iid: string; n: number }>(),
    (since
      ? env.DB.prepare(
          `SELECT l.installation_id AS iid, COUNT(*) AS n
           FROM active_labels l
           JOIN accounts a ON a.handle = l.handle AND a.status = 'strong'
           JOIN consensus_events e ON e.handle = l.handle
           LEFT JOIN maintainer_whitelist w ON w.handle = l.handle AND w.active = 1
           WHERE l.label = 'blocked' AND w.handle IS NULL AND e.confirmed_at >= ?1
           GROUP BY l.installation_id`,
        ).bind(since)
      : env.DB.prepare(
          `SELECT l.installation_id AS iid, COUNT(*) AS n
           FROM active_labels l
           JOIN accounts a ON a.handle = l.handle AND a.status = 'strong'
           JOIN consensus_events e ON e.handle = l.handle
           LEFT JOIN maintainer_whitelist w ON w.handle = l.handle AND w.active = 1
           WHERE l.label = 'blocked' AND w.handle IS NULL
           GROUP BY l.installation_id`,
        )
    ).all<{ iid: string; n: number }>(),
    // 首杀：账号最早的上报安装（SQLite min 聚合行携带 bare column），
    // 上报时间也要落在同一窗口；白名单一票否决同样适用于首杀。总榜不发首杀。
    since
      ? env.DB.prepare(
          `SELECT handle, installation_id AS iid, MIN(created_at) AS first_at
           FROM reports
           WHERE handle IN (
             SELECT e.handle FROM consensus_events e
             LEFT JOIN maintainer_whitelist w ON w.handle = e.handle AND w.active = 1
             WHERE e.confirmed_at >= ?1 AND w.handle IS NULL
           )
           GROUP BY handle`,
        )
          .bind(since)
          .all<{ iid: string; first_at: number }>()
      : Promise.resolve({ results: [] as Array<{ iid: string; first_at: number }> }),
    (since
      ? env.DB.prepare(
          `SELECT r.installation_id AS iid, COUNT(*) AS n
           FROM reports r
           JOIN accounts a ON a.handle = r.handle
           LEFT JOIN maintainer_whitelist w ON w.handle = r.handle AND w.active = 1
           WHERE r.created_at >= ?1
             AND (a.rescue_count - a.report_count >= ?2 OR w.handle IS NOT NULL)
           GROUP BY r.installation_id`,
        ).bind(since, POLICY.communityNetThreshold)
      : env.DB.prepare(
          `SELECT r.installation_id AS iid, COUNT(*) AS n
           FROM reports r
           JOIN accounts a ON a.handle = r.handle
           LEFT JOIN maintainer_whitelist w ON w.handle = r.handle AND w.active = 1
           WHERE a.rescue_count - a.report_count >= ?1 OR w.handle IS NOT NULL
           GROUP BY r.installation_id`,
        ).bind(POLICY.communityNetThreshold)
    ).all<{ iid: string; n: number }>(),
    // 累计击杀（称号阶梯依据）：与周榜击杀同口径、不设时间窗
    env.DB.prepare(
      `SELECT l.installation_id AS iid, COUNT(*) AS n
       FROM active_labels l
       JOIN accounts a ON a.handle = l.handle AND a.status = 'strong'
       JOIN consensus_events e ON e.handle = l.handle
       LEFT JOIN maintainer_whitelist w ON w.handle = l.handle AND w.active = 1
       WHERE l.label = 'blocked' AND w.handle IS NULL
       GROUP BY l.installation_id`,
    ).all<{ iid: string; n: number }>(),
  ]);

  const shotsBy = new Map(shots.results.map((row) => [row.iid, row.n] as const));
  const killsBy = new Map(kills.results.map((row) => [row.iid, row.n] as const));
  const fpBy = new Map(falsePositives.results.map((row) => [row.iid, row.n] as const));
  const careerKillsBy = new Map(careerKills.results.map((row) => [row.iid, row.n] as const));
  const firstBloodsBy = new Map<string, number>();
  if (season) {
    for (const row of firstBloodRows.results) {
      if (row.first_at >= season.starts_at) {
        firstBloodsBy.set(row.iid, (firstBloodsBy.get(row.iid) ?? 0) + 1);
      }
    }
  }

  const hunters = [...shotsBy.keys()];
  const profilesBy = new Map<string, { display_name: string | null; bio: string | null; title: string | null; x_handle: string | null; email_verified_at: number | null }>();
  for (let index = 0; index < hunters.length; index += D1_CHUNK) {
    const chunk = hunters.slice(index, index + D1_CHUNK);
    const rows = await env.DB.prepare(
      `SELECT id, display_name, bio, title, x_handle, email_verified_at
       FROM installations WHERE id IN (${chunk.map(() => '?').join(', ')})`,
    )
      .bind(...chunk)
      .all<{ id: string; display_name: string | null; bio: string | null; title: string | null; x_handle: string | null; email_verified_at: number | null }>();
    for (const row of rows.results) profilesBy.set(row.id, row);
  }

  const ranked: HunterRow[] = hunters.map((iid) => {
    const killCount = killsBy.get(iid) ?? 0;
    const firstBloods = firstBloodsBy.get(iid) ?? 0;
    const fps = fpBy.get(iid) ?? 0;
    const shotCount = shotsBy.get(iid) ?? 0;
    const profile = profilesBy.get(iid);
    const careerKillCount = careerKillsBy.get(iid) ?? 0;
    return {
      id: iid,
      name: hunterDisplayName(iid, profile?.display_name ?? null),
      bio: profile?.bio ?? null,
      title: profile?.title ?? null,
      tier: ladderTitle(careerKillCount),
      career_kills: careerKillCount,
      x_handle: profile?.x_handle ?? null,
      email_verified: profile?.email_verified_at != null,
      kills: killCount,
      first_bloods: firstBloods,
      false_positives: fps,
      shots: shotCount,
      score:
        killCount * LEADERBOARD.killScore +
        firstBloods * LEADERBOARD.firstBloodScore -
        fps * LEADERBOARD.falsePositivePenalty,
      accuracy: shotCount > 0 ? killCount / shotCount : 0,
    };
  });
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      b.kills - a.kills ||
      b.accuracy - a.accuracy ||
      (a.id < b.id ? -1 : 1),
  );
  return { rows: ranked };
}

/**
 * 榜单读取（懒重算）：脏标记或缓存过期（> cacheMaxAgeSeconds / 赛季已切换）
 * 时现场聚合并写回；否则直接回缓存。scope='week'（默认）周榜，
 * scope='all' 总榜（独立缓存键、同口径无时间窗、无首杀）。
 */
export async function getLeaderboard(
  env: Cloudflare.Env,
  scope: 'week' | 'all' = 'week',
): Promise<LeaderboardData> {
  // 赛季窗口纯本地派生：热路径（直接回缓存）零写入。赛季行只在真的要
  // 重算时才落库，否则榜单每被读一次就向 D1 白写一行。
  const season = scope === 'week' ? isoWeek(new Date()) : null;
  const cacheKey = scope === 'week' ? CACHE_KEY : CACHE_KEY_ALL;
  const now = Math.floor(Date.now() / 1000);
  const metaRows = await env.DB.prepare(
    'SELECT key, value FROM meta WHERE key IN (?1, ?2, ?3)',
  )
    .bind(DIRTY_KEY, cacheKey, LAST_RECOMPUTE_KEY)
    .all<{ key: string; value: string }>();
  const byKey = new Map(metaRows.results.map((row) => [row.key, row.value] as const));
  const dirtyValue = byKey.get(DIRTY_KEY);
  const cacheRow = byKey.get(cacheKey);
  const lastRecomputeRow = byKey.get(LAST_RECOMPUTE_KEY);

  let cache = parseCache(cacheRow);
  const expired =
    cache == null ||
    (season != null && cache.season?.id !== season.id) ||
    now - cache.computed_at > LEADERBOARD.cacheMaxAgeSeconds;
  if (dirtyValue == null && !expired && cache != null) {
    return cache;
  }

  // 节流：/v1/leaderboard 是公开端点，脏标记可以被客户端投票不断刷新，
  // 无节流时攻击者可用恒定重算驱动全表聚合。最小聚合间隔独立于脏标记，
  // 窗口内即使脏也回陈旧缓存（冷启动无缓存、或赛季已切换时例外，必须算）。
  const lastRecompute = Number(lastRecomputeRow ?? 0);
  if (
    cache != null &&
    (season == null || cache.season?.id === season.id) &&
    Number.isFinite(lastRecompute) &&
    now - lastRecompute < LEADERBOARD.minRecomputeIntervalSeconds
  ) {
    return cache;
  }

  const { rows } = await aggregateLeaderboard(env, season);
  if (season) await ensureCurrentSeason(env);
  cache = {
    computed_at: now,
    season,
    rows,
    last_season: season != null ? await lastSettledSeason(env) : undefined,
  };
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO meta (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
      .bind(cacheKey, JSON.stringify(cache)),
    env.DB.prepare(
      `INSERT INTO meta (key, value) VALUES (?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
      .bind(LAST_RECOMPUTE_KEY, String(now)),
  ]);
  if (dirtyValue != null) await clearLeaderboardDirty(env, dirtyValue);
  return cache;
}

async function lastSettledSeason(
  env: Cloudflare.Env,
): Promise<LeaderboardData['last_season']> {
  const row = await env.DB.prepare(
    `SELECT id, top_json FROM seasons
     WHERE settled_at IS NOT NULL
     ORDER BY settled_at DESC LIMIT 1`,
  )
    .first<{ id: number; top_json: string | null }>();
  if (!row) return undefined;
  let champions: SeasonChampion[];
  try {
    const parsed = row.top_json ? (JSON.parse(row.top_json) as { champions?: SeasonChampion[] }) : null;
    champions = Array.isArray(parsed?.champions) ? parsed!.champions : [];
  } catch {
    champions = [];
  }
  return { id: row.id, champions };
}

function parseCache(raw: string | undefined): LeaderboardData | null {  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LeaderboardData;
    return parsed && typeof parsed.computed_at === 'number' && Array.isArray(parsed.rows)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/**
 * cron：结算所有已到期但未结算的赛季。用该赛季自己的窗口做最终聚合
 * （与当前缓存隔离，不回写榜单缓存），Top3 且命中率达标、开火数足够的
 * 猎手授予永久称号。返回结算的赛季数。
 */
export async function settleDueSeasons(env: Cloudflare.Env): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const due = await env.DB.prepare(
    `SELECT id, starts_at, ends_at FROM seasons
     WHERE settled_at IS NULL AND ends_at <= ?1
     ORDER BY starts_at ASC LIMIT 10`,
  )
    .bind(now)
    .all<{ id: number; starts_at: number; ends_at: number }>();
  let settled = 0;
  for (const row of due.results) {
    const season: SeasonWindow = { id: row.id, starts_at: row.starts_at, ends_at: row.ends_at };
    const { rows } = await aggregateLeaderboard(env, season);
    const champions = rows
      .slice(0, 3)
      .filter(
        (entry) =>
          entry.accuracy >= LEADERBOARD.accuracyFloorForTitle &&
          entry.shots >= LEADERBOARD.minShotsForTitle,
      )
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        kills: entry.kills,
        accuracy: Math.round(entry.accuracy * 100) / 100,
      }));
    const statements = champions.map((champion) =>
      env.DB.prepare('UPDATE installations SET title = ?2 WHERE id = ?1').bind(champion.id, TITLE),
    );
    statements.push(
      env.DB.prepare('UPDATE seasons SET settled_at = ?2, top_json = ?3 WHERE id = ?1').bind(
        season.id,
        now,
        JSON.stringify({ season_id: season.id, settled_at: now, champions }),
      ),
    );
    await env.DB.batch(statements);
    settled++;
  }
  if (settled > 0) await markLeaderboardDirty(env);
  return settled;
}

/** 结榜发放的荣誉称号（周赛季 Top3 + 命中率达标） */
export const TITLE = '猎黄人';
