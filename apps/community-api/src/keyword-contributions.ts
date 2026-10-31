import { and, count, desc, eq, inArray, max, sql } from 'drizzle-orm';
import { getDb } from './db/client';
import { keywordContribUsage, keywordContributions } from './db/schema';
import { installationHash } from './labels';
import { hashIp } from './lib/hash';
import { collateC, compareText, stripNul } from './lib/sql';
import { nowSeconds, utcToday } from './lib/time';

/**
 * 关键词贡献：用户在关键词页显式把自己的自定义短语匿名提交给运营审阅。
 * 只提交用户主动挑选的短语，绝不附带关键词以外的任何内容；
 * 命中聚合（哪些账号被这个词命中）走既有 /v1 通用通道，两条通道各归各。
 */

const MAX_PHRASE_LENGTH = 80;
const MAX_PHRASES_PER_REQUEST = 20;
/** 网页匿名提交单次上限：页面上一次粘贴不能塞太多 */
const MAX_WEB_PHRASES_PER_REQUEST = 10;
/** 单安装每日提交上限：与自定义关键词 80 条上限对齐并留重试余量 */
const MAX_PHRASES_PER_DAY = 40;
/** 网页匿名（按 IP 哈希）每日上限：挡自动化脚本刷接口 */
const MAX_WEB_PHRASES_PER_DAY = 5;

export interface KeywordContributionResult {
  phrase: string;
  status: 'recorded' | 'duplicate' | 'rejected' | 'rate_limited';
  error?: string;
}

export type ProcessKeywordContributionResult =
  | { ok: true; results: KeywordContributionResult[] }
  | { ok: false; httpStatus: 400 | 413 | 429; error: string };

export interface ProcessKeywordContributionInput {
  body: unknown;
  /** 网页匿名提交者的 IP；扩展通道走 installation_id，网页通道必须有 IP。 */
  ip: string | null;
}

function normPhrase(value: string): string {
  return value
    .trim()
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLocaleLowerCase();
}

function validatedPhrase(raw: unknown): { display: string; norm: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'phrase_must_be_string' };
  const display = stripNul(raw).trim();
  if (display.length < 1 || display.length > MAX_PHRASE_LENGTH) {
    return { error: 'invalid_phrase_length' };
  }
  return { display, norm: normPhrase(display) };
}

export async function processKeywordContributions(
  env: Cloudflare.Env,
  { body, ip }: ProcessKeywordContributionInput,
): Promise<ProcessKeywordContributionResult> {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, httpStatus: 400, error: 'invalid_json_body' };
  }
  const b = body as Record<string, unknown>;
  // 双通道：扩展带 installation_id（可信度较高、日额度宽）；网页匿名只认 IP（Salting hash），
  // 每日额度收紧，防自动化脚本刷词库。
  const isWebChannel = b.installation_id === undefined || b.installation_id === null;
  const maxPhrasesPerRequest = isWebChannel ? MAX_WEB_PHRASES_PER_REQUEST : MAX_PHRASES_PER_REQUEST;
  let submissionKey: string;
  if (isWebChannel) {
    if (typeof ip !== 'string' || ip.length === 0) {
      return { ok: false, httpStatus: 400, error: 'ip_required_for_web_submission' };
    }
    // 与 reports 的 IP 哈希同盐同法（独立 ip: 域前缀，见 lib/hash.ts 域分离口径）：绝不存原始 IP。
    submissionKey = `web-${await hashIp(env.INSTALLATION_SALT, ip)}`;
  } else {
    const installationId = b.installation_id;
    if (
      typeof installationId !== 'string' ||
      installationId.length < 8 ||
      installationId.length > 128
    ) {
      return { ok: false, httpStatus: 400, error: 'invalid_installation_id' };
    }
    submissionKey = (await installationHash(env, installationId)).hash;
  }
  if (!Array.isArray(b.phrases) || b.phrases.length === 0) {
    return { ok: false, httpStatus: 400, error: 'phrases_must_be_non_empty_array' };
  }
  if (b.phrases.length > maxPhrasesPerRequest) {
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

  const db = getDb(env);
  const validNorms = valid.map((item) => item.norm);
  const dailyLimit = isWebChannel ? MAX_WEB_PHRASES_PER_DAY : MAX_PHRASES_PER_DAY;

  // 客户端在网络超时后可能重试整个请求：与 rescues 一样，只有还没生效的提交
  // 才消耗每日额度；重复提交走主键幂等，不会把瞬时失败变成额度锁死。
  const existingNorms = new Set(
    (
      await db
        .select({ normPhrase: keywordContributions.normPhrase })
        .from(keywordContributions)
        .where(
          and(
            eq(keywordContributions.installationId, submissionKey),
            inArray(keywordContributions.normPhrase, validNorms),
          ),
        )
    ).map((row) => row.normPhrase),
  );
  const quotaUnits = valid.filter((item) => !existingNorms.has(item.norm)).length;
  if (quotaUnits > 0) {
    // 原子预留本批额度（条件 UPSERT 本身即门禁，杜绝并发 COUNT 检查两写并存）。
    // 与 rescues 语义一致：预留消耗即计入全天，即使后续写入失败不做回退（日切换归还）。
    const today = utcToday();
    const usedToday = sql`CASE WHEN ${keywordContribUsage.day} = excluded.day THEN ${keywordContribUsage.used} ELSE 0 END`;
    const reserved = await db
      .insert(keywordContribUsage)
      .values({ submissionKey, day: today, used: quotaUnits })
      .onConflictDoUpdate({
        target: keywordContribUsage.submissionKey,
        set: {
          day: sql`excluded.day`,
          used: sql`${usedToday} + excluded.used`,
        },
        setWhere: sql`${usedToday} + excluded.used <= ${dailyLimit}`,
      })
      .returning({ submissionKey: keywordContribUsage.submissionKey });
    if (reserved.length === 0) {
      return { ok: false, httpStatus: 429, error: 'rate_limited' };
    }
  }

  // 一条 INSERT 写入整批；冲突（同来源同词已存在）不返回行，据此标记 duplicate。
  const createdAt = nowSeconds();
  const clientVersion =
    typeof b.client_version === 'string' ? stripNul(b.client_version).slice(0, 20) : null;
  const inserted = await db
    .insert(keywordContributions)
    .values(
      // 按主键排序：并发批量写入以相同顺序锁行，避免死锁
      [...valid]
        .sort((a, b) => compareText(a.norm, b.norm))
        .map((item) => ({
          normPhrase: item.norm,
          installationId: submissionKey,
          displayPhrase: item.phrase,
          clientVersion,
          status: 'new',
          createdAt,
        })),
    )
    .onConflictDoNothing()
    .returning({ normPhrase: keywordContributions.normPhrase });
  const insertedNorms = new Set(inserted.map((row) => row.normPhrase));
  for (const item of valid) {
    if (!insertedNorms.has(item.norm)) {
      results[item.resultIndex] = { phrase: item.phrase, status: 'duplicate' };
    }
  }

  return { ok: true, results };
}

/** 运营审阅用：待审（new）列表，按归一化词聚合（同一词多个来源只占一行）。 */
export interface KeywordContributionRow {
  norm_phrase: string;
  display_phrase: string;
  /** 独立提交来源数（扩展安装 / 匿名 IP 计票不区分展示）。 */
  reports: number;
  created_at: number;
}

export async function listKeywordContributions(
  env: Cloudflare.Env,
): Promise<{ contributions: KeywordContributionRow[] }> {
  const lastCreatedAt = max(keywordContributions.createdAt);
  const rows = await getDb(env)
    .select({
      norm_phrase: keywordContributions.normPhrase,
      display_phrase: sql<string>`min(${collateC(keywordContributions.displayPhrase)})`.mapWith(
        String,
      ),
      reports: count(),
      last_created_at: lastCreatedAt.mapWith(Number),
    })
    .from(keywordContributions)
    .where(eq(keywordContributions.status, 'new'))
    .groupBy(keywordContributions.normPhrase)
    .orderBy(desc(lastCreatedAt))
    .limit(200);
  return {
    contributions: rows.map((row) => ({
      norm_phrase: row.norm_phrase,
      display_phrase: row.display_phrase,
      reports: row.reports,
      created_at: row.last_created_at,
    })),
  };
}

export type KeywordContributionDecision = 'admitted' | 'rejected';

/**
 * 运营审阅决定：按归一化词批量改状态。审阅只在后台进行，
 * 'admitted' / 'rejected' 都只是待审队列的状态标记，不自动写入官方词库、不改变
 * 快照与公共数据；真正入库由维护者把词加进工作区后走显式发布链路。
 */
export async function decideKeywordContributions(
  env: Cloudflare.Env,
  normPhrase: string,
  decision: KeywordContributionDecision,
  maintainerEmail: string,
): Promise<{ changed: number }> {
  const changed = await getDb(env)
    .update(keywordContributions)
    .set({ status: decision, decidedAt: nowSeconds(), decidedBy: maintainerEmail })
    .where(
      and(
        eq(keywordContributions.normPhrase, stripNul(normPhrase)),
        eq(keywordContributions.status, 'new'),
      ),
    )
    .returning({ normPhrase: keywordContributions.normPhrase });
  return { changed: changed.length };
}
