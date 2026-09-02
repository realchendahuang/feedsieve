#!/usr/bin/env node
/* global URL, process, console, structuredClone */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const sourcePath = new URL('../community/keyword-packs/source.json', import.meta.url);
const sourceDirectory = new URL('../community/keyword-packs/', import.meta.url);
const outputPath = new URL('../community/keyword-packs/official.json', import.meta.url);
const manifestPath = new URL('../community/keyword-packs/manifest.json', import.meta.url);
const check = process.argv.includes('--check');
const versionPattern = /^\d{4}\.\d{2}\.\d{2}\.\d{1,4}$/;

function fail(message) {
  throw new Error(`invalid keyword-pack source: ${message}`);
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
const manifest = `${JSON.stringify({ schema_version: 1, pack_version: parsed.pack_version, generated_at: parsed.generated_at, files: [{ path: 'official.json', sha256, packs: parsed.packs.length, rules: parsed.packs.reduce((total, pack) => total + pack.rules.length, 0) }] })}\n`;

if (check) {
  const [existingOutput, existingManifest] = await Promise.all([
    readFile(outputPath, 'utf8'),
    readFile(manifestPath, 'utf8'),
  ]);
  if (existingOutput !== output || existingManifest !== manifest)
    fail('generated artifacts are stale; run pnpm keyword-packs:build');
} else {
  await Promise.all([writeFile(outputPath, output), writeFile(manifestPath, manifest)]);
  console.log(
    `built ${parsed.packs.length} packs / ${JSON.parse(manifest).files[0].rules} rules (${sha256.slice(0, 12)})`,
  );
}
