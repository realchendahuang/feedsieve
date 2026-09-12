/**
 * account_health 定向探活（#2 定稿方案第三层：cron-prober）。
 *
 * 服务端唯一会从数据中心 IP 出手探 X 的路径，节奏全部写死在这里：
 * - 每轮只拿两类目标：account_health 里非终态且最久没存活信号的（滚动抽样 ≤20），
 *   加上共识内但还没有健康记录的新账号（增量必验 ≤10）。
 * - 单请求级间隔（默认 1.2s + 抖动）+ 每轮上限 30，理论墙钟 <1 分钟，绝不并发轰。
 * - 429/5xx/网络失败不写状态（宁缺毋滥）；连续 3 次失败即熔断 6 小时，
 *   熔断状态在 meta 表持久化，宁可名单晚刷新也不能让 X 风控看到数据中心的bots。
 * - 注销/冻结一律按 UserUnavailable 判 dead（终态），不会产生重复检查成本。
 */
import { recordHealthObservations, type HealthObservation } from './lib/account-health';
import { batchStatements } from './labels';

const META_KEY = 'account_health_probe';

interface ProbeBreakerState {
  disabled_until?: number;
  consecutive_failures?: number;
}

export const PROBER_POLICY = {
  maxPerRun: 30,
  staleLimit: 20,
  missingLimit: 10,
  interProbeDelayMs: 1200,
  requestTimeoutMs: 8000,
  consecutiveFailureTrip: 3,
  breakerCooldownMs: 6 * 60 * 60 * 1000,
} as const;

/** TBWL 同款 web 公共 bearer 与 UserByScreenName 形参（与 x-adapter resolve-user-id 同源） */
const USER_BY_SCREEN_NAME_QUERY_ID = '32pL5BWe9WKeSK1MoPvFQQ';
const USER_FEATURES = encodeURIComponent(
  '{"hidden_profile_subscriptions_enabled":true,"profile_label_improvements_pcf_label_in_post_enabled":true,"rweb_tipjar_consumption_enabled":true,"responsive_web_graphql_exclude_directive_enabled":true,"verified_phone_label_enabled":false,"subscriptions_verification_info_is_identity_verified_enabled":true,"subscriptions_verification_info_verified_since_enabled":true,"highlights_tweets_tab_ui_enabled":true,"responsive_web_twitter_article_notes_tab_enabled":true,"subscriptions_feature_can_gift_premium":true,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_skip_user_profile_image_extensions_enabled":false,"responsive_web_graphql_timeline_navigation_enabled":true,"longform_notetweets_inline_media_enabled":false,"longform_notetweets_rich_text_read_enabled":false,"communities_web_enable_tweet_community_results_fetch":false,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":false,"responsive_web_grok_analyze_button_fetch_trends_enabled":false,"tweet_awards_web_tipping_enabled":false,"articles_preview_enabled":false,"responsive_web_jetfuel_frame":false,"responsive_web_enhance_cards_enabled":false,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":false,"creator_subscriptions_quote_tweet_preview_enabled":false,"standardized_nudges_misinfo":false,"view_counts_everywhere_api_enabled":false,"rweb_video_timestamps_enabled":false,"responsive_web_grok_analyze_post_followups_enabled":false,"longform_notetweets_consumption_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":false,"responsive_web_grok_share_attachment_enabled":false,"responsive_web_grok_image_annotation_enabled":false,"c9s_tweet_anatomy_moderator_badge_enabled":false,"responsive_web_grok_analysis_button_from_backend":false,"responsive_web_edit_tweet_api_enabled":false,"premium_content_api_read_enabled":false,"responsive_web_twitter_article_tweet_consumption_enabled":false}',
);
const FIELD_TOGGLES = encodeURIComponent('{"withAuxiliaryUserLabels":false}');
/** 网页客户端公开匿名 bearer（与 x-adapter block.ts 同源；纯只读，凭据面为空） */
const X_WEB_BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

type ProbeResult = 'alive' | 'dead' | 'unknown';

interface ProbeTarget {
  handle: string;
  xUserId: string | null;
}

export interface ProbeRunStats {
  probed: number;
  alive: number;
  dead: number;
  unknown: number;
  guestTokenMissing: boolean;
  breakerOpened: boolean;
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });


async function readBreaker(env: Cloudflare.Env): Promise<ProbeBreakerState> {
  const row = await env.DB.prepare('SELECT value FROM meta WHERE key = ?1')
    .bind(META_KEY)
    .first<{ value: string }>();
  if (!row?.value) return {};
  try {
    return JSON.parse(row.value) as ProbeBreakerState;
  } catch {
    return {};
  }
}

async function writeBreaker(env: Cloudflare.Env, state: ProbeBreakerState): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO meta (key, value) VALUES (?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
    .bind(META_KEY, JSON.stringify(state))
    .run();
}

async function activateGuestToken(): Promise<string | null> {
  try {
    const response = await fetch('https://api.x.com/1.1/guest/activate.json', {
      method: 'POST',
      headers: {
        Authorization: X_WEB_BEARER,
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (compatible; FeedSieve-listbot/1.0)',
      },
      signal: AbortSignal.timeout(PROBER_POLICY.requestTimeoutMs),
    });
    if (!response.ok) {
      console.warn('[community-api] guest activate failed:', response.status);
      return null;
    }
    const body = (await response.json()) as { guest_token?: string };
    return typeof body.guest_token === 'string' ? body.guest_token : null;
  } catch {
    return null;
  }
}

/**
 * 单次探测分类。契约严守 resolve-user-id 的语义：
 * 只有 "响应确认账号不存在/不可用" 才判 dead；限流、网络、形状异常一律 unknown，
 * 绝不能在 X 契约迁移期把活账号误写成终态。
 */
async function probeOne(
  target: ProbeTarget,
  guestToken: string,
): Promise<{ result: ProbeResult; xUserId: string | null }> {
  const variables = encodeURIComponent(
    JSON.stringify({ screen_name: target.handle, withSafetyModeUserFields: true }),
  );
  const url =
    `https://x.com/i/api/graphql/${USER_BY_SCREEN_NAME_QUERY_ID}/UserByScreenName` +
    `?variables=${variables}&features=${USER_FEATURES}&fieldToggles=${FIELD_TOGGLES}`;
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: X_WEB_BEARER,
        'x-guest-token': guestToken,
        'x-twitter-active-user': 'yes',
        'x-twitter-client-language': 'en',
        'user-agent': 'Mozilla/5.0 (compatible; FeedSieve-listbot/1.0)',
      },
      signal: AbortSignal.timeout(PROBER_POLICY.requestTimeoutMs),
    });
    if (response.status === 429) {
      return { result: 'unknown', xUserId: null };
    }
    if (!response.ok) {
      return { result: 'unknown', xUserId: null };
    }
    const body = (await response.json()) as {
      errors?: Array<{ code?: number; message?: string }>;
      data?: { user?: { result?: { __typename?: string; rest_id?: string } } };
    };
    if (Array.isArray(body.errors) && body.errors.length > 0) {
      const limited = body.errors.some(
        (error) => error?.code === 88 || /rate limit/i.test(String(error?.message ?? '')),
      );
      if (limited) {
        return { result: 'unknown', xUserId: null };
      }
      // Guest 端对注销/封禁账号用 errors 表达（"User has been suspended" 等）；
      // 只有能从消息判断账号不再存在的才收敛成 dead，其余形状一律 unknown。
      const gone = body.errors.some((error) =>
        /suspend(ed)|not exist|unavailable|hasn['']t posted|deleted/i.test(
          String(error?.message ?? ''),
        ),
      );
      return { result: gone ? 'dead' : 'unknown', xUserId: null };
    }
    const result = body.data?.user?.result;
    if (result?.__typename === 'UserUnavailable') {
      return { result: 'dead', xUserId: null };
    }
    // data.user 缺失既可能是注销也可能是契约迁移/边缘响应：不确认就 unknown
    if (!result) {
      return { result: 'unknown', xUserId: null };
    }
    const restId = result.rest_id ? String(result.rest_id) : null;
    if (result.__typename === 'User' && restId) {
      // rest_id 每次都是权威回填：探测顺手把 id 写准
      return { result: 'alive', xUserId: restId };
    }
    return { result: 'unknown', xUserId: null };
  } catch {
    return { result: 'unknown', xUserId: null };
  }
}

/**
 * cron 入口：返回本轮统计（供测试断言）。探测目标两类拼接、总量 ≤ maxPerRun。
 * 熔断读 meta，写回也走 meta；本轮探测出的终态/存活一次性批量入库。
 */
export async function probeAccountHealthScheduled(env: Cloudflare.Env): Promise<ProbeRunStats> {
  const stats: ProbeRunStats = {
    probed: 0,
    alive: 0,
    dead: 0,
    unknown: 0,
    guestTokenMissing: false,
    breakerOpened: false,
  };
  const breaker = await readBreaker(env);
  const now = Date.now();
  if (breaker.disabled_until !== undefined && breaker.disabled_until > now) {
    return stats;
  }

  // 目标一：非终态且最久没信号的（滚动抽样；alive 的也允许低频重验，
  // updated_at 会刷新回到队尾）；目标二：共识内还没有健康记录的新账号。
  const stale = await env.DB.prepare(
    `SELECT handle, x_user_id AS xUserId FROM account_health
     WHERE state != 'dead' ORDER BY updated_at ASC LIMIT ?1`,
  )
    .bind(PROBER_POLICY.staleLimit)
    .all<ProbeTarget>();
  const missing = await env.DB.prepare(
    `SELECT c.handle AS handle, c.x_user_id AS xUserId FROM consensus_events c
     LEFT JOIN account_health h ON h.handle = c.handle
     WHERE h.handle IS NULL LIMIT ?1`,
  )
    .bind(PROBER_POLICY.missingLimit)
    .all<ProbeTarget>();

  const targets: ProbeTarget[] = [];
  const seen = new Set<string>();
  for (const target of [...stale.results, ...missing.results]) {
    if (!seen.has(target.handle)) {
      seen.add(target.handle);
      targets.push(target);
    }
    if (targets.length >= PROBER_POLICY.maxPerRun) break;
  }
  if (targets.length === 0) {
    return stats;
  }

  const guestToken = await activateGuestToken();
  if (!guestToken) {
    stats.unknown = targets.length;
    stats.guestTokenMissing = true;
    await bumpFailureBreaker(env, breaker, targets.length);
    return stats;
  }

  const observations: HealthObservation[] = [];
  for (const target of targets) {
    await wait(PROBER_POLICY.interProbeDelayMs + Math.floor(Math.random() * 400));
    const { result, xUserId } = await probeOne(target, guestToken);
    stats.probed += 1;
    if (result === 'unknown') {
      stats.unknown += 1;
      continue;
    }
    if (result === 'alive') stats.alive += 1;
    else stats.dead += 1;
    observations.push({
      handle: target.handle,
      xUserId: xUserId ?? target.xUserId,
      state: result,
      source: 'cron-prober',
    });
  }

  if (observations.length > 0) {
    await batchStatements(env, recordHealthObservations(env, observations, now));
  }

  const failures = stats.unknown;
  if (failures > 0) {
    await bumpFailureBreaker(env, breaker, failures);
  } else {
    await writeBreaker(env, { consecutive_failures: 0 });
  }
  return stats;
}

async function bumpFailureBreaker(
  env: Cloudflare.Env,
  breaker: ProbeBreakerState,
  added: number,
): Promise<void> {
  const consecutive = (breaker.consecutive_failures ?? 0) + added;
  if (consecutive >= PROBER_POLICY.consecutiveFailureTrip) {
    await writeBreaker(env, {
      disabled_until: Date.now() + PROBER_POLICY.breakerCooldownMs,
      consecutive_failures: 0,
    });
    console.warn('[community-api] account_health probe breaker opened (6h)');
    return;
  }
  await writeBreaker(env, { consecutive_failures: consecutive });
}
