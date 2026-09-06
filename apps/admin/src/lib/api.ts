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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  const response = await fetch(`/api/admin${path}`, {
    ...init,
    headers,
    credentials: 'same-origin',
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
  return body as T;
}

export const getDashboard = () => request<Dashboard>('/dashboard');
export const getAccounts = () => request<AccountsResponse>('/accounts');
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
  return request<CommunityCandidatesResponse>(`/community-accounts${query ? `?${query}` : ''}`);
};
export const getKeywords = () => request<KeywordsResponse>('/keywords');
export const getFeedback = () => request<FeedbackResponse>('/feedback');
export const getReleases = async () => (await request<{ releases: Release[] }>('/releases')).releases;
export const getMe = () => request<{ email: string }>('/me');

export const importKeywordCatalog = () =>
  request<{ imported: boolean; packs: number; rules: number }>('/keywords/import', { method: 'POST' });
// 保存/移除即发布：响应携带新版本号，界面不再有独立发布步骤。
export const saveAccount = (body: Record<string, unknown>) =>
  request<{ action: 'add' | 'update'; entry: AccountEntry; snapshot_version?: string }>('/accounts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const removeAccount = (handle: string) =>
  request<{ changed: boolean; snapshot_version?: string }>(`/accounts/${encodeURIComponent(handle)}`, {
    method: 'DELETE',
  });

export const savePack = (body: Record<string, unknown>) =>
  request<{ id: string; version?: string | null }>('/keywords/packs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const saveRule = (body: Record<string, unknown>) =>
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
