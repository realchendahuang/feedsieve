import { describe, expect, it } from 'vitest';
import { buildDataset, evaluateDataset } from './build-sample-dataset.mjs';
const row = (id: number, time: number, family: string, extra = {}) => ({
  id,
  received_at: time / 1000,
  content_hash: `hash${id}`,
  review_id: id,
  verdict: 'spam',
  family,
  sample: {
    handle: `user${id}`,
    observedAt: time,
    text: `独立文本${String.fromCharCode(0x4e00 + id).repeat(8)}`,
    truncated: [],
  },
  ...extra,
});
const options = { trainBefore: 10000, testAfter: 20000 };
describe('time and family dataset split', () => {
  it('purges entire families spanning boundaries, including indirect account links', () => {
    const a = row(1, 1000, 'a');
    const b = row(2, 25000, 'a');
    const c = row(3, 26000, 'b');
    c.sample.handle = b.sample.handle;
    const ds = buildDataset([a, b, c, row(4, 27000, 'c')], options);
    expect(ds.train).toHaveLength(0);
    expect(ds.test.map((r: { id: number }) => r.id)).toEqual([4]);
    expect(ds.excluded).toHaveLength(3);
  });
  it('blocks timestamp/emoji variants even if reviewer used different families', () => {
    const a = row(1, 1000, 'a');
    const b = row(2, 25000, 'b');
    a.sample.text = '那一夜你👆没有拒绝我 1789266426152';
    b.sample.text = '那一夜你没有拒绝我😁 1789266426153';
    const ds = buildDataset([a, b], options);
    expect(ds.test).toHaveLength(0);
    expect(ds.excluded).toHaveLength(2);
  });
  it('excludes unreviewed, truncated, conflicting labels; deduplicates repeated votes', () => {
    const a = row(1, 25000, 'a');
    const b = row(2, 25000, 'b', { content_hash: a.content_hash, verdict: 'normal' });
    const c = row(3, 25000, 'c', { review_id: null });
    const ds = buildDataset([a, b, c], options);
    expect(ds.test).toHaveLength(0);
    const duplicate = row(4, 26000, 'a', { content_hash: a.content_hash });
    expect(buildDataset([a, duplicate], options).test).toHaveLength(1);
  });
  it('reports actual denominators and missing predictions, not a perfect empty score', () => {
    const ds = buildDataset(
      [row(1, 25000, 'a'), row(2, 25000, 'b', { verdict: 'normal' })],
      options,
    );
    expect(() => evaluateDataset(ds, [])).toThrow('missing_prediction');
    expect(
      evaluateDataset(ds, [
        { id: 1, label: 'normal' },
        { id: 2, label: 'normal' },
      ]),
    ).toMatchObject({
      status: 'measured',
      overall: { fn: 1, tn: 1, recall: 0, false_positive_rate: 0, precision: null },
    });
    expect(evaluateDataset(buildDataset([], options), []).status).toBe('insufficient_data');
  });
});
