#!/usr/bin/env node
/* global URL, process, console */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const sourcePath = new URL('../community/keyword-packs/source.json', import.meta.url);
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
      if (
        !Array.isArray(rule) ||
        rule.length !== 2 ||
        typeof rule[0] !== 'string' ||
        typeof rule[1] !== 'string'
      )
        fail(`rules[${ruleIndex}]`);
      const [id, phrase] = rule;
      if (!/^[a-z][a-z0-9-]{2,95}$/.test(id) || ruleIds.has(id))
        fail(`duplicate or invalid rule id ${id}`);
      if (phrase.trim() !== phrase || phrase.length < 3 || phrase.length > 80)
        fail(`invalid phrase for ${id}`);
      ruleIds.add(id);
      return { id, phrase, name: { zh: `“${phrase}”`, en: `“${phrase}”` } };
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

const source = JSON.parse(await readFile(sourcePath, 'utf8'));
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
