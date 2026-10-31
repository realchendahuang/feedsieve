/** User feedback is a claim, never ground truth. All fields are untrusted at ingestion. */
export const SAMPLE_ACTIONS = [
  'manual-spam',
  'accepted-detection',
  'batch-block',
  'false-positive',
] as const;
export type SampleAction = (typeof SAMPLE_ACTIONS)[number];
export interface TrainingSample {
  schemaVersion: 1;
  eventId: string;
  handle: string;
  xUserId?: string;
  action: SampleAction;
  observedAt: number;
  actedAt: number;
  clientVersion: string;
  catalogVersion?: string;
  postId?: string;
  text?: string;
  displayName?: string;
  bio?: string;
  truncated: string[];
  detection: { source?: string; ruleId?: string; signalIds: string[] };
}
export const SEMANTIC_TAGS = [
  'solicitation',
  'contact-routing',
  'quotation',
  'negation',
  'insufficient-context',
] as const;
export type SampleVerdict = 'spam' | 'normal' | 'uncertain';
export interface SampleReview {
  verdict: SampleVerdict;
  family: string;
  tags: string[];
  note: string;
}
export function parseTrainingSample(raw: unknown): TrainingSample | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (
    r.schemaVersion !== 1 ||
    typeof r.eventId !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(r.eventId) ||
    typeof r.handle !== 'string' ||
    !/^[a-z0-9_]{1,15}$/.test(r.handle) ||
    !SAMPLE_ACTIONS.includes(r.action as SampleAction) ||
    !Number.isSafeInteger(r.observedAt) ||
    !Number.isSafeInteger(r.actedAt) ||
    Number(r.observedAt) <= 0 ||
    Number(r.actedAt) < Number(r.observedAt) ||
    typeof r.clientVersion !== 'string' ||
    !/^\d+\.\d+\.\d+(?:[.-][a-z0-9.-]+)?$/i.test(r.clientVersion) ||
    r.clientVersion.length > 40
  )
    return null;
  const optional: Record<string, string> = {};
  for (const [key, max] of Object.entries({
    text: 4000,
    displayName: 160,
    bio: 1000,
    catalogVersion: 64,
    postId: 25,
    xUserId: 20,
  })) {
    if (r[key] === undefined) continue;
    if (typeof r[key] !== 'string' || r[key].length > max) return null;
    optional[key] = r[key];
  }
  if (optional.postId && !/^\d+$/.test(optional.postId)) return null;
  if (optional.xUserId && !/^\d+$/.test(optional.xUserId)) return null;
  if (
    !Array.isArray(r.truncated) ||
    r.truncated.length > 3 ||
    r.truncated.some((x) => !['text', 'displayName', 'bio'].includes(x))
  )
    return null;
  if (!r.detection || typeof r.detection !== 'object') return null;
  const d = r.detection as Record<string, unknown>;
  const id = (x: unknown) => typeof x === 'string' && /^[a-z0-9][a-z0-9:_-]{0,159}$/.test(x);
  if (
    (d.source !== undefined && !id(d.source)) ||
    (d.ruleId !== undefined && !id(d.ruleId)) ||
    !Array.isArray(d.signalIds) ||
    d.signalIds.length > 24 ||
    !d.signalIds.every(id)
  )
    return null;
  return {
    schemaVersion: 1,
    eventId: r.eventId,
    handle: r.handle,
    action: r.action as SampleAction,
    observedAt: Number(r.observedAt),
    actedAt: Number(r.actedAt),
    clientVersion: r.clientVersion,
    ...optional,
    truncated: [...r.truncated],
    detection: {
      ...(d.source ? { source: d.source as string } : {}),
      ...(d.ruleId ? { ruleId: d.ruleId as string } : {}),
      signalIds: [...d.signalIds] as string[],
    },
  };
}
export function parseSampleReview(raw: unknown): SampleReview | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (
    !['spam', 'normal', 'uncertain'].includes(String(r.verdict)) ||
    typeof r.family !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(r.family) ||
    typeof r.note !== 'string' ||
    !r.note.trim() ||
    r.note.length > 1000 ||
    !Array.isArray(r.tags) ||
    r.tags.length > SEMANTIC_TAGS.length ||
    !r.tags.every((t) => SEMANTIC_TAGS.includes(t))
  )
    return null;
  return {
    verdict: r.verdict as SampleVerdict,
    family: r.family,
    tags: [...new Set(r.tags)] as string[],
    note: r.note.trim(),
  };
}
