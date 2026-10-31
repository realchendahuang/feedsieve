import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { count, eq, inArray } from 'drizzle-orm';
import { hashInstallationId, hashIp } from '../src/lib/hash';
import worker from '../src/index';
import { getDb } from '../src/db/client';
import {
  activeLabels,
  trainingSampleReviews,
  trainingSamples,
  trainingSampleUsage,
} from '../src/db/schema';
import { max } from 'drizzle-orm';
import {
  ingestTrainingSamples,
  listTrainingSamples,
  reviewTrainingSample,
} from '../src/training-samples';
import { validateRescue } from '../src/lib/validate';
const sample = () => ({
  schemaVersion: 1,
  eventId: crypto.randomUUID(),
  handle: 'sample_user',
  action: 'false-positive',
  observedAt: Date.now() - 1000,
  actedAt: Date.now(),
  clientVersion: '0.9.4',
  text: '不是广告：请不要找这种账号',
  truncated: [],
  detection: { source: 'heuristic', ruleId: 'keyword:profile:adult-invitation', signalIds: [] },
});
describe('immutable samples independent of votes', () => {
  it('keeps evidence on retry and records separate later human judgments without changing community votes', async () => {
    const s = sample();
    const body = { installation_id: 'sample-install-0001', samples: [s] };
    expect((await ingestTrainingSamples(env, body)).status).toBe(200);
    await ingestTrainingSamples(env, { ...body, samples: [{ ...s, text: 'mutated evidence' }] });
    const result = await listTrainingSamples(env);
    const original = result.entries.find((r) => r.sample.eventId === s.eventId)!;
    expect(original.sample.text).toBe(s.text);
    expect(original.verdict).toBeNull();
    expect(
      await getDb(env).select().from(activeLabels).where(eq(activeLabels.handle, s.handle)),
    ).toEqual([]);
    const next = { ...s, eventId: crypto.randomUUID(), action: 'manual-spam' };
    await ingestTrainingSamples(env, { ...body, samples: [next] });
    const all = await listTrainingSamples(env);
    expect(
      all.entries.filter((r) => [s.eventId, next.eventId].includes(r.sample.eventId)),
    ).toHaveLength(2);
    expect(JSON.stringify(all)).not.toContain('sample-install-0001');
    expect(JSON.stringify(all)).not.toContain('installation_id');
    expect(
      await reviewTrainingSample(
        env,
        original.id,
        { verdict: 'normal', family: 'negation-001', tags: ['negation'], note: '否定广告招揽' },
        'reviewer@example.com',
      ),
    ).toBe(true);
    await reviewTrainingSample(
      env,
      original.id,
      {
        verdict: 'uncertain',
        family: 'negation-001',
        tags: ['insufficient-context'],
        note: '撤销旧结论，需更多上下文',
      },
      'reviewer@example.com',
    );
    expect(
      (
        await getDb(env)
          .select({ n: count() })
          .from(trainingSampleReviews)
          .where(eq(trainingSampleReviews.sampleId, original.id))
      )[0]?.n,
    ).toBe(2);
    expect(
      (await listTrainingSamples(env)).entries.find((r) => r.id === original.id)?.verdict,
    ).toBe('uncertain');
  });
  it('rejects engine-only claims, overlong payloads, future clocks, invalid labels', async () => {
    for (const patch of [
      { action: 'engine' },
      { text: 'a'.repeat(4001) },
      { actedAt: Date.now() + 900_000 },
      { detection: { signalIds: ['bad phrase'] } },
    ]) {
      const result = await ingestTrainingSamples(env, {
        installation_id: 'samples-invalid',
        samples: [{ ...sample(), ...patch }],
      });
      expect(result.body).toMatchObject({ accepted: [], rejected: [{ error: 'invalid_sample' }] });
    }
    expect(
      await reviewTrainingSample(
        env,
        1,
        { verdict: 'spam', family: 'f', note: '', tags: [] },
        'reviewer',
      ),
    ).toBe(false);
  });
  it('quarantines an invalid item without rejecting good evidence in the same batch', async () => {
    const good = sample();
    const bad = { ...sample(), action: 'engine' };
    const result = await ingestTrainingSamples(env, {
      installation_id: 'mixed-samples-install',
      samples: [bad, good],
    });
    expect(result.body).toMatchObject({
      accepted: [good.eventId],
      rejected: [{ eventId: bad.eventId, error: 'invalid_sample' }],
    });
  });

  it('enforces daily request quota including new events from an already-seen account', async () => {
    for (let i = 0; i < 15; i++)
      expect(
        (
          await ingestTrainingSamples(env, {
            installation_id: 'samples-quota-0001',
            samples: Array.from({ length: 20 }, sample),
          })
        ).status,
      ).toBe(200);
    expect(
      (
        await ingestTrainingSamples(env, {
          installation_id: 'samples-quota-0001',
          samples: [sample()],
        })
      ).status,
    ).toBe(429);
  });
  it('does not charge the installation when the IP limit is exceeded', async () => {
    const installationId = 'samples-ip-order-0001';
    const ip = '203.0.113.88';
    const ipKey = `ip:${await hashIp(env.INSTALLATION_SALT, ip)}`;
    const installKey = `install:${await hashInstallationId(env.INSTALLATION_SALT, installationId)}`;
    const db = getDb(env);
    const counts = async () => {
      const rows = await db
        .select({ identity: trainingSampleUsage.identity, count: trainingSampleUsage.count })
        .from(trainingSampleUsage)
        .where(inArray(trainingSampleUsage.identity, [ipKey, installKey]));
      return Object.fromEntries(rows.map((row) => [row.identity, row.count]));
    };
    const send = () =>
      ingestTrainingSamples(env, { installation_id: installationId, samples: [sample()] }, ip);

    expect((await send()).status).toBe(200);
    expect(await counts()).toEqual({ [ipKey]: 1, [installKey]: 1 });

    await db
      .update(trainingSampleUsage)
      .set({ count: 1000 })
      .where(eq(trainingSampleUsage.identity, ipKey));
    expect((await send()).status).toBe(429);
    expect(await counts()).toEqual({ [ipKey]: 1000, [installKey]: 1 });

    // IP 通过而安装超限：与逐项依次执行一致，IP 用量已扣
    await db
      .update(trainingSampleUsage)
      .set({ count: 5 })
      .where(eq(trainingSampleUsage.identity, ipKey));
    await db
      .update(trainingSampleUsage)
      .set({ count: 300 })
      .where(eq(trainingSampleUsage.identity, installKey));
    expect((await send()).status).toBe(429);
    expect(await counts()).toEqual({ [ipKey]: 6, [installKey]: 300 });
  });
  it('protects admin evidence and bounds public request size', async () => {
    const get = await worker.fetch(new Request('https://api.example.com/api/admin/samples'), env);
    expect(get.status).toBe(404);
    const privateGet = await worker.fetch(
      new Request('https://admin.feedsieve-api.chendahuang.com/api/admin/samples'),
      env,
    );
    expect(privateGet.status).toBe(401);
    const large = await worker.fetch(
      new Request('https://api.example.com/v1/training-samples', {
        method: 'POST',
        body: 'x'.repeat(450001),
      }),
      env,
    );
    expect(large.status).toBe(413);
  });
  it('exports a stable sample/review watermark while ingestion and reviews continue', async () => {
    const [maxRow] = await getDb(env)
      .select({ id: max(trainingSamples.id) })
      .from(trainingSamples);
    const before = { id: maxRow?.id ?? 0 };
    const s = sample();
    await ingestTrainingSamples(env, { installation_id: 'watermark-install', samples: [s] });
    const first = await listTrainingSamples(env, before!.id);
    const item = first.entries.find((e) => e.sample.eventId === s.eventId)!;
    await reviewTrainingSample(
      env,
      item.id,
      { verdict: 'spam', family: 'f', tags: [], note: 'new review' },
      'reviewer',
    );
    await ingestTrainingSamples(env, { installation_id: 'watermark-install', samples: [sample()] });
    const frozen = await listTrainingSamples(env, before!.id, 200, first.until, first.review_until);
    expect(frozen.entries.find((e) => e.id === item.id)?.verdict).toBeNull();
    expect(frozen.entries.every((e) => e.id <= first.until)).toBe(true);
  });

  it('accepts real keyword IDs on legacy false positive feedback', () => {
    expect(
      validateRescue({
        handle: 'sample_user',
        rule_id: 'keyword:profile:adult-invitation',
        detection_source: 'heuristic',
      }).ok,
    ).toBe(true);
  });
});
