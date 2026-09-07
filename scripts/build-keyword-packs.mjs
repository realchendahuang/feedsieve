#!/usr/bin/env node
/* global URL, process, console, structuredClone, Buffer */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as nodeSign,
  verify as nodeVerify,
} from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { buildKeywordPackManifestMessage } from './signing-message.mjs';

// 与 packages/community-lists/src/trusted-keys.ts 的 release-1 对应；
// 轮换时两处同步新增 key_id。
const SIGNING_KEY_ID = 'release-1';
const SIGNING_PUBLIC_KEY_B64 = 'CJH7JfZZs3z2Iw9+hlCs0FWh8HoJmycx7UatXDVSnic=';

const sourcePath = new URL('../community/keyword-packs/source.json', import.meta.url);
const sourceDirectory = new URL('../community/keyword-packs/', import.meta.url);
const outputPath = new URL('../community/keyword-packs/official.json', import.meta.url);
const manifestPath = new URL('../community/keyword-packs/manifest.json', import.meta.url);
const check = process.argv.includes('--check');
const versionPattern = /^\d{4}\.\d{2}\.\d{2}\.\d{1,4}$/;

function fail(message) {
  throw new Error(`invalid keyword-pack source: ${message}`);
}

async function loadSigningKey() {
  const keyFile =
    process.env.FEEDSIEVE_SIGNING_KEY_FILE ??
    new URL('../.secrets/signing-key.pkcs8.base64', import.meta.url);
  try {
    const raw = (await readFile(keyFile, 'utf8')).trim();
    return raw
      ? createPrivateKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'pkcs8' })
      : null;
  } catch {
    return null;
  }
}

async function buildSignedManifest(parsed, sha256) {
  const privateKey = await loadSigningKey();
  if (!privateKey) return null;
  const message = buildKeywordPackManifestMessage(parsed.pack_version, parsed.generated_at, sha256, countRules(parsed));
  const sig = nodeSign(null, Buffer.from(message), privateKey).toString('base64');
  return {
    schema_version: 1,
    pack_version: parsed.pack_version,
    generated_at: parsed.generated_at,
    files: [{ path: 'official.json', sha256, packs: parsed.packs.length, rules: countRules(parsed) }],
    signature: { key_id: SIGNING_KEY_ID, alg: 'ed25519', sig },
  };
}

function countRules(catalog) {
  return catalog.packs.reduce((total, pack) => total + pack.rules.length, 0);
}

function localized(value, path) {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.zh !== 'string' ||
    typeof value.en !== 'string'
  ) {
    fail(`${path} must provide zh/en text`);
  }
  return { zh: value.zh.trim(), en: value.en.trim() };
}

async function hydrateRuleSources(source) {
  const hydrated = structuredClone(source);
  for (const [index, pack] of (hydrated.packs ?? []).entries()) {
    if (typeof pack.rules_source !== 'string') continue;
    if (!/^[a-zA-Z0-9._-]+\.json$/.test(pack.rules_source)) fail(`packs[${index}].rules_source`);
    const values = JSON.parse(await readFile(new URL(pack.rules_source, sourceDirectory), 'utf8'));
    if (!Array.isArray(values) || values.some((value) => typeof value !== 'string'))
      fail(`packs[${index}].rules_source must be a string array`);
    const existingRules = Array.isArray(pack.rules) ? pack.rules : [];
    const existingPhrases = new Set(
      existingRules.flatMap((rule) => {
        if (Array.isArray(rule) && typeof rule[1] === 'string') return [rule[1]];
        if (rule && typeof rule === 'object' && typeof rule.phrase === 'string')
          return [rule.phrase];
        return [];
      }),
    );
    const phrases = [...new Set(values.map((value) => value.trim()).filter(Boolean))].filter(
      (phrase) => !existingPhrases.has(phrase),
    );
    const idPrefix = String(pack.id).replaceAll('_', '-');
    pack.rules = [
      ...existingRules,
      ...phrases.map((phrase) => [
        `${idPrefix}-${createHash('sha256').update(phrase).digest('hex').slice(0, 16)}`,
        phrase,
      ]),
    ];
  }
  return hydrated;
}

function build(source) {
  if (!source || typeof source !== 'object' || source.schema_version !== 1)
    fail('schema_version must be 1');
  if (typeof source.pack_version !== 'string' || !versionPattern.test(source.pack_version))
    fail('pack_version');
  if (!Array.isArray(source.packs) || source.packs.length === 0) fail('packs');
  const packIds = new Set();
  const ruleIds = new Set();
  const packs = source.packs.map((pack, index) => {
    if (
      !pack ||
      typeof pack !== 'object' ||
      typeof pack.id !== 'string' ||
      !/^[a-z][a-z0-9_]{1,63}$/.test(pack.id)
    )
      fail(`packs[${index}].id`);
    if (packIds.has(pack.id)) fail(`duplicate pack id ${pack.id}`);
    packIds.add(pack.id);
    if (
      !Array.isArray(pack.source_refs) ||
      pack.source_refs.some((ref) => typeof ref !== 'string' || !ref)
    )
      fail(`packs[${index}].source_refs`);
    if (!Array.isArray(pack.rules) || pack.rules.length === 0) fail(`packs[${index}].rules`);
    const rules = pack.rules.map((rule, ruleIndex) => {
      const tupleRule =
        Array.isArray(rule) &&
        rule.length === 2 &&
        typeof rule[0] === 'string' &&
        typeof rule[1] === 'string';
      const termsRule =
        rule &&
        !Array.isArray(rule) &&
        typeof rule === 'object' &&
        typeof rule.id === 'string' &&
        typeof rule.phrase === 'string' &&
        Array.isArray(rule.terms);
      if (!tupleRule && !termsRule) fail(`rules[${ruleIndex}]`);
      const id = tupleRule ? rule[0] : rule.id;
      const phrase = tupleRule ? rule[1] : rule.phrase;
      if (!/^[a-z][a-z0-9-]{2,95}$/.test(id) || ruleIds.has(id))
        fail(`duplicate or invalid rule id ${id}`);
      if (phrase.trim() !== phrase || phrase.length < 1 || phrase.length > 80)
        fail(`invalid phrase for ${id}`);
      let terms;
      let maxGap;
      if (termsRule) {
        terms = rule.terms;
        if (
          terms.length < 2 ||
          terms.length > 5 ||
          terms.some(
            (term) =>
              typeof term !== 'string' ||
              term.trim() !== term ||
              term.length < 1 ||
              term.length > 24,
          )
        )
          fail(`invalid terms for ${id}`);
        maxGap = rule.max_gap ?? 12;
        if (!Number.isInteger(maxGap) || maxGap < 0 || maxGap > 32)
          fail(`invalid max_gap for ${id}`);
      }
      ruleIds.add(id);
      return {
        id,
        phrase,
        name: { zh: phrase, en: phrase },
        ...(terms ? { terms, max_gap: maxGap } : {}),
      };
    });
    return {
      id: pack.id,
      name: localized(pack.name, `packs[${index}].name`),
      description: localized(pack.description, `packs[${index}].description`),
      source_refs: [...pack.source_refs].sort(),
      rules,
    };
  });
  return {
    schema_version: 1,
    pack_version: source.pack_version,
    generated_at: source.generated_at,
    packs,
  };
}

const source = await hydrateRuleSources(JSON.parse(await readFile(sourcePath, 'utf8')));
const output = `${JSON.stringify(build(source))}\n`;
const sha256 = createHash('sha256').update(output).digest('hex');
const parsed = JSON.parse(output);
// 版本守卫：内容变了但 pack_version 没变时，客户端会判 up_to_date，改动静默收不到。
// 与已提交产物比较（首次构建无产物时跳过）。
const committedOutput = await (async () => {
  try {
    return await readFile(outputPath, 'utf8');
  } catch {
    return null;
  }
})();
if (committedOutput !== null && committedOutput !== output) {
  const committedParsed = JSON.parse(committedOutput);
  if (committedParsed?.pack_version === parsed.pack_version) {
    fail(
      `keyword-pack content changed but pack_version (${parsed.pack_version}) did not; bump pack_version in community/keyword-packs/source.json first`,
    );
  }
}
const rules = countRules(parsed);
const manifest = `${JSON.stringify({ schema_version: 1, pack_version: parsed.pack_version, generated_at: parsed.generated_at, files: [{ path: 'official.json', sha256, packs: parsed.packs.length, rules }] })}\n`;
const signedManifest = await buildSignedManifest(parsed, sha256);
if (signedManifest && !check) {
  // 有密钥文件才在构建时嵌入签名；发布脚本对未签名 manifest 拒绝上传。
  const signed = `${JSON.stringify(signedManifest)}\n`;
  console.log(`signed manifest with key ${signedManifest.signature.key_id} (${signedManifest.signature.sig.slice(0, 12)}…)`);
  await Promise.all([writeFile(outputPath, output), writeFile(manifestPath, signed)]);
  console.log(`built ${parsed.packs.length} packs / ${rules} rules (${sha256.slice(0, 12)})`);
} else if (check) {
  const [existingOutput, existingManifest] = await Promise.all([
    readFile(outputPath, 'utf8'),
    readFile(manifestPath, 'utf8'),
  ]);
  if (existingOutput !== output) fail('generated artifacts are stale; run pnpm keyword-packs:build');
  // manifest 比对剥离签名：无密钥环境下（CI）也能核对内容；签名另行用内置公钥验证
  const committed = JSON.parse(existingManifest);
  const committedSig = committed?.signature;
  delete committed.signature;
  if (`${JSON.stringify(committed)}\n` !== manifest)
    fail('generated manifest is stale; run pnpm keyword-packs:build');
  if (committedSig) {
    const message = buildKeywordPackManifestMessage(
      committed.pack_version,
      committed.generated_at,
      committed.files[0]?.sha256,
      committed.files[0]?.rules,
    );
    // trusted-keys 存的是 RAW 32 字节公钥；node 需要 SPKI 包装（Ed25519 固定头）
    const raw = Buffer.from(SIGNING_PUBLIC_KEY_B64, 'base64');
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]);
    const publicKey = createPublicKey({ key: spki, format: 'der', type: 'spki' });
    const valid = nodeVerify(
      null,
      Buffer.from(message),
      publicKey,
      Buffer.from(committedSig.sig, 'base64'),
    );
    if (!valid) fail('committed manifest signature does not verify against the built-in key');
    if (committedSig.key_id !== SIGNING_KEY_ID) fail('committed manifest uses an unknown key_id');
  } else {
    console.warn('warning: committed manifest is NOT signed; publish-keyword-packs.sh will refuse');
  }
} else {
  await Promise.all([writeFile(outputPath, output), writeFile(manifestPath, manifest)]);
  console.warn(
    `no signing key found; built UNSIGNED manifest (publish will refuse). Set FEEDSIEVE_SIGNING_KEY_FILE or run scripts/keygen.mjs once`,
  );
  console.log(`built ${parsed.packs.length} packs / ${rules} rules (${sha256.slice(0, 12)})`);
}
