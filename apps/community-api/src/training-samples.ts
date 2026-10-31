import { parseTrainingSample, parseSampleReview } from '@feedsieve/shared';
import { alias } from 'drizzle-orm/pg-core';
import { eq, gt, lte, and, sql } from 'drizzle-orm';
import { getDb } from './db/client';
import { trainingSampleReviews, trainingSamples } from './db/schema';
import { hashInstallationId, hashIp, sha256Hex } from './lib/hash';
import { nowSeconds, utcToday } from './lib/time';
import { chargeUsageInOrder } from './lib/usage';
import { compareText, stripNul } from './lib/sql';

export async function ingestTrainingSamples(env: Cloudflare.Env, raw: unknown, ip?: string) {
  const b = raw as Record<string, unknown> | null;
  if (
    !b ||
    typeof b.installation_id !== 'string' ||
    b.installation_id.length < 8 ||
    b.installation_id.length > 128 ||
    !Array.isArray(b.samples) ||
    b.samples.length < 1 ||
    b.samples.length > 20
  ) {
    return { status: 400 as const, body: { error: 'invalid_samples_request' } };
  }
  const now = nowSeconds();
  const rejected: Array<{ eventId: string | null; error: string }> = [];
  const samples = b.samples
    .map((raw) => {
      const sample = parseTrainingSample(raw);
      if (sample && sample.actedAt <= now * 1000 + 300_000) return sample;
      const id =
        raw && typeof raw === 'object' ? (raw as Record<string, unknown>).eventId : undefined;
      rejected.push({
        eventId: typeof id === 'string' && id.length === 36 ? id : null,
        error: 'invalid_sample',
      });
      return null;
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
  if (!samples.length)
    return { status: 200 as const, body: { accepted: [] as string[], rejected } };
  const identity = await hashInstallationId(env.INSTALLATION_SALT, b.installation_id);
  // Charge requests including retries: bounded immutable history even for already-voting accounts.
  // 先 IP 后安装，串成一条语句：IP 超限则安装计数不动，IP 通过而安装超限时 IP 已扣（与逐项依次执行一致）。
  const db = getDb(env);
  const limits: Array<[string, number]> = [
    ...(ip ? [[`ip:${await hashIp(env.INSTALLATION_SALT, ip)}`, 1000] as [string, number]] : []),
    [`install:${identity}`, 300],
  ];
  if (!(await chargeUsageInOrder(db, utcToday(), samples.length, limits))) {
    return { status: 429 as const, body: { error: 'rate_limited' } };
  }
  // 按唯一键排序：同一安装并发重试同一批样本时以相同顺序锁行，避免死锁
  const rows = (
    await Promise.all(
      samples.map(async (s) => ({
        installationId: identity,
        eventId: s.eventId,
        handle: s.handle,
        action: s.action,
        observedAt: s.observedAt,
        receivedAt: now,
        contentHash: await sha256Hex(
          JSON.stringify([s.text ?? '', s.displayName ?? '', s.bio ?? '']),
        ),
        payload: JSON.stringify(s),
      })),
    )
  ).sort((a, b) => compareText(a.eventId, b.eventId));
  await db
    .insert(trainingSamples)
    .values(rows)
    .onConflictDoNothing({ target: [trainingSamples.installationId, trainingSamples.eventId] });
  return { status: 200 as const, body: { accepted: samples.map((s) => s.eventId), rejected } };
}

export async function listTrainingSamples(
  env: Cloudflare.Env,
  after = 0,
  limit = 50,
  until?: number,
  reviewUntil?: number,
) {
  const db = getDb(env);
  let maxId = until;
  let maxReviewId = reviewUntil;
  if (maxId === undefined || maxReviewId === undefined) {
    // 水位要在所有已分配的 id 都提交之后再读：自增 id 不按提交顺序可见，直接读 MAX(id) 可能跳过
    // 一条 id 更小、稍晚提交的样本，之后按游标翻页就永远漏掉它。SHARE 锁会等正在进行的插入提交，
    // 读完立刻随事务释放（只有后台导出走这里，不影响上报热路径）。
    const bounds = await db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE ${trainingSamples}, ${trainingSampleReviews} IN SHARE MODE`);
      const [row] = await tx.execute<{ samples: number; reviews: number }>(
        sql`SELECT (SELECT COALESCE(MAX(id),0) FROM ${trainingSamples}) AS samples, (SELECT COALESCE(MAX(id),0) FROM ${trainingSampleReviews}) AS reviews`,
      );
      return row!;
    });
    maxId ??= bounds.samples;
    maxReviewId ??= bounds.reviews;
  }
  const r = alias(trainingSampleReviews, 'r');
  const rows = await db
    .select({
      id: trainingSamples.id,
      received_at: trainingSamples.receivedAt,
      content_hash: trainingSamples.contentHash,
      payload: trainingSamples.payload,
      review_id: r.id,
      verdict: r.verdict,
      family: r.family,
      tags: r.tags,
      note: r.note,
      reviewed_at: r.createdAt,
    })
    .from(trainingSamples)
    .leftJoin(
      r,
      eq(
        r.id,
        sql`(SELECT MAX(id) FROM ${trainingSampleReviews} WHERE ${trainingSampleReviews.sampleId} = ${trainingSamples.id} AND id <= ${maxReviewId})`,
      ),
    )
    .where(and(gt(trainingSamples.id, after), lte(trainingSamples.id, maxId)))
    .orderBy(trainingSamples.id)
    .limit(Math.min(200, Math.max(1, limit)));
  const entries = rows.map(({ payload, tags, ...r }) => ({
    ...r,
    tags: tags ? JSON.parse(tags) : [],
    sample: JSON.parse(payload),
  }));
  return {
    schema_version: 1,
    until: maxId,
    review_until: maxReviewId,
    entries,
    next_cursor: entries.length ? entries.at(-1)!.id : null,
  };
}

export async function reviewTrainingSample(
  env: Cloudflare.Env,
  id: number,
  raw: unknown,
  actor: string,
) {
  const review = parseSampleReview(raw);
  if (!Number.isSafeInteger(id) || id <= 0 || !review) return false;
  const inserted = await getDb(env).execute(sql`
    INSERT INTO training_sample_reviews (sample_id, verdict, family, tags, note, reviewer, created_at)
    SELECT id, ${review.verdict}::text, ${review.family}::text, ${JSON.stringify(review.tags)}::text,
           ${stripNul(review.note)}::text, ${actor}::text, ${nowSeconds()}::bigint
    FROM ${trainingSamples} WHERE id = ${id}
    RETURNING id`);
  return inserted.length > 0;
}
