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
import { hashInstallationId } from './lib/hash';
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
import { hunterPageHtml } from './hunter-page';
import { homePageHtml, listsPageHtml } from './site-pages';
import { LEADERBOARD, getLeaderboard, markLeaderboardDirty, settleDueSeasons } from './leaderboard';
import { bindEmail, getProfile, updateProfile, verifyEmail } from './player';
import { MAINTAINER_CATEGORIES } from './maintainer-blocklist';
import { processRetractionBatch } from './labels';
import { POLICY, processReportBatch, publicPolicy } from './reports';
import { processRescueBatch } from './rescues';
import {
  buildKillSwitch,
  clearSnapshotDirty,
  generateSnapshot,
  getLatestSnapshot,
  getLatestSnapshotFile,
  getLatestSnapshotVersion,
  getSnapshotFile,
  killSwitchNeedsPublish,
  markSnapshotDirty,
  PUBLIC_BLOCKLIST_PACK,
  readSnapshotDirty,
  SNAPSHOT_PACK,
} from './snapshot';

/** 注意：默认值返回 false —— 未配置对应主机名时，对应域名一律不生效。 */
function isConfiguredHost(request: Request, env: Cloudflare.Env, variable: 'ADMIN_HOST' | 'SITE_HOST'): boolean {
  const configured = env[variable]?.trim().toLowerCase();
  return Boolean(configured) && new URL(request.url).hostname.toLowerCase() === configured;
}

function isAdminHost(request: Request, env: Cloudflare.Env): boolean {
  return isConfiguredHost(request, env, 'ADMIN_HOST');
}

/** 官网公开页域名（首页 / 名单公示）。 */
function isSiteHost(request: Request, env: Cloudflare.Env): boolean {
  return isConfiguredHost(request, env, 'SITE_HOST');
}

function staticAssetRequest(request: Request): Request {
  // assets.not_found_handling = single-page-application resolves TanStack routes
  // to the shell while keeping the incoming URL intact.
  return request;
}

type AdminContext = Context<{ Bindings: Cloudflare.Env; Variables: { maintainerEmail: string; agentIdentity: string } }>;

/** 词库工作区变更后立即重发公开词库：保存即生效，维护者无需再手动发布。 */
async function republishKeywords(c: AdminContext, extra: Record<string, unknown> = {}): Promise<Response> {
  try {
    const published = await publishAdminKeywords(c.env, c.get('maintainerEmail'));
    return c.json({ ...extra, version: published.version });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'publish_failed';
    // 移除全部分类时无法产出空词库：变更已生效，线上保持上一个版本。
    if (code === 'no_active_packs') return c.json({ ...extra, version: null });
    return c.json({ error: code }, 500);
  }
}

export function createApp() {
  const app = new Hono<{ Bindings: Cloudflare.Env; Variables: { maintainerEmail: string; agentIdentity: string } }>();

  // 扩展 content script 会跨域 POST，必须放行预检
  app.use('*', cors());

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

  app.post('/v1/reports', async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const result = await processReportBatch(c.env, body, c.req.header('cf-connecting-ip'));
    if (!result.ok) {
      return c.json({ error: result.error }, result.httpStatus);
    }
    // 快照异步化：只落库并置脏，由 cron 每小时合并生成（当日一版守卫，见 snapshot.ts day-once）；
    // 响应返回当前有效版本。
    await markSnapshotDirty(c.env);
    await markLeaderboardDirty(c.env);
    return c.json({
      policy: {
        formula: 'block_votes - false_positive_votes',
        min_net_votes: POLICY.communityNetThreshold,
        daily_report_limit: POLICY.dailyReportLimit,
      },
      results: result.results,
      snapshot_version: await getLatestSnapshotVersion(c.env),
    });
  });

  // React 管理端使用 Cloudflare Access 身份；此路由永远不接受旧的 Bearer 凭据。
  app.use('/api/admin/*', async (c, next) => {
    if (!isAdminHost(c.req.raw, c.env)) return c.json({ error: 'not_found' }, 404);
    // CSRF 防线：Access 身份是边缘按会话 Cookie 注入的，跨站简单 POST
    // （无预检的 text/plain body）会带着维护者的有效会话到达这里，而
    // Hono 的 c.req.json() 不看 content-type。浏览器发起的 POST 一定带
    // Origin：Origin 存在但不等于管理域名 → 直接拒绝；无 Origin 的
    // 非浏览器客户端（curl/脚本）必须声明 application/json。
    if (c.req.method === 'POST') {
      const configured = c.env.ADMIN_HOST?.trim().toLowerCase();
      const origin = c.req.header('origin');
      if (origin) {
        if (!configured || origin.toLowerCase() !== `https://${configured}`) {
          return c.json({ error: 'cross_origin_admin_post' }, 403);
        }
      } else {
        const contentType = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
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
    await recordAdminAudit(c.env, c.get('maintainerEmail'), 'application_decision', 'application', String(id), {
      decision,
      handle: typeof body.handle === 'string' ? body.handle : undefined,
      kind: typeof body.kind === 'string' ? body.kind : undefined,
    });
    return c.json({ changed: true });
  });

  app.post('/api/admin/accounts', async (c) => {
    const result = await saveAdminAccountDraft(c.env, await c.req.json().catch(() => undefined));
    if (!result.ok) return c.json({ error: result.error }, 400);
    await recordAdminAudit(c.env, c.get('maintainerEmail'), `${result.action}_draft`, 'account', result.entry.handle);
    // 保存即生效：草稿落库后立刻同步公开名单并生成快照，维护者无需再手动发布。
    try {
      const published = await publishAdminAccountDrafts(c.env, c.get('maintainerEmail'));
      return c.json({ action: result.action, entry: result.entry, snapshot_version: published.snapshot_version }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'publish_failed' }, 500);
    }
  });
  app.delete('/api/admin/accounts/:handle', async (c) => {
    const result = await deactivateAdminAccountDraft(c.env, c.req.param('handle'));
    if (!result.ok) return c.json({ error: result.error }, 400);
    if (!result.changed) return c.json({ changed: false });
    await recordAdminAudit(c.env, c.get('maintainerEmail'), 'remove_draft', 'account', c.req.param('handle'));
    try {
      const published = await publishAdminAccountDrafts(c.env, c.get('maintainerEmail'));
      return c.json({ changed: true, snapshot_version: published.snapshot_version });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'publish_failed' }, 500);
    }
  });
  app.post('/api/admin/accounts/publish', async (c) => {
    try {
      return c.json(await publishAdminAccountDrafts(c.env, c.get('maintainerEmail')));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'publish_failed' }, 400);
    }
  });

  app.get('/api/admin/keywords', async (c) =>
    c.json(await listAdminKeywords(c.env, {
      q: c.req.query('q'),
      packId: c.req.query('pack'),
      limit: 1000,
    })),
  );
  // 从 R2 公开词库导入维护者工作区是显式动作，不再挂在列表读取上。
  app.post('/api/admin/keywords/import', async (c) => {
    try {
      const result = await importKeywordCatalog(c.env);
      if (result.imported) {
        await recordAdminAudit(c.env, c.get('maintainerEmail'), 'import', 'keyword_catalog', String(result.rules), {
          packs: result.packs,
          rules: result.rules,
        });
      }
      return c.json(result);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'import_failed' }, 400);
    }
  });
  app.post('/api/admin/keywords/packs', async (c) => {
    const item = await saveAdminKeywordPack(c.env, await c.req.json().catch(() => undefined), c.get('maintainerEmail'));
    if (!item) return c.json({ error: 'invalid_pack' }, 400);
    return republishKeywords(c, { id: item.id });
  });
  app.post('/api/admin/keywords/rules', async (c) => {
    const item = await saveAdminKeywordRule(c.env, await c.req.json().catch(() => undefined), c.get('maintainerEmail'));
    if (!item) return c.json({ error: 'invalid_rule' }, 400);
    return republishKeywords(c, { id: item.id });
  });
  app.delete('/api/admin/keywords/packs/:id', async (c) => {
    const changed = await disableAdminKeyword(c.env, 'admin_keyword_packs', c.req.param('id'), c.get('maintainerEmail'));
    if (!changed) return c.json({ changed: false });
    return republishKeywords(c, { changed });
  });
  app.delete('/api/admin/keywords/rules/:id', async (c) => {
    const changed = await disableAdminKeyword(c.env, 'admin_keyword_rules', c.req.param('id'), c.get('maintainerEmail'));
    if (!changed) return c.json({ changed: false });
    return republishKeywords(c, { changed });
  });
  app.post('/api/admin/keywords/publish', async (c) => {
    try {
      return c.json(await publishAdminKeywords(c.env, c.get('maintainerEmail')));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'publish_failed' }, 400);
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
      | { detector_config?: unknown }
      | undefined;
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
  app.get('/api/admin/feedback', async (c) => {
    const [summary, feedback] = await Promise.all([
      c.env.DB.prepare(
        `SELECT COALESCE(detection_source, 'unknown') AS detection_source,
                COALESCE(rule_id, 'unknown') AS rule_id,
                COUNT(*) AS count
         FROM rescues
         GROUP BY detection_source, rule_id
         ORDER BY count DESC, detection_source, rule_id`,
      ).all(),
      c.env.DB.prepare(
        `SELECT r.handle, r.detection_source, r.rule_id, r.detection_reason,
                r.client_version, r.created_at, a.category, a.status,
                a.report_count, a.rescue_count
         FROM rescues r
         LEFT JOIN accounts a ON a.handle = r.handle
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT 200`,
      ).all(),
    ]);
    return c.json({ summary: summary.results, feedback: feedback.results });
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
      return c.json({ error: error instanceof Error ? error.message : 'rollback_failed' }, 400);
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
    const result = await removeAgentMaintainerEntry(
      c.env,
      `agent:${guard}`,
      c.req.param('handle'),
    );
    return result.ok ? c.json(result) : c.json({ error: result.error }, 400);
  });

  // 全量重算 accounts 计票与分类（admin/候选池与快照推理口径对齐；幂等维护操作）
  app.post('/api/agent/recompute-categories', async (c) => {
    const guard = c.get('agentIdentity');
    return c.json(await recomputeAllAccountCategories(c.env, `agent:${guard}`));
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
      return c.json({ error: error instanceof Error ? error.message : 'publish_failed' }, 400);
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
    if (!result.ok) {
      return c.json({ error: result.error }, result.httpStatus);
    }
    await markSnapshotDirty(c.env);
    await markLeaderboardDirty(c.env);
    return c.json({ results: result.results, snapshot_version: await getLatestSnapshotVersion(c.env) });
  });

  app.post('/v1/labels/retract', async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const result = await processRetractionBatch(c.env, body);
    if (!result.ok) {
      return c.json({ error: result.error }, result.httpStatus);
    }
    await markSnapshotDirty(c.env);
    await markLeaderboardDirty(c.env);
    return c.json({ results: result.results, snapshot_version: await getLatestSnapshotVersion(c.env) });
  });

  // 公开政策：阈值不藏在后端黑箱里
  app.get('/v1/policy', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(publicPolicy());
  });

  // 打野排位赛榜单（脏标记懒重算，读这条就是实时口径）。
  // 隐私：installation_id / me 前缀都走 POST body，不进 URL 与边缘访问日志；
  // me 是加盐哈希前缀（不可逆），只用于定位高亮，无任何敏感操作。
  app.post('/v1/leaderboard', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    let mePrefix: string | null = null;
    if (typeof body === 'object' && body !== null) {
      const b = body as Record<string, unknown>;
      if (
        typeof b.installation_id === 'string' &&
        b.installation_id.length >= 8 &&
        b.installation_id.length <= 128
      ) {
        mePrefix = (await hashInstallationId(c.env.INSTALLATION_SALT, b.installation_id)).slice(0, 12);
      } else if (typeof b.me === 'string' && /^[0-9a-f]{12}$/.test(b.me)) {
        mePrefix = b.me;
      }
    }
    const data = await getLeaderboard(c.env);
    let me: (Record<string, unknown> & { rank: number }) | null = null;
    if (mePrefix) {
      const rank = data.rows.findIndex((row) => row.id.startsWith(mePrefix));
      if (rank >= 0) me = { ...data.rows[rank], rank: rank + 1 };
    }
    c.header('Cache-Control', 'no-store');
    // 公开面只暴露加盐哈希前 12 位（me 匹配粒度），完整哈希不出网
    const trim = (row: Record<string, unknown>) => ({ ...row, id: String(row.id).slice(0, 12) });
    return c.json({
      season: data.season,
      updated_at: data.computed_at,
      server_time: Math.floor(Date.now() / 1000),
      rows: data.rows.slice(0, LEADERBOARD.topSize).map((row, index) => trim({ ...row, rank: index + 1 })),
      me: me ? trim(me) : null,
      last_season: data.last_season ?? null,
    });
  });

  // 猎手档案：邮箱验证码解锁昵称 / 一句话介绍（无密码无会话）
  app.post('/v1/player/bind-email', async (c) => {
    const result = await bindEmail(c.env, await c.req.json().catch(() => undefined));
    if (!result.ok) return c.json({ error: result.error }, result.httpStatus);
    c.header('Cache-Control', 'no-store');
    return c.json(result.value);
  });
  app.post('/v1/player/verify', async (c) => {
    const result = await verifyEmail(c.env, await c.req.json().catch(() => undefined));
    if (!result.ok) return c.json({ error: result.error }, result.httpStatus);
    c.header('Cache-Control', 'no-store');
    return c.json(result.value);
  });
  app.post('/v1/player/profile', async (c) => {
    const result = await updateProfile(c.env, await c.req.json().catch(() => undefined));
    if (!result.ok) return c.json({ error: result.error }, result.httpStatus);
    c.header('Cache-Control', 'no-store');
    return c.json(result.value);
  });
  app.post('/v1/player/me', async (c) => {
    const result = await getProfile(c.env, await c.req.json().catch(() => undefined));
    if (!result.ok) return c.json({ error: result.error }, result.httpStatus);
    c.header('Cache-Control', 'no-store');
    return c.json(result.value);
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

  // 打野周榜公开页：静态壳 + 客户端拉取，与 /v1/leaderboard 同一份数据。
  app.get('/leaderboard', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.html(hunterPageHtml());
  });

  // 我的贡献统计（v0.6）：按安装哈希查累计上报 / 被采纳 / 抢救数。
  // 隐私：POST body 接收安装 ID（不进 URL，不落边缘访问日志），服务端只存
  // 加盐哈希；返回纯数字，无账号信息。
  app.post('/v1/contributions/stats', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
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
    const [reports, rescues, adopted] = await Promise.all([
      c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM active_labels
         WHERE installation_id = ?1 AND label = 'blocked'`,
      )
        .bind(installHash)
        .first<{ n: number }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM active_labels
         WHERE installation_id = ?1 AND label = 'allowed'`,
      )
        .bind(installHash)
        .first<{ n: number }>(),
      // 被采纳：该安装当前投了拉黑票，且账号社区净票数已达到公开门槛。
      c.env.DB.prepare(
        `SELECT COUNT(DISTINCT l.handle) AS n
         FROM active_labels l
         JOIN accounts a ON a.handle = l.handle
         WHERE l.installation_id = ?1
           AND l.label = 'blocked'
           AND a.report_count - a.rescue_count >= ?2`,
      )
        .bind(installHash, POLICY.communityNetThreshold)
        .first<{ n: number }>(),
    ]);
    return c.json({
      reports: reports?.n ?? 0,
      rescues: rescues?.n ?? 0,
      adopted: adopted?.n ?? 0,
    });
  });

  // 官网公开页：与社区 API 同一 Worker、同一域名（不再有独立静态站）。
  // 首页/公示页是代码内嵌 HTML，样式与图片走 ASSETS（打包在 admin/dist）。
  // 公示页数据请求从原来的跨域改为此域同源，/leaderboard 路由在上方对所有
  // host 生效，因此 feedsieve.win/leaderboard 与 API 域名行为一致。
  app.get('*', async (c) => {
    const path = c.req.path;
    // 早期链接手册里出现过 /lists.html 形式，归一到无扩展名路径。
    if (path === '/lists.html') {
      c.header('Cache-Control', 'no-store');
      return c.redirect('/lists', 301);
    }
    if (isSiteHost(c.req.raw, c.env)) {
      // 页面本身是静态壳，数据全部客户端拉取；显式 no-store 防止边缘把
      // 过渡窗口的错误响应缓存成"正式版" publics。
      if (path === '/') {
        c.header('Cache-Control', 'no-store');
        return c.html(homePageHtml());
      }
      if (path === '/lists') {
        c.header('Cache-Control', 'no-store');
        return c.html(listsPageHtml());
      }
      if (!c.env.ASSETS) {
        return c.json({ error: 'not_found' }, 404);
      }
      if (path === '/styles.css' || path.startsWith('/assets/')) {
        return c.env.ASSETS.fetch(staticAssetRequest(c.req.raw));
      }
      // 官网域名上不暴露管理端 SPA 兜底，未知路径一律 404。
      return c.json({ error: 'not_found' }, 404);
    }
    // 只有独立后台域名会落到前端资产；公开 API 域名不再暴露管理界面。
    if (!isAdminHost(c.req.raw, c.env) || !c.env.ASSETS) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.env.ASSETS.fetch(staticAssetRequest(c.req.raw));
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  app.onError((error, c) => {
    // 不打整个 error 对象：D1/nodemailer 错误消息可能嵌入绑定值（邮箱等敏感数据）
    const name = error instanceof Error ? error.name : 'Error';
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[community-api] ${c.req.method} ${c.req.path} -> 500 ${name}: ${message}`);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

// 定时发布是异步化的消费端：有脏标记才生成；内容未变时复用版本并清除标记。
// 生成失败不清标记 → 下一周期自然重试；生成期间到达的新变更（值已变）也保留。
async function scheduledAutoPublish(env: Cloudflare.Env): Promise<void> {
  try {
    const dirty = await readSnapshotDirty(env);
    if (dirty != null) {
      const published = await generateSnapshot(env);
      // 当日已有一版而内容又有变化时 generateSnapshot 返回 deferred：
      // 脏标记保留到下一自然日再由 cron 合并发布（day-once 日更语义）。
      if (!published.deferred) {
        await clearSnapshotDirty(env, dirty);
      }
      console.info(
        `[community-api] cron publish: version=${published.version}${published.deferred ? ' (deferred to next day)' : ''}`,
      );
      return;
    }
    // 无票面变更但官方暂停开关被部署配置翻转（开/关/理由变更）：仍需公开，
    // day-once 守卫在 generateSnapshot 内部把关（当日已发布则顺延）。
    if (await killSwitchNeedsPublish(env)) {
      const published = await generateSnapshot(env);
      console.info(`[community-api] cron publish (kill switch): version=${published.version}`);
    }
  } catch (error) {
    console.error('[community-api] cron publish failed:', error);
  }
}

// 路由表与中间件链只构建一次；每请求重建纯属浪费 CPU（env 每次调用传入）。
const app = createApp();

export default {
  fetch(request, env) {
    return app.fetch(request, env);
  },
  async scheduled(_controller, env) {
    await scheduledAutoPublish(env);
    // 打野排位赛：跨周结算（称号发放）。失败只记日志，下小时重试。
    try {
      const settled = await settleDueSeasons(env);
      if (settled > 0) console.info(`[community-api] cron settled seasons: ${settled}`);
    } catch (error) {
      console.error('[community-api] cron season settle failed:', error);
    }
  },
} satisfies ExportedHandler<Cloudflare.Env>;
