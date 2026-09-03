export interface Dashboard {
  maintainer_entries: number;
  community_accounts: number;
  false_positive_feedback: number;
  snapshot_version: string | null;
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
  source_refs: string;
  active: number;
  created_at: number;
  updated_at: number;
}

export interface KeywordRule {
  id: string;
  pack_id: string;
  phrase: string;
  terms: string | null;
  max_gap: number | null;
  active: number;
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
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    const code = typeof body?.error === 'string' ? body.error : `http_${response.status}`;
    throw new Error(code === 'access_required' ? 'Access 身份未授权' : code);
  }
  return response.json() as Promise<T>;
}

export const getDashboard = () => request<Dashboard>('/dashboard');
export const getAccounts = () => request<AccountsResponse>('/accounts');
export const getKeywords = () => request<KeywordsResponse>('/keywords');
export const getFeedback = () => request<FeedbackResponse>('/feedback');
export const getReleases = async () => (await request<{ releases: Release[] }>('/releases')).releases;
export const getMe = () => request<{ email: string }>('/me');

export const saveAccount = (body: Record<string, unknown>) =>
  request<{ action: 'add' | 'update'; entry: AccountEntry }>('/accounts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const removeAccount = (handle: string) => request<{ changed: boolean }>(`/accounts/${encodeURIComponent(handle)}`, { method: 'DELETE' });
export const publishAccounts = () => request<{ snapshot_version: string; active_entries: number }>('/accounts/publish', { method: 'POST' });

export const savePack = (body: Record<string, unknown>) =>
  request<{ id: string }>('/keywords/packs', { method: 'POST', body: JSON.stringify(body) });
export const saveRule = (body: Record<string, unknown>) =>
  request<{ id: string }>('/keywords/rules', { method: 'POST', body: JSON.stringify(body) });
export const removePack = (id: string) => request<{ changed: boolean }>(`/keywords/packs/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const removeRule = (id: string) => request<{ changed: boolean }>(`/keywords/rules/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const publishKeywords = () => request<{ version: string; packs: number; rules: number }>('/keywords/publish', { method: 'POST' });
export const rollbackRelease = (id: number) => request<{ version?: string; snapshot_version?: string }>(`/releases/${id}/rollback`, { method: 'POST' });
