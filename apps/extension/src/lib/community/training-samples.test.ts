// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTrainingSample,
  enqueueTrainingSample,
  flushTrainingSamples,
} from './training-samples';
let stored: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  stored = { communitySettings: { enabled: true, autoContribute: true, strength: 'standard' } };
  vi.stubGlobal('browser', {
    storage: {
      local: {
        get: vi.fn(async (key: string | null) =>
          key === null ? { ...stored } : { [key]: stored[key] },
        ),
        set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(stored, patch)),
        remove: vi.fn(async (keys: string[]) => keys.forEach((k) => delete stored[k])),
      },
    },
    runtime: {
      getManifest: () => ({ version: '0.9.4' }),
      sendMessage: vi.fn(async () => undefined),
    },
  });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
const pending = () => Object.keys(stored).filter((k) => k.startsWith('trainingSamplePending:'));
describe('user feedback durable outbox', () => {
  it('separates actions from detection, flags truncation, strips custom rule details', () => {
    const s = createTrainingSample('User', 'false-positive', {
      tweetText: 'a'.repeat(5000),
      displayName: '昵称',
      detectionSource: 'heuristic',
      ruleId: 'keyword:custom:secret',
      signalIds: ['private'],
      observedAt: 100,
    });
    expect(s).toMatchObject({
      handle: 'user',
      action: 'false-positive',
      observedAt: 100,
      truncated: ['text'],
      detection: { source: 'heuristic', ruleId: 'keyword:custom', signalIds: [] },
    });
    expect(s.text).toHaveLength(4000);
    expect(s).not.toHaveProperty('verdict');
  });
  it('keeps concurrent tab events, offline retry, new events during flush, and removes only acknowledged IDs', async () => {
    const a = createTrainingSample('usera', 'manual-spam', { tweetText: '正文' });
    const b = createTrainingSample('userb', 'false-positive', { tweetText: '不是广告' });
    await Promise.all([enqueueTrainingSample(a), enqueueTrainingSample(b)]);
    expect(pending()).toHaveLength(2);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await flushTrainingSamples();
    expect(pending()).toHaveLength(2);
    const c = createTrainingSample('userc', 'accepted-detection', {});
    fetchMock.mockImplementationOnce(async () => {
      await enqueueTrainingSample(c);
      return new Response(JSON.stringify({ accepted: [a.eventId] }));
    });
    await flushTrainingSamples();
    expect(pending()).toHaveLength(2);
    expect(stored[`trainingSamplePending:${b.eventId}`]).toBeDefined();
    expect(stored[`trainingSamplePending:${c.eventId}`]).toBeDefined();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ accepted: [b.eventId, c.eventId] })),
    );
    await flushTrainingSamples();
    expect(pending()).toHaveLength(0);
  });
  it('preserves rejected evidence separately and continues acknowledged good events', async () => {
    const bad = createTrainingSample('bad', 'manual-spam', {});
    const good = createTrainingSample('good', 'false-positive', {});
    await enqueueTrainingSample(bad);
    await enqueueTrainingSample(good);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          accepted: [good.eventId],
          rejected: [{ eventId: bad.eventId, error: 'invalid_sample' }],
        }),
      ),
    );
    await flushTrainingSamples();
    expect(pending()).toHaveLength(0);
    expect(stored[`trainingSampleRejected:${bad.eventId}`]).toMatchObject({
      sample: bad,
      error: 'invalid_sample',
    });
  });

  it('persists the local action and evidence in one write, or neither on storage failure', async () => {
    const s = createTrainingSample('user', 'false-positive', {});
    await enqueueTrainingSample(s, { allowlist: [{ handle: 'user' }] });
    expect(browser.storage.local.set).toHaveBeenLastCalledWith({
      allowlist: [{ handle: 'user' }],
      [`trainingSamplePending:${s.eventId}`]: s,
    });
    vi.mocked(browser.storage.local.set).mockRejectedValueOnce(new Error('quota'));
    const failed = createTrainingSample('other', 'manual-spam', {});
    await expect(enqueueTrainingSample(failed, { blockedAccounts: [] })).rejects.toThrow('quota');
    expect(stored[`trainingSamplePending:${failed.eventId}`]).toBeUndefined();
  });

  it('does not collect while opted out or upload queued evidence after opt out', async () => {
    const s = createTrainingSample('user', 'manual-spam', {});
    await enqueueTrainingSample(s);
    stored.communitySettings = { autoContribute: false };
    await enqueueTrainingSample(createTrainingSample('other', 'false-positive', {}));
    await flushTrainingSamples();
    expect(pending()).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
