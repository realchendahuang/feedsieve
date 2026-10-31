import { and, asc, count, desc, eq, ilike, type SQL } from 'drizzle-orm';
import { recordAdminAudit, recordRelease } from './admin-accounts';
import { getDb } from './db/client';
import { adminKeywordPacks, adminKeywordRules, meta } from './db/schema';
import {
  buildSigningMessage,
  signManifestMessage,
  type ManifestSignature,
} from '@feedsieve/community-lists';
import { validateDetectorConfigOverride } from '@feedsieve/detector';
import { sha256Hex } from './lib/hash';
import { collateC, escapeLike, stripNul } from './lib/sql';

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

/** API 边界归一化后的行：布尔是布尔、JSON 数组是数组，前端不再做二次解析。 */
export interface AdminKeywordPack {
  id: string;
  name_zh: string;
  name_en: string;
  description_zh: string;
  description_en: string;
  source_refs: string[];
  active: boolean;
  created_at: number;
  updated_at: number;
}

export interface AdminKeywordRule {
  id: string;
  pack_id: string;
  phrase: string;
  terms: string[] | null;
  max_gap: number | null;
  active: boolean;
  created_at: number;
  updated_at: number;
}

export interface ListKeywordsOptions {
  /** 按词组子串过滤规则（LIKE，忽略大小写）。 */
  q?: string;
  /** 只取某个分类下的规则。 */
  packId?: string;
  /** undefined = 不设上限（发布同步需要全量）；路由层固定传值。 */
  limit?: number | null;
}

function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => cleanText(item)).filter((item) => item.length > 0)
    : [];
}

/** 客户端文本字段：去 NUL（PG text 不收）并 trim；非字符串视为空。 */
function cleanText(value: unknown): string {
  return typeof value === 'string' ? stripNul(value).trim() : '';
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

function parseStringArrayColumn(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

/**
 * 将当前公开词库导入维护者工作区。这是显式动作（后台按钮 / 专用接口），
 * 不再挂在每次列表读取上：导入只发生在空表上，维护者之后做过的草稿
 * 永远优先于旧版 R2 产物。
 */
export async function importKeywordCatalog(
  env: Cloudflare.Env,
): Promise<{ imported: boolean; packs: number; rules: number }> {
  if (!env.KEYWORD_PACKS) throw new Error('keyword_packs_unavailable');
  const db = getDb(env);
  const [existing] = await db.select({ n: count() }).from(adminKeywordPacks);
  if ((existing?.n ?? 0) > 0) return { imported: false, packs: 0, rules: 0 };

  const latest = await env.KEYWORD_PACKS.get('keyword-packs/latest.json');
  if (!latest) return { imported: false, packs: 0, rules: 0 };
  let manifest: { pack_version?: unknown };
  try {
    manifest = JSON.parse(await latest.text()) as { pack_version?: unknown };
  } catch {
    return { imported: false, packs: 0, rules: 0 };
  }
  const version = typeof manifest.pack_version === 'string' ? manifest.pack_version : '';
  if (!VERSION.test(version)) return { imported: false, packs: 0, rules: 0 };
  const source = await env.KEYWORD_PACKS.get(`keyword-packs/${version}/official.json`);
  if (!source) return { imported: false, packs: 0, rules: 0 };

  let catalog: { packs?: unknown };
  try {
    catalog = JSON.parse(await source.text()) as { packs?: unknown };
  } catch {
    return { imported: false, packs: 0, rules: 0 };
  }
  const rawPacks = catalog.packs;
  if (!Array.isArray(rawPacks)) return { imported: false, packs: 0, rules: 0 };
  const packs = rawPacks.flatMap((raw): KeywordPackDocument[] => {
    if (!isRecord(raw) || !PACK_ID.test(String(raw.id))) return [];
    const name = isRecord(raw.name) ? raw.name : {};
    const description = isRecord(raw.description) ? raw.description : {};
    const zh = cleanText(name.zh);
    const en = cleanText(name.en);
    const descriptionZh = cleanText(description.zh);
    const descriptionEn = cleanText(description.en);
    if (!zh || !en || !descriptionZh || !descriptionEn) return [];
    const rules = Array.isArray(raw.rules)
      ? raw.rules.flatMap((candidate): KeywordRuleDocument[] => {
          if (!isRecord(candidate)) return [];
          const id = typeof candidate.id === 'string' ? candidate.id : '';
          const phrase = cleanText(candidate.phrase);
          const terms = stringArray(candidate.terms);
          const maxGap = parseMaxGap(candidate.max_gap);
          if (!RULE_ID.test(id) || !phrase || phrase.length > 80) return [];
          if (terms.length > 0 && (terms.length < 2 || terms.length > 5 || maxGap === null))
            return [];
          return [{ id, phrase, ...(terms.length ? { terms, max_gap: maxGap! } : {}) }];
        })
      : [];
    return [
      {
        id: String(raw.id),
        name: { zh, en },
        description: { zh: descriptionZh, en: descriptionEn },
        source_refs: stringArray(raw.source_refs),
        rules,
      },
    ];
  });
  if (!packs.length) return { imported: false, packs: 0, rules: 0 };

  const time = now();
  const packValues = packs.map((pack) => ({
    id: pack.id,
    nameZh: pack.name.zh,
    nameEn: pack.name.en,
    descriptionZh: pack.description.zh,
    descriptionEn: pack.description.en,
    sourceRefs: JSON.stringify(pack.source_refs),
    active: 1,
    createdAt: time,
    updatedAt: time,
  }));
  const ruleValues = packs.flatMap((pack) =>
    pack.rules.map((rule) => ({
      id: rule.id,
      packId: pack.id,
      phrase: rule.phrase,
      terms: rule.terms?.length ? JSON.stringify(rule.terms) : null,
      maxGap: rule.terms?.length ? (rule.max_gap ?? null) : null,
      active: 1,
      createdAt: time,
      updatedAt: time,
    })),
  );
  // 分类先于规则写入（外键）；整体一个事务，规则按 1000 条一批。
  await db.transaction(async (tx) => {
    await tx.insert(adminKeywordPacks).values(packValues).onConflictDoNothing();
    for (let index = 0; index < ruleValues.length; index += 1000) {
      await tx
        .insert(adminKeywordRules)
        .values(ruleValues.slice(index, index + 1000))
        .onConflictDoNothing();
    }
  });
  return { imported: true, packs: packs.length, rules: ruleValues.length };
}

export async function listAdminKeywords(
  env: Cloudflare.Env,
  options: ListKeywordsOptions = {},
): Promise<{ packs: AdminKeywordPack[]; rules: AdminKeywordRule[] }> {
  const db = getDb(env);
  const q = options.q?.trim();
  const packId = options.packId?.trim();
  const limit =
    typeof options.limit === 'number'
      ? Math.min(Math.max(Math.trunc(options.limit), 1), 1000)
      : null;

  const conditions: SQL[] = [];
  if (packId) conditions.push(eq(adminKeywordRules.packId, packId));
  if (q) conditions.push(ilike(adminKeywordRules.phrase, `%${escapeLike(q)}%`));

  const ruleQuery = db
    .select({
      id: adminKeywordRules.id,
      pack_id: adminKeywordRules.packId,
      phrase: adminKeywordRules.phrase,
      terms: adminKeywordRules.terms,
      max_gap: adminKeywordRules.maxGap,
      active: adminKeywordRules.active,
      created_at: adminKeywordRules.createdAt,
      updated_at: adminKeywordRules.updatedAt,
    })
    .from(adminKeywordRules)
    .where(and(...conditions))
    .orderBy(
      asc(collateC(adminKeywordRules.packId)),
      desc(adminKeywordRules.active),
      asc(collateC(adminKeywordRules.phrase)),
    );
  const [packRows, ruleRows] = await Promise.all([
    db
      .select({
        id: adminKeywordPacks.id,
        name_zh: adminKeywordPacks.nameZh,
        name_en: adminKeywordPacks.nameEn,
        description_zh: adminKeywordPacks.descriptionZh,
        description_en: adminKeywordPacks.descriptionEn,
        source_refs: adminKeywordPacks.sourceRefs,
        active: adminKeywordPacks.active,
        created_at: adminKeywordPacks.createdAt,
        updated_at: adminKeywordPacks.updatedAt,
      })
      .from(adminKeywordPacks)
      .orderBy(desc(adminKeywordPacks.active), asc(collateC(adminKeywordPacks.id))),
    limit === null ? ruleQuery : ruleQuery.limit(limit),
  ]);
  return {
    packs: packRows.map((row) => ({
      ...row,
      active: row.active === 1,
      source_refs: parseStringArrayColumn(row.source_refs),
    })),
    rules: ruleRows.map((row) => ({
      ...row,
      active: row.active === 1,
      terms: parseStringArrayColumn(row.terms),
    })),
  };
}

export async function saveAdminKeywordPack(
  env: Cloudflare.Env,
  raw: unknown,
  actorEmail = 'system',
) {
  const input = isRecord(raw) ? raw : {};
  const rawId = typeof input.id === 'string' ? input.id.trim() : '';
  const id = rawId || randomId('pack');
  const nameZh = cleanText(input.name_zh);
  const nameEn = cleanText(input.name_en) || nameZh;
  const descriptionZh = cleanText(input.description_zh);
  const descriptionEn = cleanText(input.description_en) || descriptionZh;
  if (!PACK_ID.test(id) || !nameZh || !nameEn || !descriptionZh || !descriptionEn) return null;
  const refs = stringArray(input.source_refs);
  const time = now();
  await getDb(env)
    .insert(adminKeywordPacks)
    .values({
      id,
      nameZh,
      nameEn,
      descriptionZh,
      descriptionEn,
      sourceRefs: JSON.stringify(refs),
      active: 1,
      createdAt: time,
      updatedAt: time,
    })
    .onConflictDoUpdate({
      target: adminKeywordPacks.id,
      set: {
        nameZh,
        nameEn,
        descriptionZh,
        descriptionEn,
        sourceRefs: JSON.stringify(refs),
        active: 1,
        updatedAt: time,
      },
    });
  await recordAdminAudit(env, actorEmail, rawId ? 'update_draft' : 'add_draft', 'keyword_pack', id);
  return { id };
}

export async function saveAdminKeywordRule(
  env: Cloudflare.Env,
  raw: unknown,
  actorEmail = 'system',
) {
  const input = isRecord(raw) ? raw : {};
  const rawId = typeof input.id === 'string' ? input.id.trim() : '';
  const id = rawId || randomId('rule');
  const packId = typeof input.pack_id === 'string' ? input.pack_id.trim() : '';
  const phrase = cleanText(input.phrase);
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
  const db = getDb(env);
  const [exists] = await db
    .select({ id: adminKeywordPacks.id })
    .from(adminKeywordPacks)
    .where(and(eq(adminKeywordPacks.id, packId), eq(adminKeywordPacks.active, 1)));
  if (!exists) return null;
  const time = now();
  const ruleTerms = terms.length ? JSON.stringify(terms) : null;
  const ruleMaxGap = terms.length ? maxGap : null;
  await db
    .insert(adminKeywordRules)
    .values({
      id,
      packId,
      phrase,
      terms: ruleTerms,
      maxGap: ruleMaxGap,
      active: 1,
      createdAt: time,
      updatedAt: time,
    })
    .onConflictDoUpdate({
      target: adminKeywordRules.id,
      set: { packId, phrase, terms: ruleTerms, maxGap: ruleMaxGap, active: 1, updatedAt: time },
    });
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
  const db = getDb(env);
  const set = { active: 0, updatedAt: now() };
  const changed =
    table === 'admin_keyword_packs'
      ? await db
          .update(adminKeywordPacks)
          .set(set)
          .where(and(eq(adminKeywordPacks.id, id), eq(adminKeywordPacks.active, 1)))
          .returning({ id: adminKeywordPacks.id })
      : await db
          .update(adminKeywordRules)
          .set(set)
          .where(and(eq(adminKeywordRules.id, id), eq(adminKeywordRules.active, 1)))
          .returning({ id: adminKeywordRules.id });
  if (changed.length > 0) {
    await recordAdminAudit(
      env,
      actorEmail,
      'remove_draft',
      table === 'admin_keyword_packs' ? 'keyword_pack' : 'keyword_rule',
      id,
    );
  }
  return changed.length > 0;
}

function nextVersion(current: string | undefined, stamp: string): string {
  const prior = current?.startsWith(`${stamp}.`) ? Number(current.split('.')[3]) : 0;
  return `${stamp}.${Number.isInteger(prior) && prior >= 0 ? prior + 1 : 1}`;
}

// manifest 契约与扩展 parseManifest / shared signing.ts 一致：schema_version=1，
// 文件清单 count 用 rules 数。signature 在配置了发布密钥时嵌入（与快照同一把
// release-1 私钥）；REQUIRE_SIGNED_KEYWORD_PACKS=1 时密钥缺失直接拒绝发布，
// 避免把扩展必拒（signature_missing）的无签名 latest 顶上 R2 —— 那等于假发布。
interface KeywordPackManifestDocument {
  schema_version: 1;
  pack_version: string;
  generated_at: string;
  files: Array<{ path: 'official.json'; sha256: string; packs: number; rules: number }>;
  signature?: ManifestSignature;
}

function assertKeywordSigningAvailable(env: Cloudflare.Env) {
  if (
    env.REQUIRE_SIGNED_KEYWORD_PACKS === '1' &&
    (!env.SIGNING_PRIVATE_KEY || !env.SIGNING_KEY_ID)
  ) {
    throw new Error('signing_key_missing');
  }
}

/**
 * 发布互斥：发布流程是「读 latest → 算版本号 → 两次 R2 PUT」，两个并发发布
 * 会算出同一个版本号交替写文件体与 latest 指针，产出 manifest 与内容 sha256
 * 不一致的 torn 写（客户端 checksum_mismatch 拒收，直到下一次发布才恢复）。
 * 单运营者场景的真实并发是双击 / 保存即发布连发，isolate 内 Promise 链互斥
 * 足够；跨 isolate 的版本号预留是后继项（快照侧已有 INSERT OR IGNORE 同款）。
 */
let publishLock: Promise<unknown> = Promise.resolve();
function withPublishLock<T>(operation: () => Promise<T>): Promise<T> {
  const next = publishLock.then(operation, operation);
  publishLock = next.catch(() => {
    // 吞掉让后续发布不受前次失败影响；调用方自己拿原始 rejection
  });
  return next;
}

async function signKeywordManifest(
  env: Cloudflare.Env,
  manifest: KeywordPackManifestDocument,
): Promise<KeywordPackManifestDocument> {
  if (!env.SIGNING_PRIVATE_KEY || !env.SIGNING_KEY_ID) return manifest;
  const message = buildSigningMessage({
    schemaVersion: manifest.schema_version,
    version: manifest.pack_version,
    generatedAt: manifest.generated_at,
    files: manifest.files.map((file) => ({
      path: file.path,
      sha256: file.sha256,
      count: file.rules,
    })),
  });
  return {
    ...manifest,
    signature: await signManifestMessage(message, env.SIGNING_PRIVATE_KEY, env.SIGNING_KEY_ID),
  };
}

export async function publishAdminKeywords(env: Cloudflare.Env, actorEmail = 'system') {
  return withPublishLock(() => publishAdminKeywordsInner(env, actorEmail));
}

/**
 * 天级判定参数（packages/detector 的运行时覆写）随词库发布链下发：
 * 当前生效值存 meta 表；发布时嵌入 official.json 的 `detector_config` 段，
 * 与 manifest/checksum/验签同一条签名链。回滚随历史 body 原样找回。
 */
export const KEYWORD_DETECTOR_CONFIG_META_KEY = 'keyword_detector_config';

/** 读当前配置；无存值或存值非法时返回 null（发布缺省段，客户端回退内置兜底）。 */
export async function getKeywordDetectorConfig(env: Cloudflare.Env): Promise<unknown | null> {
  const [row] = await getDb(env)
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, KEYWORD_DETECTOR_CONFIG_META_KEY));
  if (!row) return null;
  try {
    const parsed: unknown = JSON.parse(row.value);
    return validateDetectorConfigOverride(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 校验后写入配置；传 null 清除（等价回退发布段缺省）。非法值 fail closed。 */
export function setKeywordDetectorConfig(env: Cloudflare.Env, raw: unknown): Promise<boolean> {
  const write = async (value: string | null): Promise<boolean> => {
    const db = getDb(env);
    if (value === null) {
      await db.delete(meta).where(eq(meta.key, KEYWORD_DETECTOR_CONFIG_META_KEY));
      return true;
    }
    await db
      .insert(meta)
      .values({ key: KEYWORD_DETECTOR_CONFIG_META_KEY, value })
      .onConflictDoUpdate({ target: meta.key, set: { value } });
    return true;
  };
  if (raw === null) return write(null);
  if (!validateDetectorConfigOverride(raw)) return Promise.resolve(false);
  return write(JSON.stringify(raw));
}

/**
 * 发布时要携带的配置：meta 有值优先；否则继承最近一次发布 body 里携带的
 * 配置（避免一次普通词库发布意外回退参数）；再没有就不带段。
 */
async function detectorConfigForPublish(env: Cloudflare.Env): Promise<unknown | null> {
  const own = await getKeywordDetectorConfig(env);
  if (own) return own;
  try {
    const latest = await env.KEYWORD_PACKS?.get('keyword-packs/latest.json');
    if (!latest) return null;
    const manifest = JSON.parse(await latest.text()) as { pack_version?: unknown };
    if (typeof manifest.pack_version !== 'string') return null;
    const body = await env.KEYWORD_PACKS?.get(
      `keyword-packs/${manifest.pack_version}/official.json`,
    );
    if (!body) return null;
    const document = JSON.parse(await body.text()) as { detector_config?: unknown };
    return validateDetectorConfigOverride(document.detector_config)
      ? document.detector_config
      : null;
  } catch {
    return null;
  }
}

async function publishAdminKeywordsInner(env: Cloudflare.Env, actorEmail: string) {
  if (!env.KEYWORD_PACKS) throw new Error('keyword_packs_unavailable');
  assertKeywordSigningAvailable(env);
  const { packs, rules } = await listAdminKeywords(env, { limit: null });
  const activePacks = packs.filter((pack) => pack.active);
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
  const activeRules = rules.filter((rule) => rule.active);
  const detectorConfig = await detectorConfigForPublish(env);
  const document = {
    schema_version: 1,
    pack_version: version,
    generated_at: generatedAt,
    packs: activePacks.map((pack) => ({
      id: pack.id,
      name: { zh: pack.name_zh, en: pack.name_en },
      description: { zh: pack.description_zh, en: pack.description_en },
      source_refs: pack.source_refs,
      rules: activeRules
        .filter((rule) => rule.pack_id === pack.id)
        .map((rule) => ({
          id: rule.id,
          phrase: rule.phrase,
          name: { zh: rule.phrase, en: rule.phrase },
          ...(rule.terms?.length ? { terms: rule.terms, max_gap: rule.max_gap } : {}),
        })),
    })),
    ...(detectorConfig ? { detector_config: detectorConfig } : {}),
  };
  const body = `${JSON.stringify(document)}\n`;
  const sha256 = await sha256Hex(body);
  const manifestDocument: KeywordPackManifestDocument = {
    schema_version: 1,
    pack_version: version,
    generated_at: generatedAt,
    files: [
      { path: 'official.json', sha256, packs: activePacks.length, rules: activeRules.length },
    ],
  };
  const manifest = `${JSON.stringify(await signKeywordManifest(env, manifestDocument))}\n`;
  await env.KEYWORD_PACKS.put(`keyword-packs/${version}/official.json`, body);
  await env.KEYWORD_PACKS.put('keyword-packs/latest.json', manifest);
  const releaseId = await recordRelease(env, 'keywords', version, actorEmail, {
    sha256,
    packs: activePacks.length,
    rules: activeRules.length,
  });
  await recordAdminAudit(env, actorEmail, 'publish', 'keywords', version, {
    release_id: releaseId,
  });
  return {
    release_id: releaseId,
    version,
    sha256,
    packs: activePacks.length,
    rules: activeRules.length,
  };
}

/**
 * 回滚 = 把指定历史版本的内容以「新版本号」重新签名发布。
 * 客户端对已接受版本有防回滚（rollback_rejected），复用旧版本号写 latest 会被拒收；
 * body 内的 pack_version 必须等于 manifest 版本，所以历史 body 要重写版本字段。
 */
export async function rollbackAdminKeywordRelease(
  env: Cloudflare.Env,
  version: string,
  actorEmail: string,
) {
  return withPublishLock(() => rollbackAdminKeywordReleaseInner(env, version, actorEmail));
}

async function rollbackAdminKeywordReleaseInner(
  env: Cloudflare.Env,
  version: string,
  actorEmail: string,
) {
  if (!VERSION.test(version) || !env.KEYWORD_PACKS) throw new Error('invalid_release');
  assertKeywordSigningAvailable(env);
  const object = await env.KEYWORD_PACKS.get(`keyword-packs/${version}/official.json`);
  if (!object) throw new Error('release_not_found');
  const raw = await object.text();
  let document: { packs?: unknown };
  try {
    document = JSON.parse(raw) as { packs?: unknown };
  } catch {
    throw new Error('release_invalid');
  }
  if (!Array.isArray(document.packs)) throw new Error('release_invalid');
  const packs = document.packs.length;
  const rules = document.packs.reduce(
    (total, pack) => total + (isRecord(pack) && Array.isArray(pack.rules) ? pack.rules.length : 0),
    0,
  );
  const latest = await env.KEYWORD_PACKS.get('keyword-packs/latest.json');
  let latestVersion: string | undefined;
  try {
    const parsed = latest ? (JSON.parse(await latest.text()) as { pack_version?: unknown }) : {};
    latestVersion = typeof parsed.pack_version === 'string' ? parsed.pack_version : undefined;
  } catch {
    // Invalid legacy manifest: 回滚仍应能产出一个新的有效版本。
  }
  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.slice(0, 10).replaceAll('-', '.');
  const restoredVersion = nextVersion(latestVersion, stamp);
  if (!VERSION.test(restoredVersion)) throw new Error('invalid_version');
  const restoredBody = `${JSON.stringify({ ...document, pack_version: restoredVersion, generated_at: generatedAt })}\n`;
  const sha256 = await sha256Hex(restoredBody);
  const manifestDocument: KeywordPackManifestDocument = {
    schema_version: 1,
    pack_version: restoredVersion,
    generated_at: generatedAt,
    files: [{ path: 'official.json', sha256, packs, rules }],
  };
  const manifest = `${JSON.stringify(await signKeywordManifest(env, manifestDocument))}\n`;
  await env.KEYWORD_PACKS.put(`keyword-packs/${restoredVersion}/official.json`, restoredBody);
  await env.KEYWORD_PACKS.put('keyword-packs/latest.json', manifest);
  const releaseId = await recordRelease(env, 'keywords', restoredVersion, actorEmail, {
    action: 'rollback',
    restored_version: version,
    sha256,
  });
  await recordAdminAudit(env, actorEmail, 'rollback', 'keywords', restoredVersion, {
    release_id: releaseId,
    restored_version: version,
  });
  return { release_id: releaseId, version: restoredVersion, restored_version: version, sha256 };
}
