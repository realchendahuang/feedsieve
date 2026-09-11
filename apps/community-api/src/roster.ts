/**
 * 公示数据端（/v1/roster/latest）：官网名单公示页的唯一数据源。
 *
 * 内容 = 最新已发布快照的公示面：黑名单条目（含证据明细）、维护者白名单
 * （博主宣言）、社区抢救名单（verified）。语义与扩展实际执行的名单严格同源
 * （同一份签名快照），公示页不读快照以外的表、不二次加工。
 * 字段口径与既有的可读公开名单 /v1/blocklist/latest.yaml 一致：证据帖 ID、
 * 外链域名、换号别名公开，第三方可独立核验；指纹是 64bit SimHash 单向哈希，
 * 在任何公开面都不承载可读内容，不进公示响应。
 */
import { getLatestSnapshot, getLatestSnapshotFile, SNAPSHOT_PACK } from './snapshot';
import { publicPolicy } from './reports';

export interface RosterBlacklistEntry {
  handle: string;
  category: string;
  sources: string[];
  net_votes: number;
  report_count: number;
  rescue_count: number;
  maintainer_note?: string;
  first_seen_at: string;
  updated_at: string;
  aliases?: string[];
  evidence_post_ids?: string[];
  domains?: string[];
}

export interface RosterWhitelistEntry {
  handle: string;
  note: string;
  added_at: string;
}

export interface RosterVerifiedEntry {
  handle: string;
  net_votes: number;
  rescue_count: number;
  report_count: number;
  updated_at: string;
}

export interface RosterPayload {
  snapshot_version: string;
  generated_at: string;
  /** 快照是否带发布者签名（公示页展示校验徽章用） */
  signed: boolean;
  policy: ReturnType<typeof publicPolicy>;
  blacklist: { count: number; entries: RosterBlacklistEntry[] };
  whitelist: { maintained: RosterWhitelistEntry[]; verified: RosterVerifiedEntry[] };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export async function getPublicRoster(env: Cloudflare.Env): Promise<RosterPayload | null> {
  const latest = await getLatestSnapshot(env);
  const bodyRaw = await getLatestSnapshotFile(env, SNAPSHOT_PACK);
  if (!latest || !bodyRaw) return null;

  let manifest: { snapshot_version?: unknown; generated_at?: unknown; signature?: unknown };
  let body: { entries?: unknown; whitelist?: unknown; verified?: unknown };
  try {
    manifest = JSON.parse(latest.manifest) as typeof manifest;
    body = JSON.parse(bodyRaw) as typeof body;
  } catch {
    return null;
  }
  if (typeof manifest.snapshot_version !== 'string' || typeof manifest.generated_at !== 'string') {
    return null;
  }

  const blacklist: RosterBlacklistEntry[] = [];
  if (Array.isArray(body.entries)) {
    for (const raw of body.entries) {
      if (typeof raw !== 'object' || raw === null) continue;
      const entry = raw as Record<string, unknown>;
      if (typeof entry.handle !== 'string' || typeof entry.category !== 'string') continue;
      blacklist.push({
        handle: entry.handle,
        category: entry.category,
        sources: asStringArray(entry.sources),
        net_votes: typeof entry.net_votes === 'number' ? entry.net_votes : 0,
        report_count: typeof entry.report_count === 'number' ? entry.report_count : 0,
        rescue_count: typeof entry.rescue_count === 'number' ? entry.rescue_count : 0,
        ...(typeof entry.maintainer_note === 'string' && entry.maintainer_note.length > 0
          ? { maintainer_note: entry.maintainer_note }
          : {}),
        first_seen_at: typeof entry.first_seen_at === 'string' ? entry.first_seen_at : '',
        updated_at: typeof entry.updated_at === 'string' ? entry.updated_at : '',
        ...(asStringArray(entry.aliases).length > 0 ? { aliases: asStringArray(entry.aliases) } : {}),
        ...(asStringArray(entry.evidence_post_ids).length > 0
          ? { evidence_post_ids: asStringArray(entry.evidence_post_ids) }
          : {}),
        ...(asStringArray(entry.domains).length > 0 ? { domains: asStringArray(entry.domains) } : {}),
      });
    }
  }

  const maintained: RosterWhitelistEntry[] = [];
  if (Array.isArray(body.whitelist)) {
    for (const raw of body.whitelist) {
      if (typeof raw !== 'object' || raw === null) continue;
      const entry = raw as Record<string, unknown>;
      if (typeof entry.handle !== 'string') continue;
      maintained.push({
        handle: entry.handle,
        note: typeof entry.note === 'string' ? entry.note : '',
        added_at: typeof entry.added_at === 'string' ? entry.added_at : '',
      });
    }
  }

  const verified: RosterVerifiedEntry[] = [];
  if (Array.isArray(body.verified)) {
    for (const raw of body.verified) {
      if (typeof raw !== 'object' || raw === null) continue;
      const entry = raw as Record<string, unknown>;
      if (typeof entry.handle !== 'string') continue;
      verified.push({
        handle: entry.handle,
        net_votes: typeof entry.net_votes === 'number' ? entry.net_votes : 0,
        rescue_count: typeof entry.rescue_count === 'number' ? entry.rescue_count : 0,
        report_count: typeof entry.report_count === 'number' ? entry.report_count : 0,
        updated_at: typeof entry.updated_at === 'string' ? entry.updated_at : '',
      });
    }
  }

  return {
    snapshot_version: manifest.snapshot_version,
    generated_at: manifest.generated_at,
    signed: manifest.signature != null,
    policy: publicPolicy(),
    blacklist: { count: blacklist.length, entries: blacklist },
    whitelist: { maintained, verified },
  };
}
