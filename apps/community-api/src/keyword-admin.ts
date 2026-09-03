import { recordAdminAudit, recordRelease } from './admin-accounts';
import { sha256Hex } from './lib/hash';

const PACK_ID = /^[a-z][a-z0-9_]{1,63}$/;
const RULE_ID = /^[a-z][a-z0-9-]{2,95}$/;
const VERSION = /^\d{4}\.\d{2}\.\d{2}\.\d{1,4}$/;
const now = () => Math.floor(Date.now() / 1000);

type Row = Record<string, unknown>;

interface KeywordRuleDocument {
  id: string;
  phrase: string;
  terms?: string[];
  max_gap?: number;
}

interface KeywordPackDocument {
  id: string;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  source_refs: string[];
  rules: KeywordRuleDocument[];
}

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
}

function randomId(prefix: 'pack' | 'rule'): string {
  return `${prefix}${prefix === 'pack' ? '_' : '-'}${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
}

function parseMaxGap(value: unknown): number | null {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : null;
  if (number === null || !Number.isInteger(number) || number < 0 || number > 32) return null;
  return number;
}

/**
 * 将当前公开词库导入第一次 Access 工作区。导入只发生在空表上：
 * 维护者之后做过的草稿永远优先于旧版 R2 产物。
 */
export async function ensureKeywordCatalog(env: Cloudflare.Env): Promise<void> {
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM admin_keyword_packs').first<{ n: number }>();
  if ((count?.n ?? 0) > 0 || !env.KEYWORD_PACKS) return;

  const latest = await env.KEYWORD_PACKS.get('keyword-packs/latest.json');
  if (!latest) return;
  let manifest: { pack_version?: unknown };
  try {
    manifest = JSON.parse(await latest.text()) as { pack_version?: unknown };
  } catch {
    return;
  }
  const version = typeof manifest.pack_version === 'string' ? manifest.pack_version : '';
  if (!VERSION.test(version)) return;
  const source = await env.KEYWORD_PACKS.get(`keyword-packs/${version}/official.json`);
  if (!source) return;

  let catalog: { packs?: unknown };
  try {
    catalog = JSON.parse(await source.text()) as { packs?: unknown };
  } catch {
    return;
  }
  const rawPacks = catalog.packs;
  if (!Array.isArray(rawPacks)) return;
  const packs = rawPacks.flatMap((raw): KeywordPackDocument[] => {
      if (!isRecord(raw) || !PACK_ID.test(String(raw.id))) return [];
      const name = isRecord(raw.name) ? raw.name : {};
      const description = isRecord(raw.description) ? raw.description : {};
      const zh = typeof name.zh === 'string' ? name.zh.trim() : '';
      const en = typeof name.en === 'string' ? name.en.trim() : '';
      const descriptionZh = typeof description.zh === 'string' ? description.zh.trim() : '';
      const descriptionEn = typeof description.en === 'string' ? description.en.trim() : '';
      if (!zh || !en || !descriptionZh || !descriptionEn) return [];
      const rules = Array.isArray(raw.rules)
        ? raw.rules.flatMap((candidate): KeywordRuleDocument[] => {
            if (!isRecord(candidate)) return [];
            const id = typeof candidate.id === 'string' ? candidate.id : '';
            const phrase = typeof candidate.phrase === 'string' ? candidate.phrase.trim() : '';
            const terms = stringArray(candidate.terms);
            const maxGap = parseMaxGap(candidate.max_gap);
            if (!RULE_ID.test(id) || !phrase || phrase.length > 80) return [];
            if (terms.length > 0 && (terms.length < 2 || terms.length > 5 || maxGap === null)) return [];
            return [{ id, phrase, ...(terms.length ? { terms, max_gap: maxGap! } : {}) }];
          })
        : [];
      return [{
        id: String(raw.id),
        name: { zh, en },
        description: { zh: descriptionZh, en: descriptionEn },
        source_refs: stringArray(raw.source_refs),
        rules,
      }];
  });
  if (!packs.length) return;

  const time = now();
  const statements: D1PreparedStatement[] = [];
  for (const pack of packs) {
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO admin_keyword_packs
           (id, name_zh, name_en, description_zh, description_en, source_refs, active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)`,
      ).bind(
        pack.id,
        pack.name.zh,
        pack.name.en,
        pack.description.zh,
        pack.description.en,
        JSON.stringify(pack.source_refs),
        time,
      ),
    );
    for (const rule of pack.rules) {
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO admin_keyword_rules
             (id, pack_id, phrase, terms, max_gap, active, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)`,
        ).bind(
          rule.id,
          pack.id,
          rule.phrase,
          rule.terms?.length ? JSON.stringify(rule.terms) : null,
          rule.terms?.length ? rule.max_gap ?? null : null,
          time,
        ),
      );
    }
  }
  for (let index = 0; index < statements.length; index += 100) {
    await env.DB.batch(statements.slice(index, index + 100));
  }
}

export async function listAdminKeywords(env: Cloudflare.Env) {
  await ensureKeywordCatalog(env);
  const [packs, rules] = await Promise.all([
    env.DB.prepare('SELECT * FROM admin_keyword_packs ORDER BY active DESC, id').all(),
    env.DB.prepare('SELECT * FROM admin_keyword_rules ORDER BY pack_id, active DESC, phrase').all(),
  ]);
  return { packs: packs.results, rules: rules.results };
}

export async function saveAdminKeywordPack(
  env: Cloudflare.Env,
  raw: unknown,
  actorEmail = 'system',
) {
  await ensureKeywordCatalog(env);
  const input = isRecord(raw) ? raw : {};
  const rawId = typeof input.id === 'string' ? input.id.trim() : '';
  const id = rawId || randomId('pack');
  const nameZh = typeof input.name_zh === 'string' ? input.name_zh.trim() : '';
  const nameEn = typeof input.name_en === 'string' && input.name_en.trim() ? input.name_en.trim() : nameZh;
  const descriptionZh = typeof input.description_zh === 'string' ? input.description_zh.trim() : '';
  const descriptionEn =
    typeof input.description_en === 'string' && input.description_en.trim()
      ? input.description_en.trim()
      : descriptionZh;
  if (!PACK_ID.test(id) || !nameZh || !nameEn || !descriptionZh || !descriptionEn) return null;
  const refs = stringArray(input.source_refs);
  const time = now();
  await env.DB.prepare(
    `INSERT INTO admin_keyword_packs
       (id,name_zh,name_en,description_zh,description_en,source_refs,active,created_at,updated_at)
     VALUES (?1,?2,?3,?4,?5,?6,1,?7,?7)
     ON CONFLICT(id) DO UPDATE SET
       name_zh=?2,name_en=?3,description_zh=?4,description_en=?5,
       source_refs=?6,active=1,updated_at=?7`,
  )
    .bind(id, nameZh, nameEn, descriptionZh, descriptionEn, JSON.stringify(refs), time)
    .run();
  await recordAdminAudit(env, actorEmail, rawId ? 'update_draft' : 'add_draft', 'keyword_pack', id);
  return { id };
}

export async function saveAdminKeywordRule(
  env: Cloudflare.Env,
  raw: unknown,
  actorEmail = 'system',
) {
  await ensureKeywordCatalog(env);
  const input = isRecord(raw) ? raw : {};
  const rawId = typeof input.id === 'string' ? input.id.trim() : '';
  const id = rawId || randomId('rule');
  const packId = typeof input.pack_id === 'string' ? input.pack_id.trim() : '';
  const phrase = typeof input.phrase === 'string' ? input.phrase.trim() : '';
  const terms = stringArray(input.terms);
  const maxGap = parseMaxGap(input.max_gap);
  if (
    !RULE_ID.test(id) ||
    !PACK_ID.test(packId) ||
    !phrase ||
    phrase.length > 80 ||
    (terms.length > 0 && (terms.length < 2 || terms.length > 5 || maxGap === null))
  ) {
    return null;
  }
  const exists = await env.DB.prepare('SELECT id FROM admin_keyword_packs WHERE id=?1 AND active=1')
    .bind(packId)
    .first();
  if (!exists) return null;
  const time = now();
  await env.DB.prepare(
    `INSERT INTO admin_keyword_rules
       (id,pack_id,phrase,terms,max_gap,active,created_at,updated_at)
     VALUES (?1,?2,?3,?4,?5,1,?6,?6)
     ON CONFLICT(id) DO UPDATE SET
       pack_id=?2,phrase=?3,terms=?4,max_gap=?5,active=1,updated_at=?6`,
  )
    .bind(id, packId, phrase, terms.length ? JSON.stringify(terms) : null, terms.length ? maxGap : null, time)
    .run();
  await recordAdminAudit(env, actorEmail, rawId ? 'update_draft' : 'add_draft', 'keyword_rule', id);
  return { id };
}

export async function disableAdminKeyword(
  env: Cloudflare.Env,
  table: 'admin_keyword_packs' | 'admin_keyword_rules',
  id: string,
  actorEmail = 'system',
) {
  if (!(table === 'admin_keyword_packs' ? PACK_ID : RULE_ID).test(id)) return false;
  const result = await env.DB.prepare(
    `UPDATE ${table} SET active=0, updated_at=?2 WHERE id=?1 AND active=1`,
  )
    .bind(id, now())
    .run();
  if (result.meta.changes > 0) {
    await recordAdminAudit(
      env,
      actorEmail,
      'remove_draft',
      table === 'admin_keyword_packs' ? 'keyword_pack' : 'keyword_rule',
      id,
    );
  }
  return result.meta.changes > 0;
}

function nextVersion(current: string | undefined, stamp: string): string {
  const prior = current?.startsWith(`${stamp}.`) ? Number(current.split('.')[3]) : 0;
  return `${stamp}.${Number.isInteger(prior) && prior >= 0 ? prior + 1 : 1}`;
}

export async function publishAdminKeywords(env: Cloudflare.Env, actorEmail = 'system') {
  if (!env.KEYWORD_PACKS) throw new Error('keyword_packs_unavailable');
  const { packs, rules } = (await listAdminKeywords(env)) as { packs: Row[]; rules: Row[] };
  const activePacks = packs.filter((pack) => Number(pack.active) === 1);
  if (!activePacks.length) throw new Error('no_active_packs');
  const latest = await env.KEYWORD_PACKS.get('keyword-packs/latest.json');
  let latestManifest: { pack_version?: string } = {};
  try {
    latestManifest = latest ? (JSON.parse(await latest.text()) as { pack_version?: string }) : {};
  } catch {
    // Invalid legacy manifest should not prevent a maintainer from producing a new valid one.
  }
  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.slice(0, 10).replaceAll('-', '.');
  const version = nextVersion(latestManifest.pack_version, stamp);
  if (!VERSION.test(version)) throw new Error('invalid_version');
  const activeRules = rules.filter((rule) => Number(rule.active) === 1);
  const document = {
    schema_version: 1,
    pack_version: version,
    generated_at: generatedAt,
    packs: activePacks.map((pack) => ({
      id: pack.id,
      name: { zh: pack.name_zh, en: pack.name_en },
      description: { zh: pack.description_zh, en: pack.description_en },
      source_refs: JSON.parse(String(pack.source_refs)),
      rules: activeRules
        .filter((rule) => rule.pack_id === pack.id)
        .map((rule) => ({
          id: rule.id,
          phrase: rule.phrase,
          name: { zh: rule.phrase, en: rule.phrase },
          ...(rule.terms ? { terms: JSON.parse(String(rule.terms)), max_gap: rule.max_gap } : {}),
        })),
    })),
  };
  const body = `${JSON.stringify(document)}\n`;
  const sha256 = await sha256Hex(body);
  const manifest = `${JSON.stringify({
    schema_version: 1,
    pack_version: version,
    generated_at: generatedAt,
    files: [{ path: 'official.json', sha256, packs: activePacks.length, rules: activeRules.length }],
  })}\n`;
  await env.KEYWORD_PACKS.put(`keyword-packs/${version}/official.json`, body);
  await env.KEYWORD_PACKS.put('keyword-packs/latest.json', manifest);
  const releaseId = await recordRelease(env, 'keywords', version, actorEmail, {
    sha256,
    packs: activePacks.length,
    rules: activeRules.length,
  });
  await recordAdminAudit(env, actorEmail, 'publish', 'keywords', version, { release_id: releaseId });
  return { release_id: releaseId, version, sha256, packs: activePacks.length, rules: activeRules.length };
}

export async function rollbackAdminKeywordRelease(
  env: Cloudflare.Env,
  version: string,
  actorEmail: string,
) {
  if (!VERSION.test(version) || !env.KEYWORD_PACKS) throw new Error('invalid_release');
  const object = await env.KEYWORD_PACKS.get(`keyword-packs/${version}/official.json`);
  if (!object) throw new Error('release_not_found');
  const body = await object.text();
  let document: { packs?: unknown };
  try {
    document = JSON.parse(body) as { packs?: unknown };
  } catch {
    throw new Error('release_invalid');
  }
  const packs = Array.isArray(document.packs) ? document.packs.length : 0;
  const rules = Array.isArray(document.packs)
    ? document.packs.reduce(
        (total, pack) => total + (isRecord(pack) && Array.isArray(pack.rules) ? pack.rules.length : 0),
        0,
      )
    : 0;
  const sha256 = await sha256Hex(body);
  const generatedAt = new Date().toISOString();
  await env.KEYWORD_PACKS.put(
    'keyword-packs/latest.json',
    `${JSON.stringify({
      schema_version: 1,
      pack_version: version,
      generated_at: generatedAt,
      files: [{ path: 'official.json', sha256, packs, rules }],
    })}\n`,
  );
  const releaseId = await recordRelease(env, 'keywords', version, actorEmail, {
    action: 'rollback',
    restored_version: version,
  });
  await recordAdminAudit(env, actorEmail, 'rollback', 'keywords', version, { release_id: releaseId });
  return { release_id: releaseId, version, sha256 };
}
