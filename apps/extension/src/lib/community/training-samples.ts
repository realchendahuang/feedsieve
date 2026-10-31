import { parseTrainingSample, type TrainingSample, type SampleAction } from '@feedsieve/shared';
import { COMMUNITY_API_BASE, getCommunitySettings } from './community-store';
import { getInstallationId } from './contribute';
import type { BlockEvidence } from '../detection/detection-evidence';

const PREFIX = 'trainingSamplePending:';
let running: Promise<void> | null = null;

/** Capture bounded public evidence, with explicit truncation and independent human action. */
export function createTrainingSample(
  handle: string,
  action: SampleAction,
  evidence: BlockEvidence,
  xUserId?: string,
): TrainingSample {
  const now = Date.now();
  const truncated: string[] = [];
  const facts: Record<string, string> = {};
  for (const [key, value, max] of [
    ['text', evidence.tweetText, 4000],
    ['displayName', evidence.displayName, 160],
    ['bio', evidence.bio, 1000],
  ] as const) {
    if (value === undefined) continue;
    facts[key] = value.slice(0, max);
    if (value.length > max) truncated.push(key);
  }
  const custom = evidence.ruleId?.startsWith('keyword:custom:');
  return {
    schemaVersion: 1,
    eventId: crypto.randomUUID(),
    handle: handle.replace(/^@+/, '').toLowerCase(),
    action,
    observedAt: evidence.observedAt ?? now,
    actedAt: now,
    clientVersion: browser.runtime.getManifest().version,
    ...(evidence.catalogVersion ? { catalogVersion: evidence.catalogVersion } : {}),
    ...(xUserId ? { xUserId } : {}),
    ...(evidence.evidencePostId ? { postId: evidence.evidencePostId } : {}),
    ...facts,
    truncated,
    detection: {
      ...(evidence.detectionSource ? { source: evidence.detectionSource } : {}),
      ...(evidence.ruleId ? { ruleId: custom ? 'keyword:custom' : evidence.ruleId } : {}),
      signalIds: custom ? [] : (evidence.signalIds ?? []).slice(0, 24),
    },
  };
}

/** One storage key per event: parallel tabs cannot overwrite an array outbox. */
export async function enqueueTrainingSample(
  sample: TrainingSample | undefined,
  patch: Record<string, unknown> = {},
): Promise<void> {
  const collect = sample && (await getCommunitySettings()).autoContribute;
  if (collect && !parseTrainingSample(sample)) throw new Error('invalid_training_sample');
  // Action record and its evidence share one storage transaction.
  await browser.storage.local.set({
    ...patch,
    ...(collect ? { [`${PREFIX}${sample.eventId}`]: sample } : {}),
  });
  if (collect)
    void browser.runtime.sendMessage({ type: 'feedsieve:samples-flush' }).catch(() => {});
}

export function flushTrainingSamples(): Promise<void> {
  if (!running)
    running = flush().finally(() => {
      running = null;
    });
  return running;
}
async function flush(): Promise<void> {
  if (!(await getCommunitySettings()).autoContribute) return;
  const stored = await browser.storage.local.get(null);
  const entries = Object.entries(stored).filter(([key]) => key.startsWith(PREFIX));
  if (!entries.length) return;
  const installationId = await getInstallationId();
  for (let offset = 0; offset < entries.length; offset += 20) {
    if (!(await getCommunitySettings()).autoContribute) return;
    const batch = entries.slice(offset, offset + 20);
    try {
      const response = await fetch(`${COMMUNITY_API_BASE}/v1/training-samples`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ installation_id: installationId, samples: batch.map(([, s]) => s) }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`samples_http_${response.status}`);
      const body = (await response.json()) as {
        accepted?: string[];
        rejected?: Array<{ eventId: string | null; error: string }>;
      };
      const accepted = new Set(body.accepted ?? []);
      const rejected = new Map((body.rejected ?? []).map((r) => [r.eventId, r.error]));
      const quarantine = Object.fromEntries(
        batch
          .filter(([, raw]) => rejected.has((raw as TrainingSample).eventId))
          .map(([, raw]) => {
            const sample = raw as TrainingSample;
            return [
              `trainingSampleRejected:${sample.eventId}`,
              { sample, error: rejected.get(sample.eventId) },
            ];
          }),
      );
      if (Object.keys(quarantine).length) {
        await browser.storage.local.set(quarantine);
        console.error(
          '[FeedSieve] invalid feedback preserved locally for inspection',
          Object.keys(quarantine).length,
        );
      }
      const keys = batch
        .filter(
          ([, raw]) =>
            accepted.has((raw as TrainingSample).eventId) ||
            rejected.has((raw as TrainingSample).eventId),
        )
        .map(([key]) => key);
      if (keys.length) await browser.storage.local.remove(keys);
      if (keys.length !== batch.length) return;
    } catch (error) {
      console.warn('[FeedSieve] sample upload pending; retry on next sync', error);
      return;
    }
  }
}
