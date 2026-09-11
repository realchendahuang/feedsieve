import { installationHash } from './labels';

/**
 * 关键词贡献：用户在关键词页显式把自己的自定义短语匿名提交给运营审阅。
 * 只提交用户主动挑选的短语，绝不附带关键词以外的任何内容；
 * 命中聚合（哪些账号被这个词命中）走既有 /v1 通用通道，两条通道各归各。
 */

const MAX_PHRASE_LENGTH = 80;
const MAX_PHRASES_PER_REQUEST = 20;
/** 单安装每日提交上限：与自定义关键词 80 条上限对齐并留重试余量 */
const MAX_PHRASES_PER_DAY = 40;

export interface KeywordContributionResult {
  phrase: string;
  status: 'recorded' | 'duplicate' | 'rejected' | 'rate_limited';
  error?: string;
}

export type ProcessKeywordContributionResult =
  | { ok: true; results: KeywordContributionResult[] }
  | { ok: false; httpStatus: 400 | 413 | 429; error: string };

function normPhrase(value: string): string {
  return value.trim().normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').toLocaleLowerCase();
}

function validatedPhrase(raw: unknown): { display: string; norm: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'phrase_must_be_string' };
  const display = raw.trim();
  if (display.length < 1 || display.length > MAX_PHRASE_LENGTH) {
    return { error: 'invalid_phrase_length' };
  }
  return { display, norm: normPhrase(display) };
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export async function processKeywordContributions(
  env: Cloudflare.Env,
  body: unknown,
): Promise<ProcessKeywordContributionResult> {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, httpStatus: 400, error: 'invalid_json_body' };
  }
  const b = body as Record<string, unknown>;
  const installationId = b.installation_id;
  if (
    typeof installationId !== 'string' ||
    installationId.length < 8 ||
    installationId.length > 128
  ) {
    return { ok: false, httpStatus: 400, error: 'invalid_installation_id' };
  }
  if (!Array.isArray(b.phrases) || b.phrases.length === 0) {
    return { ok: false, httpStatus: 400, error: 'phrases_must_be_non_empty_array' };
  }
  if (b.phrases.length > MAX_PHRASES_PER_REQUEST) {
    return { ok: false, httpStatus: 413, error: 'batch_too_large' };
  }

  // 与 rescues/reports 一致的有效性校验（preserve 短语原文供审阅）。
  const results: Array<KeywordContributionResult> = [];
  const valid: Array<{ phrase: string; norm: string; resultIndex: number }> = [];
  const seenNorms = new Set<string>();
  for (const phrase of b.phrases) {
    const v = validatedPhrase(phrase);
    if ('error' in v) {
      results.push({
        phrase: typeof phrase === 'string' ? phrase : String(phrase),
        status: 'rejected',
        error: v.error,
      });
      continue;
    }
    if (seenNorms.has(v.norm)) {
      results.push({ phrase: v.display, status: 'duplicate' });
      continue;
    }
    seenNorms.add(v.norm);
    results.push({ phrase: v.display, status: 'recorded' });
    valid.push({ phrase: v.display, norm: v.norm, resultIndex: results.length - 1 });
  }
  if (valid.length === 0) {
    return { ok: true, results };
  }

  const installHash = (await installationHash(env, installationId)).hash;
  const today = utcToday();
  const validNorms = valid.map((item) => item.norm);

  // 客户端在网络超时后可能重试整个请求：与 rescues 一样，只有还没生效的提交
  // 才消耗每日额度；重复提交走主键幂等，不会把瞬时失败变成额度锁死。
  const existingNorms = new Set(
    (
      await env.DB.prepare(
        `SELECT norm_phrase FROM keyword_contributions
         WHERE installation_id = ?1
           AND norm_phrase IN (${validNorms.map((_, index) => `?${index + 2}`).join(', ')})`,
      )
        .bind(installHash, ...validNorms)
        .all<{ norm_phrase: string }>()
    ).results.map((row) => row.norm_phrase),
  );
  const quotaUnits = valid.filter((item) => !existingNorms.has(item.norm)).length;
  if (quotaUnits > 0) {
    const used = await env.DB.prepare(
      `SELECT COUNT(*) AS used FROM keyword_contributions
       WHERE installation_id = ?1
         AND created_at > CAST(strftime('%s', ?2) AS INTEGER) - 86400`,
    )
      .bind(installHash, today)
      .first<{ used: number }>();
    if ((used?.used ?? 0) + quotaUnits > MAX_PHRASES_PER_DAY) {
      return { ok: false, httpStatus: 429, error: 'rate_limited' };
    }
  }

  const statements = valid.map((item) =>
    env.DB.prepare(
      `INSERT INTO keyword_contributions
         (norm_phrase, installation_id, display_phrase, client_version, status, created_at)
       VALUES (?1, ?2, ?3, ?4, 'new', ?5)
       ON CONFLICT(norm_phrase, installation_id) DO NOTHING`,
    ).bind(
      item.norm,
      installHash,
      item.phrase,
      typeof b.client_version === 'string' ? b.client_version.slice(0, 20) : null,
      nowSeconds(),
    ),
  );
  const metas = await env.DB.batch(statements);
  metas.forEach((raw, index) => {
    const changes = (raw as { meta?: { changes?: number } }).meta?.changes ?? 0;
    if (changes === 0) {
      results[valid[index]!.resultIndex] = { phrase: valid[index]!.phrase, status: 'duplicate' };
    }
  });

  return { ok: true, results };
}

/** 运营审阅用：待审（new）列表。 */
export interface KeywordContributionRow {
  id: number;
  norm_phrase: string;
  display_phrase: string;
  client_version: string | null;
  created_at: number;
}

export async function listKeywordContributions(
  env: Cloudflare.Env,
): Promise<{ contributions: KeywordContributionRow[] }> {
  const rows = await env.DB.prepare(
    `SELECT rowid AS id, norm_phrase, display_phrase, client_version, created_at
     FROM keyword_contributions
     WHERE status = 'new'
     ORDER BY created_at DESC
     LIMIT 200`,
  ).all<KeywordContributionRow>();
  return { contributions: rows.results };
}
