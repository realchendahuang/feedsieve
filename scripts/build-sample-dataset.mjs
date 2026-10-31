import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const hash = (value) => createHash('sha256').update(value).digest('hex');
// Coarse blocking key, not semantic equivalence. Reviewers must merge paraphrase families.
export function templateKey(text) {
  const normalized = (text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/https?:\/\/\S+/gu, '')
    .replace(/[\p{N}\p{P}\p{S}\p{Z}\p{C}]/gu, '');
  return normalized.length >= 8 ? hash(normalized) : null;
}
export function buildDataset(entries, { trainBefore, testAfter }) {
  if (!Number.isFinite(trainBefore) || !Number.isFinite(testAfter) || trainBefore >= testAfter)
    throw new Error('invalid_time_boundaries');
  const parent = entries.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const seen = new Map();
  entries.forEach((row, i) => {
    const s = row.sample;
    for (const key of [
      row.family && `family:${row.family}`,
      row.content_hash && `content:${row.content_hash}`,
      s.xUserId ? `user:${s.xUserId}` : `handle:${s.handle}`,
      `handle:${s.handle}`,
      s.postId && `post:${s.postId}`,
      templateKey(s.text) && `template:${templateKey(s.text)}`,
    ].filter(Boolean)) {
      if (seen.has(key)) parent[root(i)] = root(seen.get(key));
      else seen.set(key, i);
    }
  });
  const groups = new Map();
  entries.forEach((row, i) => {
    const key = root(i);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  const output = {
    schema_version: 1,
    trainBefore,
    testAfter,
    train: [],
    validation: [],
    test: [],
    excluded: [],
  };
  for (const rows of groups.values()) {
    const reviewed = rows.filter(
      (r) =>
        r.review_id &&
        ['spam', 'normal'].includes(r.verdict) &&
        r.family &&
        r.sample.text &&
        r.sample.truncated.length === 0,
    );
    const labels = new Map();
    let conflict = false;
    for (const r of reviewed) {
      const key = r.content_hash;
      if (labels.has(key) && labels.get(key) !== r.verdict) conflict = true;
      labels.set(key, r.verdict);
    }
    // Use conservative earliest of server receipt and claimed observation. Client clocks cannot certify time.
    const period = (r) => {
      const t = Math.min(r.sample.observedAt, r.received_at * 1000);
      return t < trainBefore ? 'train' : t < testAfter ? 'validation' : 'test';
    };
    const periods = new Set(rows.map(period));
    if (conflict || periods.size !== 1) {
      output.excluded.push(
        ...rows.map((r) => ({
          id: r.id,
          reason: conflict ? 'conflicting_labels' : 'cross_time_group',
        })),
      );
      continue;
    }
    const partition = [...periods][0];
    const dedupe = new Set();
    for (const r of rows) {
      if (!reviewed.includes(r)) {
        output.excluded.push({ id: r.id, reason: 'unreviewed_uncertain_or_incomplete' });
        continue;
      }
      if (dedupe.has(r.content_hash)) {
        output.excluded.push({ id: r.id, reason: 'duplicate_content' });
        continue;
      }
      dedupe.add(r.content_hash);
      output[partition].push(r);
    }
  }
  // Stable manifest binds every selected evidence/review revision and the split policy.
  output.dataset_sha256 = hash(JSON.stringify(output));
  return output;
}
export function evaluateDataset(dataset, predictions) {
  const byId = new Map();
  for (const p of predictions) {
    if (byId.has(p.id) || !['spam', 'normal'].includes(p.label))
      throw new Error('invalid_or_duplicate_prediction');
    byId.set(p.id, p.label);
  }
  const counts = (rows) => {
    let tp = 0,
      tn = 0,
      fp = 0,
      fn = 0;
    for (const r of rows) {
      if (!byId.has(r.id)) throw new Error(`missing_prediction:${r.id}`);
      const positive = byId.get(r.id) === 'spam';
      if (r.verdict === 'spam') {
        if (positive) tp++;
        else fn++;
      } else if (positive) fp++;
      else tn++;
    }
    return {
      tp,
      tn,
      fp,
      fn,
      recall: tp + fn ? tp / (tp + fn) : null,
      false_positive_rate: fp + tn ? fp / (fp + tn) : null,
      precision: tp + fp ? tp / (tp + fp) : null,
    };
  };
  const overall = counts(dataset.test);
  return {
    dataset_sha256: dataset.dataset_sha256,
    status:
      !dataset.test.length || overall.recall === null || overall.false_positive_rate === null
        ? 'insufficient_data'
        : 'measured',
    overall,
    families: Object.fromEntries(
      [...new Set(dataset.test.map((r) => r.family))].map((f) => [
        f,
        counts(dataset.test.filter((r) => r.family === f)),
      ]),
    ),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output, trainDate, testDate, predictionPath] = process.argv.slice(2);
  if (!input || !output || !trainDate || !testDate)
    throw new Error(
      'Usage: node scripts/build-sample-dataset.mjs export.json output.json TRAIN_BEFORE_ISO TEST_AFTER_ISO [predictions.json]',
    );
  const raw = JSON.parse(readFileSync(input, 'utf8'));
  if (raw.schema_version !== 1 || !Array.isArray(raw.entries)) throw new Error('invalid_export');
  const dataset = buildDataset(raw.entries, {
    trainBefore: Date.parse(trainDate),
    testAfter: Date.parse(testDate),
  });
  writeFileSync(output, JSON.stringify(dataset, null, 2) + '\n');
  if (predictionPath)
    writeFileSync(
      output + '.metrics.json',
      JSON.stringify(
        evaluateDataset(dataset, JSON.parse(readFileSync(predictionPath, 'utf8'))),
        null,
        2,
      ) + '\n',
    );
  console.log(
    JSON.stringify({
      train: dataset.train.length,
      validation: dataset.validation.length,
      test: dataset.test.length,
      excluded: dataset.excluded.length,
      dataset_sha256: dataset.dataset_sha256,
    }),
  );
}
