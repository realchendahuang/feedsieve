import { cors } from 'hono/cors';
import { Hono } from 'hono';
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
  disableAdminKeyword,
  importKeywordCatalog,
  listAdminKeywords,
  publishAdminKeywords,
  rollbackAdminKeywordRelease,
  saveAdminKeywordPack,
  saveAdminKeywordRule,
} from './keyword-admin';
import { MAINTAINER_CATEGORIES } from './maintainer-blocklist';
import { processRetractionBatch } from './labels';
import { POLICY, processReportBatch, publicPolicy } from './reports';
import { processRescueBatch } from './rescues';
import {
  generateSnapshot,
  getLatestSnapshot,
  getLatestSnapshotFile,
  getSnapshotFile,
  PUBLIC_BLOCKLIST_PACK,
  SNAPSHOT_PACK,
} from './snapshot';

function isAdminHost(request: Request, env: Cloudflare.Env): boolean {
  const configured = env.ADMIN_HOST?.trim().toLowerCase();
  return Boolean(configured) && new URL(request.url).hostname.toLowerCase() === configured;
}

function staticAssetRequest(request: Request): Request {
  // assets.not_found_handling = single-page-application resolves TanStack routes
  // to the shell while keeping the incoming URL intact.
  return request;
}

export function createApp() {
  const app = new Hono<{ Bindings: Cloudflare.Env; Variables: { maintainerEmail: string } }>();

  // 扩展 content script 会跨域 POST，必须放行预检
  app.use('*', cors());

  app.get('/healthz', (c) =>
    c.json({
      ok: true,
      service: 'feedsieve-community-api',
      time: new Date().toISOString(),
    }),
  );

  app.post('/v1/reports', async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const result = await processReportBatch(c.env, body);
    if (!result.ok) {
      return c.json({ error: result.error }, result.httpStatus);
    }
    const published = await generateSnapshot(c.env);
    return c.json({
      policy: {
        formula: 'block_votes - false_positive_votes',
        min_net_votes: POLICY.communityNetThreshold,
        daily_report_limit: POLICY.dailyReportLimit,
      },
      results: result.results,
      snapshot_version: published.version,
    });
  });

  // React 管理端使用 Cloudflare Access 身份；此路由永远不接受旧的 Bearer 凭据。
  app.use('/api/admin/*', async (c, next) => {
    if (!isAdminHost(c.req.raw, c.env)) return c.json({ error: 'not_found' }, 404);
    const identity = await verifyAccess(c.req.raw, c.env);
    if (!identity) return c.json({ error: 'access_required' }, 401);
    c.set('maintainerEmail', identity.email);
    await next();
  });

  app.get('/api/admin/me', (c) => c.json({ email: c.get('maintainerEmail') }));

  app.get('/api/admin/dashboard', async (c) => {
    const [draftCount, votes, feedback, snapshot] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) AS n FROM admin_account_drafts WHERE active = 1').first<{ n: number }>(),
      c.env.DB.prepare('SELECT COUNT(*) AS n FROM accounts').first<{ n: number }>(),
      c.env.DB.prepare('SELECT COUNT(*) AS n FROM rescues').first<{ n: number }>(),
      getLatestSnapshot(c.env),
    ]);
    return c.json({
      maintainer_entries: draftCount?.n ?? 0,
      community_accounts: votes?.n ?? 0,
      false_positive_feedback: feedback?.n ?? 0,
      snapshot_version: snapshot ? JSON.parse(snapshot.manifest).snapshot_version ?? null : null,
    });
  });

  app.get('/api/admin/accounts', async (c) =>
    c.json({
      entries: await listAdminAccountDrafts(c.env, { q: c.req.query('q'), limit: 500 }),
      categories: MAINTAINER_CATEGORIES,
    }),
  );
  app.post('/api/admin/accounts', async (c) => {
    const result = await saveAdminAccountDraft(c.env, await c.req.json().catch(() => undefined));
    if (!result.ok) return c.json({ error: result.error }, 400);
    await recordAdminAudit(c.env, c.get('maintainerEmail'), `${result.action}_draft`, 'account', result.entry.handle);
    return c.json({ action: result.action, entry: result.entry }, 201);
  });
  app.delete('/api/admin/accounts/:handle', async (c) => {
    const result = await deactivateAdminAccountDraft(c.env, c.req.param('handle'));
    if (!result.ok) return c.json({ error: result.error }, 400);
    if (result.changed) {
      await recordAdminAudit(c.env, c.get('maintainerEmail'), 'remove_draft', 'account', c.req.param('handle'));
    }
    return c.json({ changed: result.changed });
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
    return item ? c.json(item, 201) : c.json({ error: 'invalid_pack' }, 400);
  });
  app.post('/api/admin/keywords/rules', async (c) => {
    const item = await saveAdminKeywordRule(c.env, await c.req.json().catch(() => undefined), c.get('maintainerEmail'));
    return item ? c.json(item, 201) : c.json({ error: 'invalid_rule' }, 400);
  });
  app.delete('/api/admin/keywords/packs/:id', async (c) =>
    c.json({
      changed: await disableAdminKeyword(c.env, 'admin_keyword_packs', c.req.param('id'), c.get('maintainerEmail')),
    }),
  );
  app.delete('/api/admin/keywords/rules/:id', async (c) =>
    c.json({
      changed: await disableAdminKeyword(c.env, 'admin_keyword_rules', c.req.param('id'), c.get('maintainerEmail')),
    }),
  );
  app.post('/api/admin/keywords/publish', async (c) => {
    try {
      return c.json(await publishAdminKeywords(c.env, c.get('maintainerEmail')));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'publish_failed' }, 400);
    }
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
    const published = await generateSnapshot(c.env);
    return c.json({ results: result.results, snapshot_version: published.version });
  });

  app.post('/v1/labels/retract', async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const result = await processRetractionBatch(c.env, body);
    if (!result.ok) {
      return c.json({ error: result.error }, result.httpStatus);
    }
    const published = await generateSnapshot(c.env);
    return c.json({ results: result.results, snapshot_version: published.version });
  });

  // 公开政策：阈值不藏在后端黑箱里
  app.get('/v1/policy', (c) => c.json(publicPolicy()));

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

  // 只有独立后台域名会落到前端资产；公开 API 域名不再暴露管理界面。
  app.get('*', async (c) => {
    if (!isAdminHost(c.req.raw, c.env) || !c.env.ASSETS) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.env.ASSETS.fetch(staticAssetRequest(c.req.raw));
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  app.onError((error, c) => {
    console.error('[community-api]', error);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

// 定时发布是兜底校验；正常投票和维护者修改已在请求完成前立即发布。
async function scheduledAutoPublish(env: Cloudflare.Env): Promise<void> {
  try {
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM snapshots').first<{
      n: number;
    }>();
    const published = await generateSnapshot(env);
    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM snapshots').first<{
      n: number;
    }>();
    const createdNew = (after?.n ?? 0) > (before?.n ?? 0);
    console.info(`[community-api] cron publish: version=${published.version} new=${createdNew}`);
  } catch (error) {
    console.error('[community-api] cron publish failed:', error);
  }
}

export default {
  fetch(request, env) {
    return createApp().fetch(request, env);
  },
  async scheduled(_controller, env) {
    await scheduledAutoPublish(env);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
