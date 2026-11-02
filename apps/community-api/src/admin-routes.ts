/**
 * 管理与 Agent 路由（原 index.ts 内联，2026-11-02 拆出）：
 * 这两族接口只有维护者后台与运维脚本用，流量约等于零，却把 jose（Access 身份校验）、
 * 后台业务模块和 dashboard 一起拖进了每一次 `/v1/*` 冷启动。拆成独立模块后由
 * index.ts 用动态 import 挂载，扩展上报的启动路径不再求值。
 */

import { loadRuleFeedback, RULE_HIT_POLICY, setRuleMute } from './rule-hits';
import { asc, count, desc, eq, sql } from 'drizzle-orm';
import { getDb } from './db/client';
import { accounts, rescues } from './db/schema';
import { listTrainingSamples, reviewTrainingSample } from './training-samples';
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
import { isAdminHost } from './lib/hosts';
import { publicErrorCode } from './lib/public-error';
import { decideApplication, listApplications } from './applications';
import { listCommunityCandidates } from './candidates';
import { listVerifiedAccounts } from './verified';
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
import { MAINTAINER_CATEGORIES } from './maintainer-blocklist';
import { decideAiReview, listAiReviews } from './ai-accounts/review';
import { decideKeywordContributions, listKeywordContributions } from './keyword-contributions';
import { markSnapshotDirty } from './snapshot';

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

/** 管理台与 Agent 通道共用的 Hono app；由 index.ts 按需加载。 */
export function createAdminApp() {
  const app = new Hono<{
    Bindings: Cloudflare.Env;
    Variables: { maintainerEmail: string; agentIdentity: string };
  }>();

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
    // 动态 import：lib/access 拉的是 jose（JWKS + JWT 校验），只有管理台用得到；
    // 静态引用会让扩展上报的每次冷启动都白求值一遍。
    const { verifyAccess } = await import('./lib/access');
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

  return app;
}
