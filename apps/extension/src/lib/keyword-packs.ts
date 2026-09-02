import bundledCatalogJson from '../../../../community/keyword-packs/official.json';

export interface KeywordPackRule {
  id: string;
  phrase: string;
  name: { zh: string; en: string };
  /** 有序分词组合：允许词之间插入少量字符，但不允许颠倒顺序。 */
  terms?: string[];
  max_gap?: number;
}
export interface KeywordPack {
  id: string;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  source_refs: string[];
  rules: KeywordPackRule[];
}
export interface KeywordPackCatalog {
  schema_version: 1;
  pack_version: string;
  generated_at: string | null;
  packs: KeywordPack[];
}
interface KeywordPackManifest {
  schema_version: 1;
  pack_version: string;
  files: Array<{ path: 'official.json'; sha256: string; packs: number; rules: number }>;
}
interface StoredKeywordPackCatalog {
  pack_version: string;
  body: string;
  synced_at: number;
}

export const KEYWORD_PACK_API_BASE = 'https://feedsieve-api.chendahuang.com';
const STORAGE_KEY = 'keywordPacksSnapshotV1';
/** X 页面活跃时每 15 分钟最多检查一次远程 manifest。 */
export const KEYWORD_PACK_SYNC_MAX_AGE_MS = 15 * 60 * 1000;
const VERSION_RE = /^\d{4}\.\d{2}\.\d{2}\.\d{1,4}$/;
const ID_RE = /^[a-z][a-z0-9_-]{1,95}$/;
function localized(value: unknown): value is { zh: string; en: string } {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { zh?: unknown }).zh === 'string' &&
    typeof (value as { en?: unknown }).en === 'string'
  );
}

export function parseKeywordPackCatalog(value: unknown): KeywordPackCatalog | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (
    raw.schema_version !== 1 ||
    typeof raw.pack_version !== 'string' ||
    !VERSION_RE.test(raw.pack_version) ||
    !Array.isArray(raw.packs)
  )
    return null;
  const packIds = new Set<string>();
  const ruleIds = new Set<string>();
  const packs: KeywordPack[] = [];
  for (const rawPack of raw.packs) {
    if (!rawPack || typeof rawPack !== 'object') return null;
    const pack = rawPack as Record<string, unknown>;
    if (
      typeof pack.id !== 'string' ||
      !ID_RE.test(pack.id) ||
      packIds.has(pack.id) ||
      !localized(pack.name) ||
      !localized(pack.description) ||
      !Array.isArray(pack.source_refs) ||
      !Array.isArray(pack.rules)
    )
      return null;
    const sourceRefs = pack.source_refs.filter(
      (ref): ref is string => typeof ref === 'string' && ref.length > 0,
    );
    if (sourceRefs.length !== pack.source_refs.length) return null;
    const rules: KeywordPackRule[] = [];
    for (const rawRule of pack.rules) {
      if (!rawRule || typeof rawRule !== 'object') return null;
      const rule = rawRule as Record<string, unknown>;
      if (
        typeof rule.id !== 'string' ||
        !ID_RE.test(rule.id) ||
        ruleIds.has(rule.id) ||
        typeof rule.phrase !== 'string' ||
        rule.phrase.trim() !== rule.phrase ||
        rule.phrase.length < 1 ||
        rule.phrase.length > 80 ||
        !localized(rule.name)
      )
        return null;
      const rawTerms = Array.isArray(rule.terms) ? rule.terms : undefined;
      const terms = rawTerms
        ? rawTerms.filter(
            (term): term is string =>
              typeof term === 'string' &&
              term.trim() === term &&
              term.length >= 1 &&
              term.length <= 24,
          )
        : undefined;
      if (terms && (terms.length !== rawTerms!.length || terms.length < 2 || terms.length > 5))
        return null;
      if (
        terms &&
        (typeof rule.max_gap !== 'number' ||
          !Number.isInteger(rule.max_gap) ||
          rule.max_gap < 0 ||
          rule.max_gap > 32)
      )
        return null;
      ruleIds.add(rule.id);
      rules.push({
        id: rule.id,
        phrase: rule.phrase,
        name: rule.name,
        ...(terms ? { terms, max_gap: rule.max_gap as number } : {}),
      });
    }
    if (rules.length === 0) return null;
    packIds.add(pack.id);
    packs.push({
      id: pack.id,
      name: pack.name,
      description: pack.description,
      source_refs: sourceRefs,
      rules,
    });
  }
  return packs.length > 0
    ? {
        schema_version: 1,
        pack_version: raw.pack_version,
        generated_at: typeof raw.generated_at === 'string' ? raw.generated_at : null,
        packs,
      }
    : null;
}

export const BUNDLED_KEYWORD_PACK_CATALOG = (() => {
  const parsed = parseKeywordPackCatalog(bundledCatalogJson);
  if (!parsed) throw new Error('invalid bundled keyword packs');
  return parsed;
})();
function parseManifest(value: unknown): KeywordPackManifest | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (
    raw.schema_version !== 1 ||
    typeof raw.pack_version !== 'string' ||
    !VERSION_RE.test(raw.pack_version) ||
    !Array.isArray(raw.files)
  )
    return null;
  const file = raw.files.find(
    (candidate) =>
      candidate &&
      typeof candidate === 'object' &&
      (candidate as Record<string, unknown>).path === 'official.json',
  ) as Record<string, unknown> | undefined;
  if (
    !file ||
    typeof file.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(file.sha256) ||
    typeof file.packs !== 'number' ||
    typeof file.rules !== 'number'
  )
    return null;
  return {
    schema_version: 1,
    pack_version: raw.pack_version,
    files: [
      {
        path: 'official.json',
        sha256: file.sha256.toLowerCase(),
        packs: file.packs,
        rules: file.rules,
      },
    ],
  };
}
function parseStored(value: unknown): StoredKeywordPackCatalog | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  return typeof raw.pack_version === 'string' &&
    typeof raw.body === 'string' &&
    typeof raw.synced_at === 'number'
    ? { pack_version: raw.pack_version, body: raw.body, synced_at: raw.synced_at }
    : null;
}
export async function getKeywordPackCatalog(): Promise<KeywordPackCatalog> {
  const stored = parseStored((await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY]);
  if (!stored) return BUNDLED_KEYWORD_PACK_CATALOG;
  try {
    const parsed = parseKeywordPackCatalog(JSON.parse(stored.body));
    return parsed?.pack_version === stored.pack_version ? parsed : BUNDLED_KEYWORD_PACK_CATALOG;
  } catch {
    return BUNDLED_KEYWORD_PACK_CATALOG;
  }
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export type KeywordPackSyncOutcome =
  | { status: 'updated'; version: string }
  | { status: 'up_to_date'; version: string }
  | { status: 'error'; error: string };

/** 从 Worker/R2 取得版本化词库；任何校验失败都保留 last-known-good 缓存。 */
export async function syncKeywordPackCatalog(
  options: { force?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<KeywordPackSyncOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const stored = parseStored((await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY]);
  if (!options.force && stored && Date.now() - stored.synced_at < KEYWORD_PACK_SYNC_MAX_AGE_MS)
    return { status: 'up_to_date', version: stored.pack_version };
  let manifestResponse: Response;
  try {
    manifestResponse = await fetchImpl(`${KEYWORD_PACK_API_BASE}/v1/keyword-packs/latest`);
  } catch {
    return { status: 'error', error: 'manifest_network_error' };
  }
  if (!manifestResponse.ok)
    return { status: 'error', error: `manifest_http_${manifestResponse.status}` };
  const manifest = parseManifest(await manifestResponse.json().catch(() => null));
  if (!manifest) return { status: 'error', error: 'invalid_manifest' };
  if (stored?.pack_version === manifest.pack_version)
    return { status: 'up_to_date', version: manifest.pack_version };
  let bodyResponse: Response;
  try {
    bodyResponse = await fetchImpl(
      `${KEYWORD_PACK_API_BASE}/v1/keyword-packs/${manifest.pack_version}/official.json`,
    );
  } catch {
    return { status: 'error', error: 'pack_network_error' };
  }
  if (!bodyResponse.ok) return { status: 'error', error: `pack_http_${bodyResponse.status}` };
  const body = await bodyResponse.text();
  if ((await sha256Hex(body)) !== manifest.files[0]!.sha256)
    return { status: 'error', error: 'checksum_mismatch' };
  let catalog: KeywordPackCatalog | null = null;
  try {
    catalog = parseKeywordPackCatalog(JSON.parse(body));
  } catch {
    /* invalid below */
  }
  if (!catalog || catalog.pack_version !== manifest.pack_version)
    return { status: 'error', error: 'invalid_pack_body' };
  await browser.storage.local.set({
    [STORAGE_KEY]: {
      pack_version: catalog.pack_version,
      body,
      synced_at: Date.now(),
    } satisfies StoredKeywordPackCatalog,
  });
  return { status: 'updated', version: catalog.pack_version };
}
export function subscribeKeywordPackCatalog(
  onChange: (catalog: KeywordPackCatalog) => void,
): () => void {
  const listener = (changes: Record<string, unknown>, areaName: string) => {
    if (areaName === 'local' && changes[STORAGE_KEY]) void getKeywordPackCatalog().then(onChange);
  };
  browser.storage.onChanged.addListener(
    listener as Parameters<typeof browser.storage.onChanged.addListener>[0],
  );
  return () =>
    browser.storage.onChanged.removeListener(
      listener as Parameters<typeof browser.storage.onChanged.removeListener>[0],
    );
}
