import { getHotBoards, ingestObservations } from './hot';
import { ingestRuleHits } from './rule-hits';
import { chargeProfileRead, getProfile, ingestProfileObservations } from './profiles';
import { and, countDistinct, eq, sql } from 'drizzle-orm';
import { describeDbError, getDb, withDb } from './db/client';
import { accounts, activeLabels, meta } from './db/schema';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { isAdminHost } from './lib/hosts';
import { hashInstallationId, sha256Hex } from './lib/hash';
import { POLICY, processReportBatch, publicPolicy } from './reports';
import { processRescueBatch } from './rescues';
import {
  PUBLIC_BLOCKLIST_PACK,
  SNAPSHOT_DIRTY_KEY,
  SNAPSHOT_LATEST_KEY,
  SNAPSHOT_PACK,
} from './snapshot-keys';

/**
 * 低频模块的按需加载器。
 *
 * 快照读取、公示名单、AI 账号判定、入册申请、反馈样本、撤回落库这几族接口都不在
 * 上报主路径上，却各自带一坨依赖（生成/签名/YAML、共识、评级、分类推断）。顶层
 * import 会让每次 `/v1/*` 冷启动都替它们付求值成本——实测冷启动是这台 Worker 的
 * 主要 CPU 开销，所以改成命中时再加载。
 *
 * 失败不缓存 rejected promise：否则一次瞬时错误会把整台 isolate 永久钉死。
 */
function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () =>
    (cached ??= load().catch((error: unknown) => {
      cached = null;
      throw error;
    }));
}

const loadSnapshot = lazy(() => import('./snapshot'));
const loadRoster = lazy(() => import('./roster'));
const loadAiCheck = lazy(() => import('./ai-accounts/check'));
const loadAiJudge = lazy(() => import('./ai-accounts/judge'));
const loadAiVote = lazy(() => import('./ai-accounts/vote'));
const loadAiLookup = lazy(() => import('./ai-accounts/lookup'));
const loadAiReview = lazy(() => import('./ai-accounts/review'));
const loadLabels = lazy(() => import('./labels'));
const loadApplications = lazy(() => import('./applications'));
const loadTrainingSamples = lazy(() => import('./training-samples'));

function staticAssetRequest(request: Request): Request {
  // assets.not_found_handling = single-page-application resolves TanStack routes
  // to the shell while keeping the incoming URL intact.
  return request;
}

/** 管理台 / Agent 子应用；路由实体在 admin-routes.ts，按需加载。 */
type AdminApp = Awaited<ReturnType<typeof import('./admin-routes').createAdminApp>>;

/** Hono 的 executionCtx getter 在没有执行上下文时（单测里直接调 app.fetch）会抛错。 */
function executionCtxOf(c: Context) {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

/**
 * 上报三端点（reports / rescues / labels/retract）的统一收尾：
 * 置快照脏 + 读当前有效版本，两条 meta 语句并发发出。
 * 版本指针缺失（首次发布前）回退 getLatestSnapshotVersion 的全量兜底。
 */
async function markDirtyAndReadSnapshotVersion(env: Cloudflare.Env): Promise<string | null> {
  const db = getDb(env);
  const [, pointer] = await Promise.all([
    db
      .insert(meta)
      .values({ key: SNAPSHOT_DIRTY_KEY, value: String(Date.now()) })
      .onConflictDoUpdate({ target: meta.key, set: { value: sql`excluded.value` } }),
    db.select({ value: meta.value }).from(meta).where(eq(meta.key, SNAPSHOT_LATEST_KEY)),
  ]);
  return pointer[0]?.value ?? (await loadSnapshot()).getLatestSnapshotVersion(env);
}

export function createApp() {
  const app = new Hono<{
    Bindings: Cloudflare.Env;
    Variables: { maintainerEmail: string; agentIdentity: string };
  }>();

  // 扩展 content script 会跨域 POST /v1/*，必须放行预检；管理（/api/admin，
  // 同源 ASSETS 服务）与 Agent（脚本直连）家族不开跨域。
  // maxAge：不设时浏览器只缓存预检约 5 秒，扩展每 15 分钟一轮上报等于每轮都先发一次
  // OPTIONS（实测这类端点约四成五的 invocation 是预检）。设成一天后同一客户端只预检一次。
  app.use('/v1/*', cors({ maxAge: 86_400 }));

  // 管理 / Agent 接口的身份头（Cf-Access-Jwt-Assertion / X-Agent-Key）不属于标准
  // Authorization，Workers Cache 不会自动绕过——显式 no-store，防止管理/审计响应
  // 被共享缓存命中后泄露给其它请求（开启 cache.enabled 后的安全配套）。
  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  app.get('/healthz', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({
      ok: true,
      service: 'feedsieve-community-api',
      time: new Date().toISOString(),
    });
  });

  app.post(
    '/v1/training-samples',
    bodyLimit({ maxSize: 450_000, onError: (c) => c.json({ error: 'samples_too_large' }, 413) }),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      const result = await (
        await loadTrainingSamples()
      ).ingestTrainingSamples(
        c.env,
        await c.req.json().catch(() => null),
        c.req.header('cf-connecting-ip'),
      );
      return c.json(result.body, result.status);
    },
  );

  // 众包全站热榜：扩展后台上报用户正常浏览时 X 已经加载的公开帖子指标（见 hot.ts）
  app.post(
    '/v1/observations',
    bodyLimit({
      maxSize: 200_000,
      onError: (c) => c.json({ error: 'observations_too_large' }, 413),
    }),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      const result = await ingestObservations(
        c.env,
        await c.req.json().catch(() => null),
        c.req.header('cf-connecting-ip'),
      );
      return c.json(result.body, result.status);
    },
  );

  // 规则命中众包：本地规则打了黄框就匿名报一条（不是票，只作佐证与误伤统计，见 rule-hits.ts）
  app.post(
    '/v1/rule-hits',
    bodyLimit({
      maxSize: 60_000,
      onError: (c) => c.json({ error: 'rule_hits_too_large' }, 413),
    }),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      const result = await ingestRuleHits(
        c.env,
        await c.req.json().catch(() => null),
        c.req.header('cf-connecting-ip'),
      );
      return c.json(result.body, result.status);
    },
  );

  // AI 号账号级判定：扩展只上报 handle；判一次全体共享（见 ai-accounts/check.ts）
  app.post(
    '/v1/ai-accounts/check',
    bodyLimit({ maxSize: 2_000, onError: (c) => c.json({ error: 'request_too_large' }, 413) }),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      const result = await (
        await loadAiCheck()
      ).checkAiAccount(
        c.env,
        await c.req.json().catch(() => null),
        c.req.header('cf-connecting-ip'),
      );
      return c.json(result.body, result.status);
    },
  );

  // AI 号判定（证据直传）：扩展在本地从 with_replies 页抓回复后直接上报，服务端不经过 TikHub
  // （见 ai-accounts/judge.ts）。判一次全体共享；进公共名单需投票共识（见 ai-accounts/vote.ts）。
  app.post(
    '/v1/ai-accounts/judge',
    bodyLimit({ maxSize: 120_000, onError: (c) => c.json({ error: 'request_too_large' }, 413) }),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      const result = await (
        await loadAiJudge()
      ).judgeAiAccount(
        c.env,
        await c.req.json().catch(() => null),
        c.req.header('cf-connecting-ip'),
      );
      return c.json(result.body, result.status);
    },
  );

  // AI 号名单：可公开的 AI / 疑似账号，扩展同步到本机，在评论区标记 / 折叠（必须注册在 :handle 前面）
  app.get('/v1/ai-accounts/list', async (c) => {
    const body = JSON.stringify({ entries: await (await loadAiLookup()).listAiAccounts(c.env) });
    const etag = `"${(await sha256Hex(body)).slice(0, 32)}"`;
    c.header('Cache-Control', 'public, max-age=300, s-maxage=600');
    c.header('ETag', etag);
    if (c.req.header('if-none-match') === etag) return c.body(null, 304);
    return c.body(body, 200, { 'content-type': 'application/json' });
  });

  // AI 味检测在扩展里失败的次数（证据不足 / 太集中 / 用户停止 / 页面没数据）：只计数
  app.post(
    '/v1/ai-accounts/outcome',
    bodyLimit({ maxSize: 200, onError: (c) => c.json({ error: 'request_too_large' }, 413) }),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      const ok = await (
        await loadAiReview()
      ).recordClientOutcome(c.env, await c.req.json().catch(() => null));
      return ok ? c.body(null, 204) : c.json({ error: 'invalid_outcome' }, 400);
    },
  );

  // AI 号只读查询：主页「AI 味」Tab 直接显示已有结论和票数，不调第三方、不计额度
  app.get('/v1/ai-accounts/:handle', async (c) => {
    const result = await (await loadAiLookup()).lookupAiAccount(c.env, c.req.param('handle'));
    if (!result) {
      c.header('Cache-Control', 'no-store');
      return c.json({ error: 'invalid_handle' }, 400);
    }
    c.header('Cache-Control', 'public, max-age=30, s-maxage=60');
    return c.json(result);
  });

  // AI 号投票：是 AI / 是真人。≥3 独立安装 ai 票且过半才进公共名单（见 ai-accounts/vote.ts）。
  app.post(
    '/v1/ai-accounts/vote',
    bodyLimit({ maxSize: 2_000, onError: (c) => c.json({ error: 'request_too_large' }, 413) }),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      const result = await (
        await loadAiVote()
      ).voteAiAccount(c.env, await c.req.json().catch(() => null));
      return c.json(result.body, result.status);
    },
  );

  // 全站热榜：存好的榜最多 5 分钟重算一次；带 ETag，扩展再来取时没变化回 304
  app.get('/v1/hot', async (c) => {
    const boards = await getHotBoards(c.env);
    const etag = `"hot-${boards.generated_at}"`;
    c.header('Cache-Control', 'public, max-age=60, s-maxage=60');
    c.header('ETag', etag);
    const match = c.req.header('if-none-match');
    if (match && match.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag)) {
      return c.body(null, 304);
    }
    return c.json(boards);
  });

  // 主页洞察众包：扩展上报博主公开帖子的数字，服务端去重合并（见 profiles.ts）
  app.post(
    '/v1/profile-observations',
    bodyLimit({
      maxSize: 300_000,
      onError: (c) => c.json({ error: 'profile_observations_too_large' }, 413),
    }),
    async (c) => {
      c.header('Cache-Control', 'no-store');
      const result = await ingestProfileObservations(
        c.env,
        await c.req.json().catch(() => null),
        c.req.header('cf-connecting-ip'),
      );
      return c.json(result.body, result.status);
    },
  );

  // 增量拉取一个博主的帖子库：同一游标的请求走边缘缓存；
  // 不提供批量下载，一次只给一个博主，未命中缓存时每 IP 每天最多 PROFILE_READ_IP_DAILY_LIMIT 次
  app.get('/v1/profiles/:handle', async (c) => {
    const ip = c.req.header('cf-connecting-ip');
    if (!(await chargeProfileRead(c.env, ip))) {
      c.header('Cache-Control', 'no-store');
      return c.json({ error: 'rate_limited' }, 429);
    }
    const result = await getProfile(c.env, c.req.param('handle'), c.req.query('cursor'));
    if (!result) {
      c.header('Cache-Control', 'no-store');
      return c.json({ error: 'invalid_profile_request' }, 400);
    }
    // 首次全量（不带游标）最贵、而且同一个博主被很多人打开：边缘缓存 5 分钟；
    // 带游标的增量只缓存 1 分钟，一个人刚报上来的帖子，下一个人很快就能拿到
    c.header(
      'Cache-Control',
      c.req.query('cursor')
        ? 'public, max-age=30, s-maxage=60'
        : 'public, max-age=60, s-maxage=300',
    );
    return c.json(result);
  });

  app.post('/v1/reports', async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const result = await processReportBatch(c.env, body, c.req.header('cf-connecting-ip'));
    c.header('Cache-Control', 'no-store');
    if (!result.ok) {
      return c.json({ error: result.error }, result.httpStatus);
    }
    // 快照异步化：只落库并置脏，由 cron 每 30 分钟合并生成（两版至少隔 25 分钟，见 snapshot.ts
    // SNAPSHOT_MIN_INTERVAL_S）；响应返回当前有效版本。置脏+读版本并成一次 batch（见 markDirtyAndReadSnapshotVersion）。
    const snapshotVersion = await markDirtyAndReadSnapshotVersion(c.env);
    return c.json({
      policy: {
        formula: 'block_votes - false_positive_votes',
        min_net_votes: POLICY.communityNetThreshold,
        daily_report_limit: POLICY.dailyReportLimit,
      },
      results: result.results,
      snapshot_version: snapshotVersion,
    });
  });

  // 管理台（Cloudflare Access 身份）与 Agent 通道（X-Agent-Key）只有内部使用，
  // 路由表与中间件都在 admin-routes.ts。这里按需加载：扩展上报的冷启动不必求值
  // jose、后台业务模块与 dashboard——那是启动路径上最不值当的一部分。
  let adminApp: Promise<AdminApp> | null = null;
  const loadAdminApp = () =>
    (adminApp ??= import('./admin-routes').then((mod) => mod.createAdminApp()));
  app.all('/api/admin/*', async (c) =>
    (await loadAdminApp()).fetch(c.req.raw, c.env, executionCtxOf(c)),
  );
  app.all('/api/agent/*', async (c) =>
    (await loadAdminApp()).fetch(c.req.raw, c.env, executionCtxOf(c)),
  );

  // 旧的拼接 HTML 维护页已废弃；新的后台只通过受 Access 保护的独立域名提供。
  app.get('/maintainer', (c) => c.json({ error: 'admin_moved_to_access' }, 410));
  // 旧 Bearer-token 管理 API 也一并退役，不能成为 Access 的旁路。
  app.all('/admin/*', (c) => c.json({ error: 'admin_moved_to_access' }, 410));

  // 快照消费端点：manifest 短缓存，版本化文件按不可变缓存
  app.get('/v1/snapshots/latest', async (c) => {
    const latest = await (await loadSnapshot()).getLatestSnapshot(c.env);
    if (!latest) return c.json({ error: 'no_snapshot' }, 404);
    c.header('Cache-Control', 'public, max-age=300');
    return c.body(latest.manifest, 200, { 'content-type': 'application/json' });
  });

  // 官方暂停开关实时状态：不经快照日更节流，扩展在破坏性操作执行前实时查询。
  // 只读、无数据库访问；no-store 保证边缘缓存不摊薄应急时效。
  app.get('/v1/kill-switch', async (c) => {
    const killSwitch = (await loadSnapshot()).buildKillSwitch(
      c.env.DESTRUCTIVE_KILL_SWITCH,
      new Date().toISOString(),
    );
    c.header('Cache-Control', 'no-store');
    return c.json(killSwitch ?? { destructive_actions_disabled: false });
  });

  // 增量：两版不可变快照之间的差异，边缘缓存一年（每个机房每对版本只算一次）
  app.get('/v1/snapshots/delta/:from/:to', async (c) => {
    const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
    // 缓存键只用路径：带查询串绕不过缓存
    const url = new URL(c.req.url);
    const key = new Request(`${url.origin}${url.pathname}`, { method: 'GET' });
    const cached = await cache?.match(key).catch(() => undefined);
    if (cached) return cached;
    const body = await (
      await loadSnapshot()
    ).getSnapshotDelta(c.env, c.req.param('from'), c.req.param('to'));
    const response = body
      ? new Response(body, {
          headers: {
            'content-type': 'application/json',
            'cache-control': 'public, max-age=31536000, immutable',
          },
        })
      : new Response(JSON.stringify({ error: 'delta_unavailable' }), {
          status: 404,
          headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
        });
    if (cache) {
      const write = cache.put(key, response.clone()).catch(() => undefined);
      try {
        c.executionCtx.waitUntil(write);
      } catch {
        await write;
      }
    }
    return response;
  });

  app.get('/v1/snapshots/:version/:path', async (c) => {
    const path = c.req.param('path');
    const body = await (await loadSnapshot()).getSnapshotFile(c.env, c.req.param('version'), path);
    if (!body) return c.json({ error: 'not_found' }, 404);
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    return c.body(body, 200, {
      'content-type':
        path === PUBLIC_BLOCKLIST_PACK ? 'text/yaml; charset=utf-8' : 'application/json',
    });
  });

  app.get('/v1/blocklist/latest.yaml', async (c) => {
    const body = await (await loadSnapshot()).getLatestSnapshotFile(c.env, PUBLIC_BLOCKLIST_PACK);
    if (!body) return c.json({ error: 'no_snapshot' }, 404);
    c.header('Cache-Control', 'public, max-age=300');
    return c.body(body, 200, { 'content-type': 'text/yaml; charset=utf-8' });
  });

  app.get('/v1/blocklist/latest.json', async (c) => {
    const body = await (await loadSnapshot()).getLatestSnapshotFile(c.env, SNAPSHOT_PACK);
    if (!body) return c.json({ error: 'no_snapshot' }, 404);
    c.header('Cache-Control', 'public, max-age=300');
    return c.body(body, 200, { 'content-type': 'application/json' });
  });

  // 官网名单公示数据：与扩展执行的名单同源（最新快照），只保留公示字段，
  // 不含指纹 / 域名 / 证据帖等对抗敏感细节。短缓存与快照端点对齐。
  app.get('/v1/roster/latest', async (c) => {
    const roster = await (await loadRoster()).getPublicRoster(c.env);
    if (!roster) return c.json({ error: 'no_snapshot' }, 404);
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(roster);
  });

  // 白名单 handle 精简版：福滤娃周刊（feedsieve.win/weekly）给被推荐的 X 作者打「福滤娃白名单」徽章用。
  // 只含维护者白名单与社区认证的 handle（小写），不含黑名单与任何证据字段。
  app.get('/v1/whitelist/handles', async (c) => {
    const roster = await (await loadRoster()).getPublicRoster(c.env);
    if (!roster) return c.json({ error: 'no_snapshot' }, 404);
    const handles = [
      ...new Set(
        [...roster.whitelist.maintained, ...roster.whitelist.verified].map((e) =>
          e.handle.toLowerCase(),
        ),
      ),
    ].sort();
    c.header('Cache-Control', 'public, max-age=300');
    return c.json({ snapshot_version: roster.snapshot_version, handles });
  });

  // 关键词包和账号社区名单分开：前者是公开、可订阅的“黄标规则”，
  // 不承载举报或账号身份数据。R2 保留版本文件，latest manifest 只短缓存。
  app.get('/v1/keyword-packs/latest', async (c) => {
    const object = await c.env.KEYWORD_PACKS?.get('keyword-packs/latest.json');
    if (!object) return c.json({ error: 'keyword_packs_unavailable' }, 503);
    c.header('Cache-Control', 'public, max-age=300');
    return c.body(await object.text(), 200, { 'content-type': 'application/json' });
  });

  app.get('/v1/keyword-packs/:version/:path', async (c) => {
    const version = c.req.param('version');
    const path = c.req.param('path');
    if (!/^\d{4}\.\d{2}\.\d{2}\.\d{1,4}$/.test(version) || path !== 'official.json') {
      return c.json({ error: 'not_found' }, 404);
    }
    const object = await c.env.KEYWORD_PACKS?.get(`keyword-packs/${version}/${path}`);
    if (!object) return c.json({ error: 'not_found' }, 404);
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    return c.body(await object.text(), 200, { 'content-type': 'application/json' });
  });

  app.post('/v1/rescues', async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const result = await processRescueBatch(c.env, body);
    c.header('Cache-Control', 'no-store');
    if (!result.ok) {
      return c.json({ error: result.error }, result.httpStatus);
    }
    return c.json({
      results: result.results,
      snapshot_version: await markDirtyAndReadSnapshotVersion(c.env),
    });
  });

  // 关键词贡献：扩展用户 / 官网访客显式提交短语给运营审阅入库。
  // 短语主动挑选；不进快照，只出现在运营待审列表。
  app.post('/v1/keyword-contributions', async (c) => {
    const body = await c.req.json().catch(() => undefined);
    // 按需加载：keyword-contributions 经 labels 拉进共识/评级/分类推断，是启动路径上的大头，
    // 而这个端点只有用户显式提交短语时才会命中。
    const { processKeywordContributions } = await import('./keyword-contributions');
    const result = await processKeywordContributions(c.env, {
      body,
      ip: c.req.header('cf-connecting-ip') ?? null,
    });
    c.header('Cache-Control', 'no-store');
    if (!result.ok) {
      return c.json({ error: result.error }, result.httpStatus);
    }
    return c.json({ results: result.results });
  });

  app.post('/v1/labels/retract', async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const result = await (await loadLabels()).processRetractionBatch(c.env, body);
    c.header('Cache-Control', 'no-store');
    if (!result.ok) {
      return c.json({ error: result.error }, result.httpStatus);
    }
    return c.json({
      results: result.results,
      snapshot_version: await markDirtyAndReadSnapshotVersion(c.env),
    });
  });

  // 公开政策：阈值不藏在后端黑箱里。数据只在部署/政策变更时更新，
  // 无须每次轮询都打 Worker/D1。
  app.get('/v1/policy', (c) => {
    c.header('Cache-Control', 'public, max-age=0, s-maxage=300');
    return c.json(publicPolicy());
  });

  // 名单公示申请：提交（发邮箱验证码）→ 验证 → 进维护者队列。无安装语义。
  app.post('/v1/applications', async (c) => {
    const result = await (
      await loadApplications()
    ).submitApplication(
      c.env,
      await c.req.json().catch(() => undefined),
      c.req.header('cf-connecting-ip'),
    );
    if (!result.ok) return c.json({ error: result.error }, result.httpStatus);
    c.header('Cache-Control', 'no-store');
    return c.json(result.value);
  });
  app.post('/v1/applications/verify', async (c) => {
    const result = await (
      await loadApplications()
    ).verifyApplication(c.env, await c.req.json().catch(() => undefined));
    if (!result.ok) return c.json({ error: result.error }, result.httpStatus);
    c.header('Cache-Control', 'no-store');
    return c.json(result.value);
  });

  // 我的贡献统计（v0.6）：按安装哈希查累计上报 / 被采纳 / 抢救数。
  // 隐私：POST body 接收安装 ID（不进 URL，不落边缘访问日志），服务端只存
  // 加盐哈希；返回纯数字，无账号信息。
  app.post('/v1/contributions/stats', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    c.header('Cache-Control', 'no-store');
    const installationId =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>)['installation_id']
        : undefined;
    if (
      typeof installationId !== 'string' ||
      installationId.length < 8 ||
      installationId.length > 128
    ) {
      return c.json({ error: 'invalid_installation_id' }, 400);
    }
    const installHash = await hashInstallationId(c.env.INSTALLATION_SALT, installationId);
    const db = getDb(c.env);
    const [[labels], [adopted]] = await Promise.all([
      db
        .select({
          reports: sql<number>`count(*) filter (where ${activeLabels.label} = 'blocked')`.mapWith(
            Number,
          ),
          rescues: sql<number>`count(*) filter (where ${activeLabels.label} = 'allowed')`.mapWith(
            Number,
          ),
        })
        .from(activeLabels)
        .where(eq(activeLabels.installationId, installHash)),
      // 被采纳：该安装当前投了拉黑票，且账号在当前公开名单里（accounts.listed，与扩展下载的名单同一口径）。
      db
        .select({ n: countDistinct(activeLabels.handle) })
        .from(activeLabels)
        .innerJoin(accounts, eq(accounts.handle, activeLabels.handle))
        .where(
          and(
            eq(activeLabels.installationId, installHash),
            eq(activeLabels.label, 'blocked'),
            eq(accounts.listed, 1),
          ),
        ),
    ]);
    return c.json({
      reports: labels?.reports ?? 0,
      rescues: labels?.rescues ?? 0,
      adopted: adopted?.n ?? 0,
    });
  });

  // 官网公开页已迁到 TanStack Start SSR（src/server.ts），这里只保留：
  // 管理 host 的 ASSETS SPA 兜底；其余（含官网 host 未知路径）404。
  app.get('*', async (c) => {
    // 只有独立后台域名会落到前端资产；公开 API 域名不再暴露管理界面。
    if (!isAdminHost(c.req.raw, c.env) || !c.env.ASSETS) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.env.ASSETS.fetch(staticAssetRequest(c.req.raw));
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  app.onError((error, c) => {
    // 不打整个 error 对象：Drizzle/nodemailer 错误消息可能嵌入绑定值（邮箱等敏感数据）
    const name = error instanceof Error ? error.name : 'Error';
    const message = describeDbError(error);
    console.error(`[community-api] ${c.req.method} ${c.req.path} -> 500 ${name}: ${message}`);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

// 定时任务编排已抽到 src/scheduled.ts（供 server.ts 复用，见该文件头注释）。
// 生产入口是 server.ts（经 api.ts 引 createApp）；这里的默认导出仅供测试入口
// api-entry.ts 与本地直跑使用——懒构建，避免 api.ts import 本模块时把整条
// 路由树在同 isolate 内白建一遍。
let app: ReturnType<typeof createApp> | null = null;

// fetch 的 request 参数显式 any：ExportedHandler 的窄化泛型与 vitest 插件
// （miniflare）的全局 Request 泛型互不相容，测试直接 import 本入口调 fetch 会
// 在边界报结构性不匹配；a11y 上运行时行为不变（cloudflare-test 的 Request 兼容）。
export default {
  fetch(request: unknown, env) {
    app ??= createApp();
    const current = app;
    return withDb(async () => current.fetch(request as Request, env));
  },
  async scheduled(controller, env) {
    // 与 server.ts 生产入口共用同一编排函数，探活等新增消费端不再漂移。
    // 动态 import：本模块被 api.ts 引去建路由表，静态引入会把整条 cron 依赖
    // （snapshot / prober / 各清理任务）拉进每一次 /v1/* 冷启动的求值路径。
    await withDb(async () => {
      const { runScheduledCron } = await import('./scheduled');
      await runScheduledCron(env, controller?.cron);
    });
  },
} satisfies ExportedHandler<Cloudflare.Env>;
