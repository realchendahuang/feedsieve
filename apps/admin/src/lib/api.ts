import { z } from 'zod';

export interface Dashboard {
  /** 社区净票达标数（进入公开名单的来源之一） */
  community_listed: number;
  /** 未达标的社区候选账号 */
  community_candidates: number;
  maintainer_entries: number;
  /** 客户端实际下载的最终名单条目数（快照 manifest） */
  public_entries: number;
  false_positive_feedback: number;
  /** 按安装×账号去重后的近期活跃举报关系数 */
  reports_last_24h: number;
  active_installations_last_24h: number;
  snapshot_version: string | null;
  snapshot_generated_at: number | null;
  snapshot_lag_seconds: number | null;
}

export interface CommunityCandidate {
  handle: string;
  x_user_id: string | null;
  category: string;
  status: string;
  report_count: number;
  rescue_count: number;
  net_votes: number;
  blocked_installs: number;
  allowed_installs: number;
  fingerprints: number;
  domains: number;
  sources: string[];
  first_report_at: number;
  updated_at: number;
}

export interface CommunityCandidatesResponse {
  entries: CommunityCandidate[];
  next_cursor: string | null;
  categories: string[];
}

export interface AccountEntry {
  handle: string;
  x_user_id: string | null;
  category: string;
  note: string;
  evidence_post_id: string | null;
  active: boolean;
  created_at: number;
  updated_at: number;
}

export interface AccountsResponse {
  entries: AccountEntry[];
  categories: readonly string[];
}

export interface KeywordPack {
  id: string;
  name_zh: string;
  name_en: string;
  description_zh: string;
  description_en: string;
  source_refs: string[];
  active: boolean;
  created_at: number;
  updated_at: number;
}

export interface KeywordRule {
  id: string;
  pack_id: string;
  phrase: string;
  terms: string[] | null;
  max_gap: number | null;
  active: boolean;
  created_at: number;
  updated_at: number;
}

export interface KeywordsResponse {
  packs: KeywordPack[];
  rules: KeywordRule[];
}

export interface FeedbackSummary {
  detection_source: string;
  rule_id: string;
  count: number;
}

export interface FeedbackEntry {
  handle: string;
  detection_source: string | null;
  rule_id: string | null;
  detection_reason: string | null;
  client_version: string | null;
  created_at: number;
  category: string | null;
  status: string | null;
  report_count: number | null;
  rescue_count: number | null;
}

export interface FeedbackResponse {
  summary: FeedbackSummary[];
  feedback: FeedbackEntry[];
}

export interface Release {
  id: number;
  kind: 'accounts' | 'keywords';
  version: string;
  actor_email: string;
  detail: Record<string, unknown>;
  created_at: number;
}

export interface VerifiedResponse {
  entries: Array<{
    handle: string;
    x_user_id: string | null;
    report_count: number;
    rescue_count: number;
    net_votes: number;
    updated_at: number;
  }>;
}

export interface ApplicationEntry {
  id: number;
  handle: string;
  kind: string;
  statement: string;
  status: string;
  created_at: number;
  verified_at: number | null;
  decided_at: number | null;
  decided_by: string | null;
  decision_note: string | null;
}

export interface ApplicationsResponse {
  entries: ApplicationEntry[];
}

/**
 * 响应结构运行时校验：服务端字段漂移（改名/类型变化）应当在数据进 UI 之前
 * 被拒绝为 invalid_response，而不是静默渲染成 —。仅覆盖主要读取端点；
 * 写操作响应字段少且 UI 已有降级路径，不逐一建模。
 */
const dashboardSchema = z.object({
  community_listed: z.number(),
  community_candidates: z.number(),
  maintainer_entries: z.number(),
  public_entries: z.number(),
  false_positive_feedback: z.number(),
  reports_last_24h: z.number(),
  active_installations_last_24h: z.number(),
  snapshot_version: z.string().nullable(),
  snapshot_generated_at: z.number().nullable(),
  snapshot_lag_seconds: z.number().nullable(),
});

const communityCandidateSchema = z.object({
  handle: z.string(),
  x_user_id: z.string().nullable(),
  category: z.string(),
  status: z.string(),
  report_count: z.number(),
  rescue_count: z.number(),
  net_votes: z.number(),
  blocked_installs: z.number(),
  allowed_installs: z.number(),
  fingerprints: z.number(),
  domains: z.number(),
  sources: z.array(z.string()),
  first_report_at: z.number(),
  updated_at: z.number(),
});
const communityCandidatesSchema = z.object({
  entries: z.array(communityCandidateSchema),
  next_cursor: z.string().nullable(),
  categories: z.array(z.string()),
});

const accountEntrySchema = z.object({
  handle: z.string(),
  x_user_id: z.string().nullable(),
  category: z.string(),
  note: z.string(),
  evidence_post_id: z.string().nullable(),
  active: z.boolean(),
  created_at: z.number(),
  updated_at: z.number(),
});
const accountsSchema = z.object({
  entries: z.array(accountEntrySchema),
  categories: z.array(z.string()),
});

const keywordPackSchema = z.object({
  id: z.string(),
  name_zh: z.string(),
  name_en: z.string(),
  description_zh: z.string(),
  description_en: z.string(),
  source_refs: z.array(z.string()),
  active: z.boolean(),
  created_at: z.number(),
  updated_at: z.number(),
});
const keywordRuleSchema = z.object({
  id: z.string(),
  pack_id: z.string(),
  phrase: z.string(),
  terms: z.array(z.string()).nullable(),
  max_gap: z.number().nullable(),
  active: z.boolean(),
  created_at: z.number(),
  updated_at: z.number(),
});
const keywordsSchema = z.object({
  packs: z.array(keywordPackSchema),
  rules: z.array(keywordRuleSchema),
});

const feedbackSchema = z.object({
  summary: z.array(
    z.object({
      detection_source: z.string(),
      rule_id: z.string(),
      count: z.number(),
    }),
  ),
  feedback: z.array(
    z.object({
      handle: z.string(),
      detection_source: z.string().nullable(),
      rule_id: z.string().nullable(),
      detection_reason: z.string().nullable(),
      client_version: z.string().nullable(),
      created_at: z.number(),
      category: z.string().nullable(),
      status: z.string().nullable(),
      report_count: z.number().nullable(),
      rescue_count: z.number().nullable(),
    }),
  ),
});

const releaseSchema = z.object({
  id: z.number(),
  kind: z.enum(['accounts', 'keywords']),
  version: z.string(),
  actor_email: z.string(),
  detail: z.record(z.string(), z.unknown()),
  created_at: z.number(),
});
const releasesSchema = z.object({ releases: z.array(releaseSchema) });

const verifiedEntrySchema = z.object({
  handle: z.string(),
  x_user_id: z.string().nullable(),
  report_count: z.number(),
  rescue_count: z.number(),
  net_votes: z.number(),
  updated_at: z.number(),
});
const verifiedSchema = z.object({ entries: z.array(verifiedEntrySchema) });

const applicationEntrySchema = z.object({
  id: z.number(),
  handle: z.string(),
  kind: z.string(),
  statement: z.string(),
  status: z.string(),
  created_at: z.number(),
  verified_at: z.number().nullable(),
  decided_at: z.number().nullable(),
  decided_by: z.string().nullable(),
  decision_note: z.string().nullable(),
});
const applicationsSchema = z.object({ entries: z.array(applicationEntrySchema) });

async function request<T>(
  path: string,
  init: RequestInit = {},
  schema?: z.ZodType<T>,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  const response = await fetch(`/api/admin${path}`, {
    ...init,
    headers,
    credentials: 'same-origin',
    signal: AbortSignal.timeout(15_000),
  });
  // Access and local SPA fallbacks may return HTML for both error and success
  // responses. Decode once and keep parser/proxy details out of the UI.
  const raw = await response.text().catch(() => '');
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    // HTML, an empty body, or a proxy error page.
  }
  if (!response.ok) {
    const code = typeof body?.error === 'string' ? body.error : `http_${response.status}`;
    throw new Error(code);
  }
  if (!body) {
    throw new Error('invalid_response');
  }
  if (schema) {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new Error('invalid_response');
    }
    return parsed.data;
  }
  return body as T;
}

/** POST /accounts 请求体：handle 已归一化（无 @，小写）。 */
export interface AccountInput {
  handle: string;
  category: string;
  x_user_id: string | null;
  evidence_post_id: string | null;
  note: string;
}

/** POST /keywords/packs 请求体。 */
export interface PackInput {
  id?: string;
  name_zh: string;
  name_en: string;
  description_zh: string;
  description_en: string;
  source_refs: string[];
}

/** POST /keywords/rules 请求体。 */
export interface RuleInput {
  id?: string;
  pack_id: string;
  phrase: string;
  terms: string[];
  max_gap?: number;
}

export const getVerified = (params: { q?: string } = {}) =>
  request<VerifiedResponse>(
    `/verified${params.q ? `?q=${encodeURIComponent(params.q)}` : ''}`,
    {},
    verifiedSchema,
  );
export const getDashboard = () => request<Dashboard>('/dashboard', {}, dashboardSchema);
export const getAccounts = () => request<AccountsResponse>('/accounts', {}, accountsSchema);
export const getCommunityCandidates = (params: {
  net?: string;
  q?: string;
  category?: string;
  cursor?: string;
  limit?: number;
}) => {
  const search = new URLSearchParams();
  if (params.net) search.set('net', params.net);
  if (params.q) search.set('q', params.q);
  if (params.category) search.set('category', params.category);
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.limit) search.set('limit', String(params.limit));
  const query = search.toString();
  return request<CommunityCandidatesResponse>(
    `/community-accounts${query ? `?${query}` : ''}`,
    {},
    communityCandidatesSchema,
  );
};
export const getKeywords = () => request<KeywordsResponse>('/keywords', {}, keywordsSchema);
export const getFeedback = () => request<FeedbackResponse>('/feedback', {}, feedbackSchema);
export const getApplications = (params: { status?: string } = {}) =>
  request<ApplicationsResponse>(
    `/applications${params.status ? `?status=${encodeURIComponent(params.status)}` : ''}`,
    {},
    applicationsSchema,
  );
export const decideApplication = (id: number, decision: 'approved' | 'rejected', note?: string) =>
  request<{ changed: boolean }>(`/applications/${id}/decide`, {
    method: 'POST',
    body: JSON.stringify({ decision, note }),
  });
export const getReleases = async () =>
  (await request<{ releases: Release[] }>('/releases', {}, releasesSchema)).releases;
export const getMe = () => request<{ email: string }>('/me');

export const importKeywordCatalog = () =>
  request<{ imported: boolean; packs: number; rules: number }>('/keywords/import', { method: 'POST' });

/** GET/POST /keywords/detector-config：天级判定参数（对象或 null=清除）。 */
export const getDetectorConfig = () =>
  request<{ detector_config: unknown }>('/keywords/detector-config');
export const saveDetectorConfig = (detector_config: unknown | null) =>
  request<{ saved: boolean | null; version: string | null }>(
    '/keywords/detector-config',
    { method: 'POST', body: JSON.stringify({ detector_config }) },
  );

// 保存/移除即发布：响应携带新版本号，界面不再有独立发布步骤。
export const saveAccount = (body: AccountInput) =>
  request<{ action: 'add' | 'update'; entry: AccountEntry; snapshot_version?: string }>('/accounts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const removeAccount = (handle: string) =>
  request<{ changed: boolean; snapshot_version?: string }>(`/accounts/${encodeURIComponent(handle)}`, {
    method: 'DELETE',
  });

export const savePack = (body: PackInput) =>
  request<{ id: string; version?: string | null }>('/keywords/packs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const saveRule = (body: RuleInput) =>
  request<{ id: string; version?: string | null }>('/keywords/rules', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const removePack = (id: string) =>
  request<{ changed: boolean; version?: string | null }>(`/keywords/packs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
export const removeRule = (id: string) =>
  request<{ changed: boolean; version?: string | null }>(`/keywords/rules/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
export const rollbackRelease = (id: number) =>
  request<{ version?: string; snapshot_version?: string }>(`/releases/${id}/rollback`, { method: 'POST' });
