/**
 * 公示站数据服务函数（KOSX data.functions.ts 同款模式）：
 * SSR loader 在同一 Worker 内直接调现有取数函数（roster / R2 词库），
 * 不要走 HTTP 自调用；客户端 hydration 后再需要的数据走这些
 * server function 的 RPC 端点，口径与 /v1 同源。
 */
import { createServerFn } from '@tanstack/react-start';
import { env } from 'cloudflare:workers';
import { getPublicRoster, type RosterPayload } from '../roster';

export const getRosterData = createServerFn({ method: 'GET' }).handler(async (): Promise<RosterPayload | null> =>
  getPublicRoster(env),
);

/** 白名单/抢救公示面的瘦身 loader：这两个页面用不到 blacklist.entries（含全部
 *  证据字段），整份 RosterPayload 反序列化进 HTML 是公示站最重两页的传输放大。 */
export interface WhitelistRosterData {
  snapshot_version: string;
  whitelist: Pick<RosterPayload['whitelist'], 'maintained' | 'verified'>;
}

export const getWhitelistData = createServerFn({ method: 'GET' }).handler(
  async (): Promise<WhitelistRosterData | null> => {
    const roster = await getPublicRoster(env);
    if (!roster) return null;
    return {
      snapshot_version: roster.snapshot_version,
      whitelist: { maintained: roster.whitelist.maintained, verified: roster.whitelist.verified },
    };
  },
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

/** 福滤娃周刊热帖（首页「本周 X 精选」模块）。周刊是另一个 Worker（fsw-web），
 *  经 service binding WEEKLY 调它的公开订阅接口，不共享数据库；拿不到时返回 null，首页照常渲染。 */
export interface WeeklyPick {
  id: string;
  kind: 'curate' | 'self' | 'original';
  kindLabel: string;
  board: string | null;
  title: string;
  excerpt: string;
  voteCount: number;
  commentCount: number;
  issueNumber: number | null;
  createdAt: string;
  author: { handle: string | null; displayName: string } | null;
  source: { authorName: string | null; authorHandle: string | null; text: string | null; whitelisted: boolean } | null;
}

export const getWeeklyPicks = createServerFn({ method: 'GET' }).handler(async (): Promise<WeeklyPick[] | null> => {
  if (!env.WEEKLY) return null;
  try {
    const res = await env.WEEKLY.fetch('https://feedsieve.win/weekly/api/public/hot?limit=6', {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: WeeklyPick[] };
    return Array.isArray(data.items) ? data.items : null;
  } catch {
    return null;
  }
});

/** AI 味公开结果页（/ai/:handle）：只给可公开的结论，单人未确认的显示「待复核」（见 ai-accounts/public-page.ts） */
export const getAiPublicData = createServerFn({ method: 'GET' })
  .validator((data: { handle: string }) => ({ handle: String(data?.handle ?? '').slice(0, 32) }))
  .handler(async ({ data }) => {
    const { getAiPublic } = await import('../ai-accounts/public-page');
    return getAiPublic(env, data.handle);
  });
