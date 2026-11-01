import { getHotBoards, ingestObservations } from './hot';
import { ingestRuleHits, loadRuleFeedback, RULE_HIT_POLICY, setRuleMute } from './rule-hits';
import { chargeProfileRead, getProfile, ingestProfileObservations } from './profiles';
import { and, asc, count, countDistinct, desc, eq, sql } from 'drizzle-orm';
import { describeDbError, getDb, withDb } from './db/client';
import { accounts, activeLabels, meta, rescues } from './db/schema';
import {
  ingestTrainingSamples,
  listTrainingSamples,
  reviewTrainingSample,
} from './training-samples';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  deactivateAdminAccountDraft,
  getAdminRelease,
  listAdminAccountDrafts,
  listAdminReleases,
  publishAdminAccountDrafts,
  recordAdminAudit,
  rollbackAdminAccountRelease,
  saveAdminAccountDraft,
} from './admin-accounts';
import { verifyAccess } from './lib/access';
import { isAdminHost } from './lib/hosts';
import { hashInstallationId } from './lib/hash';
import { publicErrorCode } from './lib/public-error';
import {
  decideApplication,
  listApplications,
  submitApplication,
  verifyApplication,
} from './applications';
import { listCommunityCandidates } from './candidates';
import { listVerifiedAccounts } from './verified';
import { getPublicRoster } from './roster';
import { getDashboardMetrics } from './dashboard';
import {
  disableAdminKeyword,
  getKeywordDetectorConfig,
  importKeywordCatalog,
  listAdminKeywords,
  publishAdminKeywords,
  rollbackAdminKeywordRelease,
  saveAdminKeywordPack,
  saveAdminKeywordRule,
  setKeywordDetectorConfig,
} from './keyword-admin';
import {
  agentKeyIdentity,
  agentStatus,
  importAgentKeywordCatalog,
  listAgentAssets,
  listAgentAudit,
  listAgentKeywords,
  listAgentMaintainerEntries,
  listAgentReleases,
  publishAgentKeywords,
  recomputeAllAccountCategories,
  removeAgentKeyword,
  removeAgentMaintainerEntry,
  rollbackAgentRelease,
  upsertAgentKeywordPack,
  upsertAgentKeywordRule,
  upsertAgentMaintainerEntry,
  readAgentKeywordDetectorConfig,
  writeAgentKeywordDetectorConfig,
} from './agent-admin';
import { runScheduledCron } from './scheduled';
import { MAINTAINER_CATEGORIES } from './maintainer-blocklist';
import { processRetractionBatch } from './labels';
import { checkAiAccount } from './ai-accounts/check';
import { judgeAiAccount } from './ai-accounts/judge';
import { voteAiAccount } from './ai-accounts/vote';
import { listAiAccounts, lookupAiAccount } from './ai-accounts/lookup';
import { decideAiReview, listAiReviews, recordClientOutcome } from './ai-accounts/review';
import { sha256Hex } from './lib/hash';
import { POLICY, processReportBatch, publicPolicy } from './reports';
import { processRescueBatch } from './rescues';
import {
  decideKeywordContributions,
  listKeywordContributions,
  processKeywordContributions,
} from './keyword-contributions';
import {
  buildKillSwitch,
  getLatestSnapshot,
  getLatestSnapshotFile,
  getLatestSnapshotVersion,
  getSnapshotDelta,
  getSnapshotFile,
  markSnapshotDirty,
  PUBLIC_BLOCKLIST_PACK,
  SNAPSHOT_DIRTY_KEY,
  SNAPSHOT_LATEST_KEY,
  SNAPSHOT_PACK,
} from './snapshot';

function staticAssetRequest(request: Request): Request {
  // assets.not_found_handling = single-page-application resolves TanStack routes
  // to the shell while keeping the incoming URL intact.
  return request;
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
  return pointer[0]?.value ?? getLatestSnapshotVersion(env);
}

type AdminContext = Context<{
  Bindings: Cloudflare.Env;
  Variables: { maintainerEmail: string; agentIdentity: string };
}>;

/** 词库工作区变更后立即重发公开词库：保存即生效，维护者无需再手动发布。 */
async function republishKeywords(
  c: AdminContext,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  try {
    const published = await publishAdminKeywords(c.env, c.get('maintainerEmail'));
    return c.json({ ...extra, version: published.version });
  } catch (error) {
    const code = publicErrorCode(error, 'publish_failed');
    // 移除全部分类时无法产出空词库：变更已生效，线上保持上一个版本。
    if (code === 'no_active_packs') return c.json({ ...extra, version: null });
    return c.json({ error: code }, 500);
  }
}

export function createApp() {
  const app = new Hono<{
    Bindings: Cloudflare.Env;
    Variables: { maintainerEmail: string; agentIdentity: string };
  }>();

  // 扩展 content script 会跨域 POST /v1/*，必须放行预检；管理（/api/admin，
  // 同源 ASSETS 服务）与 Agent（脚本直连）家族不开跨域。
  app.use('/v1/*', cors());

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
      const result = await ingestTrainingSamples(
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
      const result = await checkAiAccount(
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
      const result = await judgeAiAccount(
        c.env,
        await c.req.json().catch(() => null),
        c.req.header('cf-connecting-ip'),
      );
      return c.json(result.body, result.status);
    },
  );

  // AI 号名单：可公开的 AI / 疑似账号，扩展同步到本机，在评论区标记 / 折叠（必须注册在 :handle 前面）
  app.get('/v1/ai-accounts/list', async (c) => {
    const body = JSON.stringify({ entries: await listAiAccounts(c.env) });
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
      const ok = await recordClientOutcome(c.env, await c.req.json().catch(() => null));
      return ok ? c.body(null, 204) : c.json({ error: 'invalid_outcome' }, 400);
    },
  );

  // AI 号只读查询：主页「AI 味」Tab 直接显示已有结论和票数，不调第三方、不计额度
  app.get('/v1/ai-accounts/:handle', async (c) => {
    const result = await lookupAiAccount(c.env, c.req.param('handle'));
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
      const result = await voteAiAccount(c.env, await c.req.json().catch(() => null));
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

  // React 管理端使用 Cloudflare Access 身份；此路由永远不接受旧的 Bearer 凭据。
  app.use('/api/admin/*', async (c, next) => {
    if (!isAdminHost(c.req.raw, c.env)) return c.json({ error: 'not_found' }, 404);
    // CSRF 防线：Access 身份是边缘按会话 Cookie 注入的，跨站简单请求
    // （无预检的 text/plain body）会带着维护者的有效会话到达这里，而
    // Hono 的 c.req.json() 不看 content-type。浏览器发起的写请求一定带
    // Origin：Origin 存在但不等于管理域名 → 直接拒绝；无 Origin 的
    // 非浏览器客户端（curl/脚本）必须声明 application/json。
    // 写方法覆盖 POST/PUT/PATCH/DELETE：跨站 DELETE 预检可被放行、
    // 副作用照发（浏览器只是不给读响应），不能只挡 POST。
    const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
    if (WRITE_METHODS.has(c.req.method)) {
      // ADMIN_HOST 支持 CSV 多域名（迁移期旧新域并列，见 lib/hosts.ts），逐个比对。
      const configuredHosts = (c.env.ADMIN_HOST ?? '')
        .trim()
        .toLowerCase()
        .split(',')
        .map((host) => host.trim())
        .filter(Boolean);
      const origin = c.req.header('origin');
      if (origin) {
        if (
          configuredHosts.length === 0 ||
          !configuredHosts.some((host) => origin.toLowerCase() === `https://${host}`)
        ) {
          return c.json({ error: 'cross_origin_admin_post' }, 403);
        }
      } else {
        const contentType = (c.req.header('content-type') ?? '')
          .split(';')[0]
          ?.trim()
          .toLowerCase();
        if (contentType !== 'application/json') {
          return c.json({ error: 'json_content_type_required' }, 415);
        }
      }
    }
    const identity = await verifyAccess(c.req.raw, c.env);
    if (!identity) return c.json({ error: 'access_required' }, 401);
    c.set('maintainerEmail', identity.email);
    await next();
  });

  app.get('/api/admin/me', (c) => c.json({ email: c.get('maintainerEmail') }));

  app.get('/api/admin/dashboard', async (c) => c.json(await getDashboardMetrics(c.env)));

  // 社区候选池（只读复核视图 + 分页），与维护者草稿页（admin_account_drafts）分开。
  app.get('/api/admin/community-accounts', async (c) => {
    const limit = Number(c.req.query('limit') ?? 50);
    return c.json(
      await listCommunityCandidates(c.env, {
        net: c.req.query('net') ?? 'all',
        q: c.req.query('q') ?? undefined,
        category: c.req.query('category') ?? undefined,
        cursor: c.req.query('cursor') ?? undefined,
        limit: Number.isFinite(limit) ? Math.trunc(limit) : 50,
      }),
    );
  });

  app.get('/api/admin/accounts', async (c) =>
    c.json({
      entries: await listAdminAccountDrafts(c.env, { q: c.req.query('q'), limit: 500 }),
      categories: MAINTAINER_CATEGORIES,
    }),
  );

  // 社区白名单（verified，只读复核视图）：被验证为「误标正常」的账号。
  app.get('/api/admin/verified', async (c) => {
    const limit = Number(c.req.query('limit') ?? 500);
    return c.json(
      await listVerifiedAccounts(c.env, {
        q: c.req.query('q') ?? undefined,
        limit: Number.isFinite(limit) ? Math.trunc(limit) : 500,
      }),
    );
  });
  // 名单公示申请队列：邮箱已验证（verified）与未验证（pending）都可见，维护者裁决。
  app.get('/api/admin/applications', async (c) => {
    const limit = Number(c.req.query('limit') ?? 200);
    return c.json(
      await listApplications(c.env, {
        status: c.req.query('status') || undefined,
        limit: Number.isFinite(limit) ? Math.trunc(limit) : 200,
      }),
    );
  });
  app.post('/api/admin/applications/:id/decide', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid_application_id' }, 400);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const decision = typeof body.decision === 'string' ? body.decision : '';
    const note = typeof body.note === 'string' ? body.note : null;
    const result = await decideApplication(c.env, id, decision, note, c.get('maintainerEmail'));
    if (!result.ok) return c.json({ error: result.error }, 400);
    await recordAdminAudit(
      c.env,
      c.get('maintainerEmail'),
      'application_decision',
      'application',
      String(id),
      {
        decision,
        handle: typeof body.handle === 'string' ? body.handle : undefined,
        kind: typeof body.kind === 'string' ? body.kind : undefined,
      },
    );
    return c.json({ changed: true });
  });

  app.post('/api/admin/accounts', async (c) => {
    const result = await saveAdminAccountDraft(c.env, await c.req.json().catch(() => undefined));
    if (!result.ok) return c.json({ error: result.error }, 400);
    await recordAdminAudit(
      c.env,
      c.get('maintainerEmail'),
      `${result.action}_draft`,
      'account',
      result.entry.handle,
    );
    // 保存即生效：草稿落库后立刻同步公开名单并生成快照，维护者无需再手动发布。
    try {
      const published = await publishAdminAccountDrafts(c.env, c.get('maintainerEmail'));
      return c.json(
        {
          action: result.action,
          entry: result.entry,
          snapshot_version: published.snapshot_version,
        },
        201,
      );
    } catch (error) {
      return c.json({ error: publicErrorCode(error, 'publish_failed') }, 500);
    }
  });
  app.delete('/api/admin/accounts/:handle', async (c) => {
    const result = await deactivateAdminAccountDraft(c.env, c.req.param('handle'));
    if (!result.ok) return c.json({ error: result.error }, 400);
    if (!result.changed) return c.json({ changed: false });
    await recordAdminAudit(
      c.env,
      c.get('maintainerEmail'),
      'remove_draft',
      'account',
      c.req.param('handle'),
    );
    try {
      const published = await publishAdminAccountDrafts(c.env, c.get('maintainerEmail'));
      return c.json({ changed: true, snapshot_version: published.snapshot_version });
    } catch (error) {
      return c.json({ error: publicErrorCode(error, 'publish_failed') }, 500);
    }
  });
  app.post('/api/admin/accounts/publish', async (c) => {
    try {
      return c.json(await publishAdminAccountDrafts(c.env, c.get('maintainerEmail')));
    } catch (error) {
      return c.json({ error: publicErrorCode(error, 'publish_failed') }, 400);
    }
  });

  app.get('/api/admin/keywords', async (c) =>
    c.json(
      await listAdminKeywords(c.env, {
        q: c.req.query('q'),
        packId: c.req.query('pack'),
        limit: 1000,
      }),
    ),
  );
  // 用户主动贡献的关键词待审列表（0022 迁移）；审阅结果线下决定。
  app.get('/api/admin/keywords/contributions', async (c) =>
    c.json(await listKeywordContributions(c.env)),
  );
  // 审阅决定：按归一化词批量 admitted / rejected，只改待审状态，不动公共数据。
  app.post('/api/admin/keywords/contributions/decide', async (c) => {
    const body = await c.req.json().catch(() => undefined);
    if (typeof body !== 'object' || body === null) {
      return c.json({ error: 'invalid_json_body' }, 400);
    }
    const b = body as Record<string, unknown>;
    const normPhrase = b.norm_phrase;
    const decision = b.decision;
    if (typeof normPhrase !== 'string' || normPhrase.length === 0) {
      return c.json({ error: 'invalid_norm_phrase' }, 400);
    }
    if (decision !== 'admitted' && decision !== 'rejected') {
      return c.json({ error: 'invalid_decision' }, 400);
    }
    const result = await decideKeywordContributions(
      c.env,
      normPhrase,
      decision,
      c.get('maintainerEmail') ?? '',
    );
    await recordAdminAudit(
      c.env,
      c.get('maintainerEmail'),
      decision,
      'keyword_contribution',
      normPhrase,
      {
        changed: result.changed,
      },
    );
    return c.json(result);
  });
  // 从 R2 公开词库导入维护者工作区是显式动作，不再挂在列表读取上。
  app.post('/api/admin/keywords/import', async (c) => {
    try {
      const result = await importKeywordCatalog(c.env);
      if (result.imported) {
        await recordAdminAudit(
          c.env,
          c.get('maintainerEmail'),
          'import',
          'keyword_catalog',
          String(result.rules),
          {
            packs: result.packs,
            rules: result.rules,
          },
        );
      }
      return c.json(result);
    } catch (error) {
      return c.json({ error: publicErrorCode(error, 'import_failed') }, 400);
    }
  });
  app.post('/api/admin/keywords/packs', async (c) => {
    const item = await saveAdminKeywordPack(
      c.env,
      await c.req.json().catch(() => undefined),
      c.get('maintainerEmail'),
    );
    if (!item) return c.json({ error: 'invalid_pack' }, 400);
    return republishKeywords(c, { id: item.id });
  });
  app.post('/api/admin/keywords/rules', async (c) => {
    const item = await saveAdminKeywordRule(
      c.env,
      await c.req.json().catch(() => undefined),
      c.get('maintainerEmail'),
    );
    if (!item) return c.json({ error: 'invalid_rule' }, 400);
    return republishKeywords(c, { id: item.id });
  });
  app.delete('/api/admin/keywords/packs/:id', async (c) => {
    const changed = await disableAdminKeyword(
      c.env,
      'admin_keyword_packs',
      c.req.param('id'),
      c.get('maintainerEmail'),
    );
    if (!changed) return c.json({ changed: false });
    return republishKeywords(c, { changed });
  });
  app.delete('/api/admin/keywords/rules/:id', async (c) => {
    const changed = await disableAdminKeyword(
      c.env,
      'admin_keyword_rules',
      c.req.param('id'),
      c.get('maintainerEmail'),
    );
    if (!changed) return c.json({ changed: false });
    return republishKeywords(c, { changed });
  });
  app.post('/api/admin/keywords/publish', async (c) => {
    try {
      return c.json(await publishAdminKeywords(c.env, c.get('maintainerEmail')));
    } catch (error) {
      return c.json({ error: publicErrorCode(error, 'publish_failed') }, 400);
    }
  });

  // 天级判定参数（乱码/词沙拉/组合门槛）：随词库发布链下发到扩展。
  // 保存后立即重发布（带新参数生成新版本），与词库「保存即发布」同节奏。
  // 请求体：{ detector_config: <对象> | null }，null = 清除（回退内置兜底）。
  app.get('/api/admin/keywords/detector-config', async (c) => {
    return c.json({ detector_config: await getKeywordDetectorConfig(c.env) });
  });
  app.post('/api/admin/keywords/detector-config', async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as
      { detector_config?: unknown } | undefined;
    const value = body?.detector_config;
    if (
      !body ||
      !('detector_config' in body) ||
      (value !== null && (typeof value !== 'object' || Array.isArray(value)))
    ) {
      return c.json({ error: 'invalid_detector_config' }, 400);
    }
    const accepted = await setKeywordDetectorConfig(c.env, value);
    if (!accepted) return c.json({ error: 'invalid_detector_config' }, 400);
    await recordAdminAudit(
      c.env,
      c.get('maintainerEmail'),
      'update',
      'keyword_detector_config',
      'keyword-detector-config',
      {},
    );
    return republishKeywords(c, { saved: value === null ? null : true });
  });

  // 只展示去标识化的规则级反馈；维护者不能读取安装 ID 或原始浏览内容。
  app.get('/api/admin/samples', async (c) => {
    const after = Number(c.req.query('after') ?? 0);
    if (!Number.isSafeInteger(after) || after < 0) return c.json({ error: 'invalid_cursor' }, 400);
    const until = c.req.query('until') === undefined ? undefined : Number(c.req.query('until'));
    const reviewUntil =
      c.req.query('review_until') === undefined ? undefined : Number(c.req.query('review_until'));
    if ([until, reviewUntil].some((v) => v !== undefined && (!Number.isSafeInteger(v) || v < 0)))
      return c.json({ error: 'invalid_cursor' }, 400);
    return c.json(await listTrainingSamples(c.env, after, 100, until, reviewUntil));
  });
  app.post('/api/admin/samples/:id/review', async (c) => {
    const id = Number(c.req.param('id'));
    const changed = await reviewTrainingSample(
      c.env,
      id,
      await c.req.json().catch(() => null),
      c.get('maintainerEmail'),
    );
    if (!changed) return c.json({ error: 'invalid_sample_review' }, 400);
    return c.json({ changed: true });
  });

  // AI 号复核：仅保留紧急人工入口；常规公开结果由投票 + Jev 决定
  // 规则误伤：命中账号数、误标账号数、误伤率与静音状态；可手动静音 / 恢复
  app.get('/api/admin/rule-feedback', async (c) =>
    c.json({ rules: await loadRuleFeedback(c.env), policy: RULE_HIT_POLICY }),
  );
  app.post('/api/admin/rule-feedback/:ruleId', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { muted?: unknown } | null;
    if (typeof body?.muted !== 'boolean') return c.json({ error: 'invalid_request' }, 400);
    const ruleId = c.req.param('ruleId');
    if (!(await setRuleMute(c.env, ruleId, body.muted))) {
      return c.json({ error: 'invalid_rule_id' }, 400);
    }
    await recordAdminAudit(
      c.env,
      c.get('maintainerEmail'),
      body.muted ? 'mute_rule' : 'unmute_rule',
      'rule',
      ruleId,
    );
    // 静音状态随快照下发：置脏，下一轮 cron 发布
    await markSnapshotDirty(c.env);
    return c.json({ ok: true });
  });

  app.get('/api/admin/ai-reviews', async (c) => c.json(await listAiReviews(c.env)));
  app.post('/api/admin/ai-reviews/:handle', async (c) => {
    const result = await decideAiReview(
      c.env,
      c.req.param('handle'),
      await c.req.json().catch(() => null),
      c.get('maintainerEmail'),
    );
    return result.ok ? c.json({ ok: true }) : c.json({ error: result.error }, 400);
  });

  app.get('/api/admin/feedback', async (c) => {
    const db = getDb(c.env);
    const detectionSource = sql<string>`coalesce(${rescues.detectionSource}, 'unknown')`;
    const ruleId = sql<string>`coalesce(${rescues.ruleId}, 'unknown')`;
    const [summary, feedback] = await Promise.all([
      db
        .select({ detection_source: detectionSource, rule_id: ruleId, count: count() })
        .from(rescues)
        .groupBy(rescues.detectionSource, rescues.ruleId)
        .orderBy(desc(count()), asc(detectionSource), asc(ruleId)),
      db
        .select({
          handle: rescues.handle,
          detection_source: rescues.detectionSource,
          rule_id: rescues.ruleId,
          detection_reason: rescues.detectionReason,
          client_version: rescues.clientVersion,
          created_at: rescues.createdAt,
          category: accounts.category,
          status: accounts.status,
          report_count: accounts.reportCount,
          rescue_count: accounts.rescueCount,
        })
        .from(rescues)
        .leftJoin(accounts, eq(accounts.handle, rescues.handle))
        .orderBy(desc(rescues.createdAt), desc(rescues.id))
        .limit(200),
    ]);
    return c.json({ summary, feedback });
  });

  app.get('/api/admin/releases', async (c) => c.json({ releases: await listAdminReleases(c.env) }));
  app.post('/api/admin/releases/:id/rollback', async (c) => {
    const id = Number(c.req.param('id'));
    // 按主键直查，历史发布记录（不在最近 100 条内）同样可以回退。
    const release = Number.isInteger(id) ? await getAdminRelease(c.env, id) : null;
    if (!release) return c.json({ error: 'release_not_found' }, 404);
    try {
      return c.json(
        release.kind === 'accounts'
          ? await rollbackAdminAccountRelease(c.env, id, c.get('maintainerEmail'))
          : await rollbackAdminKeywordRelease(c.env, release.version, c.get('maintainerEmail')),
      );
    } catch (error) {
      return c.json({ error: publicErrorCode(error, 'rollback_failed') }, 400);
    }
  });

  // 旧的拼接 HTML 维护页已废弃；新的后台只通过受 Access 保护的独立域名提供。
  app.get('/maintainer', (c) => c.json({ error: 'admin_moved_to_access' }, 410));
  // 旧 Bearer-token 管理 API 也一并退役，不能成为 Access 的旁路。
  app.all('/admin/*', (c) => c.json({ error: 'admin_moved_to_access' }, 410));

  // 快照消费端点：manifest 短缓存，版本化文件按不可变缓存
  app.get('/v1/snapshots/latest', async (c) => {
    const latest = await getLatestSnapshot(c.env);
    if (!latest) return c.json({ error: 'no_snapshot' }, 404);
    c.header('Cache-Control', 'public, max-age=300');
    return c.body(latest.manifest, 200, { 'content-type': 'application/json' });
  });

  // 官方暂停开关实时状态：不经快照日更节流，扩展在破坏性操作执行前实时查询。
  // 只读、无数据库访问；no-store 保证边缘缓存不摊薄应急时效。
  app.get('/v1/kill-switch', (c) => {
    const killSwitch = buildKillSwitch(c.env.DESTRUCTIVE_KILL_SWITCH, new Date().toISOString());
    c.header('Cache-Control', 'no-store');
    return c.json(killSwitch ?? { destructive_actions_disabled: false });
  });

  // Agent 维护通道：X-Agent-Key 鉴权（AGENT_API_KEYS，见 agent-admin.ts）。
  // 覆盖线上全部可管理数据：维护者名单 / 词库分类与规则 / 发布与回滚 / 审计 / 资产清单。
  // 不暴露社区票原始数据、安装数据或人工后台会话。
  // 统一中间件守卫：新增路由时不再依赖逐个手挂 guard，防漏防护。
  app.use('/api/agent/*', async (c, next) => {
    const identity = await agentKeyIdentity(c.env, c.req.header('x-agent-key'));
    if (!identity) return c.json({ error: 'invalid_agent_key' }, 401);
    c.set('agentIdentity', identity);
    await next();
  });

  app.get('/api/agent/entries', async (c) => {
    return c.json({ entries: await listAgentMaintainerEntries(c.env) });
  });

  app.put('/api/agent/entries/:handle', async (c) => {
    const guard = c.get('agentIdentity');
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'invalid_body' }, 400);
    }
    // 路径 handle 与 body.handle 必须一致，防止传错账号
    const pathHandle = (c.req.param('handle') ?? '').trim().toLowerCase();
    if (body.handle !== pathHandle) {
      return c.json({ error: 'handle_mismatch' }, 400);
    }
    const result = await upsertAgentMaintainerEntry(c.env, `agent:${guard}`, body);
    return result.ok ? c.json(result) : c.json({ error: result.error }, 400);
  });

  app.delete('/api/agent/entries/:handle', async (c) => {
    const guard = c.get('agentIdentity');
    const result = await removeAgentMaintainerEntry(c.env, `agent:${guard}`, c.req.param('handle'));
    return result.ok ? c.json(result) : c.json({ error: result.error }, 400);
  });

  // 全量重算 accounts 计票与分类（admin/候选池与快照推理口径对齐；幂等维护操作）
  app.post('/api/agent/recompute-categories', async (c) => {
    const guard = c.get('agentIdentity');
    return c.json(await recomputeAllAccountCategories(c.env, `agent:${guard}`));
  });

  // 维护者数据（名单草稿 / 白名单）经脚本或后台改动后触发快照即时发布：
  // 走人工发布通道（bypassDailyOnce），不落当日一版守卫，运营零额外步骤。
  app.post('/api/agent/accounts/publish', async (c) => {
    const guard = c.get('agentIdentity');
    try {
      return c.json(await publishAdminAccountDrafts(c.env, `agent:${guard}`));
    } catch (error) {
      return c.json({ error: publicErrorCode(error, 'publish_failed') }, 400);
    }
  });

  // --- 词库（关键词名单）---
  app.get('/api/agent/keywords', async (c) => {
    return c.json(await listAgentKeywords(c.env));
  });

  app.put('/api/agent/keywords/packs/:id', async (c) => {
    const guard = c.get('agentIdentity');
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return c.json({ error: 'invalid_body' }, 400);
    if (body.id !== c.req.param('id')) return c.json({ error: 'handle_mismatch' }, 400);
    const result = await upsertAgentKeywordPack(c.env, `agent:${guard}`, body);
    return result.ok ? c.json(result) : c.json({ error: result.error }, 400);
  });

  app.delete('/api/agent/keywords/packs/:id', async (c) => {
    const guard = c.get('agentIdentity');
    const result = await removeAgentKeyword(c.env, `agent:${guard}`, 'packs', c.req.param('id'));
    return result.ok ? c.json(result) : c.json({ error: result.error }, 400);
  });

  app.put('/api/agent/keywords/rules/:id', async (c) => {
    const guard = c.get('agentIdentity');
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return c.json({ error: 'invalid_body' }, 400);
    if (body.id !== c.req.param('id')) return c.json({ error: 'handle_mismatch' }, 400);
    const result = await upsertAgentKeywordRule(c.env, `agent:${guard}`, body);
    return result.ok ? c.json(result) : c.json({ error: result.error }, 400);
  });

  app.delete('/api/agent/keywords/rules/:id', async (c) => {
    const guard = c.get('agentIdentity');
    const result = await removeAgentKeyword(c.env, `agent:${guard}`, 'rules', c.req.param('id'));
    return result.ok ? c.json(result) : c.json({ error: result.error }, 400);
  });

  app.post('/api/agent/keywords/publish', async (c) => {
    const guard = c.get('agentIdentity');
    try {
      return c.json(await publishAgentKeywords(c.env, `agent:${guard}`));
    } catch (error) {
      return c.json({ error: publicErrorCode(error, 'publish_failed') }, 400);
    }
  });

  // 天级判定参数读写（与后台 POST 语义一致：PUT body 直接是配置本体或 null）
  app.get('/api/agent/keywords/detector-config', async (c) => {
    return c.json(await readAgentKeywordDetectorConfig(c.env));
  });
  app.put('/api/agent/keywords/detector-config', async (c) => {
    const guard = c.get('agentIdentity');
    // 畸形 body 直接拒绝：静默等价清除会让一次手滑把参数打回内置
    const result = await c.req.json().then(
      (raw: unknown) => writeAgentKeywordDetectorConfig(c.env, raw ?? null, `agent:${guard}`),
      () => ({ ok: false as const, error: 'invalid_body' }),
    );
    return result.ok ? c.json(result) : c.json({ error: result.error }, 400);
  });

  app.post('/api/agent/keywords/import', async (c) => {
    return c.json(await importAgentKeywordCatalog(c.env));
  });

  // --- 发布记录 / 回滚 / 审计 / 状态 / 资产 ---
  app.get('/api/agent/releases', async (c) => {
    return c.json({ releases: await listAgentReleases(c.env) });
  });

  app.post('/api/agent/releases/:id/rollback', async (c) => {
    const guard = c.get('agentIdentity');
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id)) return c.json({ error: 'invalid_release_id' }, 400);
    const result = await rollbackAgentRelease(c.env, `agent:${guard}`, id);
    return result.ok ? c.json(result) : c.json({ error: result.error }, 400);
  });

  app.get('/api/agent/audit', async (c) => {
    const limit = Number(c.req.query('limit') ?? 50);
    return c.json({ audit: await listAgentAudit(c.env, Number.isFinite(limit) ? limit : 50) });
  });

  app.get('/api/agent/status', async (c) => {
    return c.json(await agentStatus(c.env));
  });

  app.get('/api/agent/assets', async (c) => {
    const prefix = c.req.query('prefix') || null;
    return c.json(await listAgentAssets(c.env, prefix));
  });

  // 增量：两版不可变快照之间的差异，边缘缓存一年（每个机房每对版本只算一次）
  app.get('/v1/snapshots/delta/:from/:to', async (c) => {
    const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
    // 缓存键只用路径：带查询串绕不过缓存
    const url = new URL(c.req.url);
    const key = new Request(`${url.origin}${url.pathname}`, { method: 'GET' });
    const cached = await cache?.match(key).catch(() => undefined);
    if (cached) return cached;
    const body = await getSnapshotDelta(c.env, c.req.param('from'), c.req.param('to'));
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
    const body = await getSnapshotFile(c.env, c.req.param('version'), path);
    if (!body) return c.json({ error: 'not_found' }, 404);
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    return c.body(body, 200, {
      'content-type':
        path === PUBLIC_BLOCKLIST_PACK ? 'text/yaml; charset=utf-8' : 'application/json',
    });
  });

  app.get('/v1/blocklist/latest.yaml', async (c) => {
    const body = await getLatestSnapshotFile(c.env, PUBLIC_BLOCKLIST_PACK);
    if (!body) return c.json({ error: 'no_snapshot' }, 404);
    c.header('Cache-Control', 'public, max-age=300');
    return c.body(body, 200, { 'content-type': 'text/yaml; charset=utf-8' });
  });

  app.get('/v1/blocklist/latest.json', async (c) => {
    const body = await getLatestSnapshotFile(c.env, SNAPSHOT_PACK);
    if (!body) return c.json({ error: 'no_snapshot' }, 404);
    c.header('Cache-Control', 'public, max-age=300');
    return c.body(body, 200, { 'content-type': 'application/json' });
  });

  // 官网名单公示数据：与扩展执行的名单同源（最新快照），只保留公示字段，
  // 不含指纹 / 域名 / 证据帖等对抗敏感细节。短缓存与快照端点对齐。
  app.get('/v1/roster/latest', async (c) => {
    const roster = await getPublicRoster(c.env);
    if (!roster) return c.json({ error: 'no_snapshot' }, 404);
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(roster);
  });

  // 白名单 handle 精简版：福滤娃周刊（feedsieve.win/weekly）给被推荐的 X 作者打「福滤娃白名单」徽章用。
  // 只含维护者白名单与社区认证的 handle（小写），不含黑名单与任何证据字段。
  app.get('/v1/whitelist/handles', async (c) => {
    const roster = await getPublicRoster(c.env);
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
    const result = await processRetractionBatch(c.env, body);
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
    const result = await submitApplication(
      c.env,
      await c.req.json().catch(() => undefined),
      c.req.header('cf-connecting-ip'),
    );
    if (!result.ok) return c.json({ error: result.error }, result.httpStatus);
    c.header('Cache-Control', 'no-store');
    return c.json(result.value);
  });
  app.post('/v1/applications/verify', async (c) => {
    const result = await verifyApplication(c.env, await c.req.json().catch(() => undefined));
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
    // 与 server.ts 生产入口共用同一编排函数，探活等新增消费端不再漂移
    await withDb(() => runScheduledCron(env, controller?.cron));
  },
} satisfies ExportedHandler<Cloudflare.Env>;
