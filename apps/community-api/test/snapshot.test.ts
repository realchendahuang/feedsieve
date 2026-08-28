import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { SNAPSHOT_PACK } from '../src/snapshot';

const ORIGIN = 'https://api.example.com';
const ADMIN = env.ADMIN_TOKEN;

async function report(
  installationId: string,
  handle: string,
  extra: Record<string, unknown> = {},
) {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/v1/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        reports: [{ handle, reason: 'bot_spam', ...extra }],
      }),
    }),
    env,
  );
  expect(res.status).toBe(200);
}

async function publish(token?: string) {
  return worker.fetch(
    new Request(`${ORIGIN}/admin/publish`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
    env,
  );
}

interface Manifest {
  snapshot_version: string;
  generated_at: string;
  files: { path: string; sha256: string; entries: number }[];
}

async function sha256HexOf(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('snapshot pipeline', () => {
  it('admin auth: publish requires bearer token', async () => {
    expect((await publish()).status).toBe(401);
    expect((await publish('wrong-token')).status).toBe(401);
  });

  it('empty publish -> manifest with zero entries; new-status accounts excluded', async () => {
    await report('ssssssss-1000-4000-8000-ssssssssssss', 'only_new_user');

    const res = await publish(ADMIN);
    expect(res.status).toBe(200);
    const { snapshot_version, files } = (await res.json()) as Manifest;
    expect(snapshot_version).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d{1,4}$/);
    expect(files[0].entries).toBe(0);

    const latest = await worker.fetch(
      new Request(`${ORIGIN}/v1/snapshots/latest`),
      env,
    );
    expect(latest.status).toBe(200);
    const manifest = (await latest.json()) as Manifest;
    expect(manifest.snapshot_version).toBe(snapshot_version);
  });

  it('candidate account lands in snapshot with matching sha256 and stable ordering', async () => {
    const installs = [
      'tttttttt-2001-4001-8000-tttttttttttt',
      'tttttttt-2002-4002-8000-tttttttttttt',
      'tttttttt-2003-4003-8000-tttttttttttt',
    ];
    for (const id of installs) await report(id, 'cand_user');
    await report('tttttttt-2004-4004-8000-tttttttttttt', 'cand_user', {
      evidence_post_id: '18000000000000000',
    });

    await publish(ADMIN);
    const fileRes = await worker.fetch(
      new Request(
        `${ORIGIN}/v1/snapshots/${((
          (await (
            await worker.fetch(new Request(`${ORIGIN}/v1/snapshots/latest`), env)
          ).json()) as Manifest
        ).snapshot_version)}/${SNAPSHOT_PACK}`,
      ),
      env,
    );
    expect(fileRes.status).toBe(200);
    const bodyText = await fileRes.text();
    const body = JSON.parse(bodyText) as {
      entries: {
        handle: string;
        status: string;
        community_score: number;
        report_count: number;
        evidence_post_ids: string[];
      }[];
    };

    expect(body.entries).toHaveLength(1);
    const entry = body.entries[0];
    expect(entry.handle).toBe('cand_user');
    expect(entry.status).toBe('candidate');
    expect(entry.report_count).toBe(4);
    // 4 票同日：4/7 = 0.571 → 0.57（未达爆发线，不打折）
    expect(entry.community_score).toBe(0.57);
    expect(entry.evidence_post_ids).toEqual(['18000000000000000']);

    const latest = (await (
      await worker.fetch(new Request(`${ORIGIN}/v1/snapshots/latest`), env)
    ).json()) as Manifest;
    expect(await sha256HexOf(bodyText)).toBe(latest.files[0].sha256);
    expect(fileRes.headers.get('cache-control')).toContain('immutable');
  });

  it('republishing the same day increments the version counter', async () => {
    const first = (await (await publish(ADMIN)).json()) as Manifest;
    const second = (await (await publish(ADMIN)).json()) as Manifest;
    expect(second.snapshot_version).not.toBe(first.snapshot_version);
    expect(second.snapshot_version.startsWith(first.snapshot_version)).toBe(
      false,
    );
    const [, n1] = first.snapshot_version.split('.');
    const dayPart = first.snapshot_version.split('.').slice(0, 3).join('.');
    expect(second.snapshot_version.startsWith(dayPart)).toBe(true);
    expect(Number.parseInt(n1, 10)).toBeGreaterThan(0);
  });
});
