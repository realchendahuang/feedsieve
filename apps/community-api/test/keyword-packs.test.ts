import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';

const ORIGIN = 'https://api.example.com';
const VERSION = '2026.09.02.5';

describe('keyword-pack R2 distribution', () => {
  it('serves a short-cached manifest and immutable versioned artifact from R2', async () => {
    if (!env.KEYWORD_PACKS) {
      const unavailable = await worker.fetch(new Request(`${ORIGIN}/v1/keyword-packs/latest`), env);
      expect(unavailable.status).toBe(503);
      return;
    }
    const body = JSON.stringify({
      schema_version: 1,
      pack_version: VERSION,
      generated_at: null,
      packs: [],
    });
    await env.KEYWORD_PACKS.put(
      'keyword-packs/latest.json',
      JSON.stringify({
        schema_version: 1,
        pack_version: VERSION,
        files: [{ path: 'official.json', sha256: 'a'.repeat(64), packs: 0, rules: 0 }],
      }),
    );
    await env.KEYWORD_PACKS.put(`keyword-packs/${VERSION}/official.json`, body);

    const latest = await worker.fetch(new Request(`${ORIGIN}/v1/keyword-packs/latest`), env);
    expect(latest.status).toBe(200);
    expect(latest.headers.get('Cache-Control')).toContain('max-age=300');
    expect(((await latest.json()) as { pack_version: string }).pack_version).toBe(VERSION);

    const artifact = await worker.fetch(
      new Request(`${ORIGIN}/v1/keyword-packs/${VERSION}/official.json`),
      env,
    );
    expect(artifact.status).toBe(200);
    expect(artifact.headers.get('Cache-Control')).toContain('immutable');
    expect(await artifact.text()).toBe(body);
  });

  it('rejects paths outside the generated artifact contract', async () => {
    const response = await worker.fetch(
      new Request(`${ORIGIN}/v1/keyword-packs/not-a-version/anything.json`),
      env,
    );
    expect(response.status).toBe(404);
  });
});
