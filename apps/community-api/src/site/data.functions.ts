/**
 * 公示站数据服务函数（KOSX data.functions.ts 同款模式）：
 * SSR loader 在同一 Worker 内直接调现有取数函数（roster / leaderboard / R2 词库），
 * 不要走 HTTP 自调用；客户端 hydration 后再需要的数据（榜单轮询）走这些
 * server function 的 RPC 端点，口径与 /v1 同源。
 */
import { createServerFn } from '@tanstack/react-start';
import { env } from 'cloudflare:workers';
import { getPublicRoster, type RosterPayload } from '../roster';
import { getLeaderboard, LEADERBOARD, type HunterRow, type SeasonChampion, type SeasonWindow } from '../leaderboard';

export const getRosterData = createServerFn({ method: 'GET' }).handler(async (): Promise<RosterPayload | null> =>
  getPublicRoster(env),
);

/** 词库公示面：latest manifest + 版本化 official.json（R2 内部直读，与 /v1 同源） */
export interface KeywordPackView {
  id: string;
  name: { zh: string } | null;
  rules: Array<{ phrase: string }>;
}export interface KeywordPublicData {
  pack_version: string;
  signed: boolean;
  total_rules: number;
  packs: KeywordPackView[];
}

export const getKeywordData = createServerFn({
  method: 'GET',
}).handler(async (): Promise<KeywordPublicData | null> => {
  const manifestObject = await env.KEYWORD_PACKS?.get('keyword-packs/latest.json');
  const manifestRaw = manifestObject ? await manifestObject.text() : null;
  if (!manifestRaw) return null;
  let manifestVersion: string;
  let signed: boolean;
  try {
    const manifest = JSON.parse(manifestRaw) as { pack_version?: unknown; signature?: unknown };
    if (typeof manifest.pack_version !== 'string') return null;
    manifestVersion = manifest.pack_version;
    signed = manifest.signature != null;
  } catch {
    return null;
  }
  // 词库包发布后不可变：解析结果按 pack_version 模块级 memo，
  // 词库 Tab 的每次 SSR 请求只读一个小 manifest
  if (keywordMemo && keywordMemo.version === manifestVersion) return keywordMemo.value;

  const bodyObject = await env.KEYWORD_PACKS?.get(
    `keyword-packs/${encodeURIComponent(manifestVersion)}/official.json`,
  );
  const bodyRaw = bodyObject ? await bodyObject.text() : null;
  if (!bodyRaw) return null;
  let body: { packs?: Array<{ id?: unknown; name?: unknown; rules?: Array<Record<string, unknown>> }> };
  try {
    body = JSON.parse(bodyRaw) as typeof body;
  } catch {
    return null;
  }
  const packs: KeywordPackView[] = (body.packs ?? [])
    .filter((p): p is object => typeof p === 'object' && p !== null && typeof (p as { id?: unknown }).id === 'string')
    .map((p) => {
      const raw = p as { id: string; name?: { zh?: unknown }; rules?: unknown };
      const list = Array.isArray(raw.rules) ? (raw.rules as Array<Record<string, unknown>>) : [];
      return {
        id: raw.id,
        name: typeof raw.name?.zh === 'string' ? { zh: raw.name.zh } : null,
        rules: rawRulesToPhrases(list),
      };
    });
  const total = packs.reduce((n, p) => n + p.rules.length, 0);
  const value: KeywordPublicData = {
    pack_version: manifestVersion,
    signed,
    total_rules: total,
    packs,
  };
  keywordMemo = { version: manifestVersion, value };
  return value;
});

let keywordMemo: { version: string; value: KeywordPublicData } | null = null;

function rawRulesToPhrases(raw: Array<Record<string, unknown>>): Array<{ phrase: string }> {
  return raw
    .map((rule) => (typeof rule.phrase === 'string' ? rule.phrase : (typeof rule.id === 'string' ? rule.id : '')))
    .filter((phrase) => phrase.length > 0)
    .map((phrase) => ({ phrase }));
}

/** 榜单公示数据：与 GET /v1/leaderboard 完全同口径（行截断 / id 裁剪）。 */
export const getRankedData = createServerFn({ method: 'GET' })
  .validator((scope?: 'week' | 'all') => scope ?? 'week')
  .handler(async ({ data: scope }): Promise<Omit<PublicBoard, 'me'>> => {
    const data = await getLeaderboard(env, scope === 'all' ? 'all' : 'week');
    const rows = data.rows
      .slice(0, LEADERBOARD.topSize)
      .map((row, index) => trimRow({ ...row, rank: index + 1 }));
    return {
      season: data.season,
      updated_at: data.computed_at,
      total: data.rows.length,
      rows,
      last_season: data.last_season ?? null,
    };
  });

export interface PublicBoardRow extends HunterRow {
  rank: number;
  /** 服务端裁剪到 12 位（匿名哈希前缀，与 /v1/leaderboard 同口径） */
  id: string;
}

export interface PublicBoard {
  season: SeasonWindow | null;
  updated_at: number;
  total: number;
  rows: PublicBoardRow[];
  last_season: { id: number; champions: SeasonChampion[] } | null;
}

function trimRow(row: HunterRow & { rank: number }): PublicBoardRow {
  return { ...row, id: String(row.id).slice(0, 12) } as PublicBoardRow;
}
