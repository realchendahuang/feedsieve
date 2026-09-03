import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { generateSnapshot, SNAPSHOT_PACK } from '../src/snapshot';

const ORIGIN = 'https://api.example.com';

const FP_A = 'aaaaaaaaaaaaaaaa';
const FP_C = 'cccccccccccccccc';

async function report(
  installationId: string,
  handle: string,
  extra: Record<string, unknown> = {},
): Promise<{ status: string; error?: string }> {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/v1/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        reports: [{ handle, reason: 'copy_paste', ...extra }],
      }),
    }),
    env,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    results: { status: string; error?: string }[];
  };
  return body.results[0];
}

/** 3 个独立安装上报同一 handle → 自动升 candidate，进快照 */
async function promoteToCandidate(
  handle: string,
  extra: Record<string, unknown> = {},
) {
  for (let i = 1; i <= 3; i++) {
    await report(`ev${i}-${handle}-install-0001-ffffff`, handle, extra);
  }
}

interface Entry {
  handle: string;
  fingerprints?: string[];
  domains?: string[];
}

async function publishAndGetEntry(handle: string): Promise<Entry | undefined> {
  await generateSnapshot(env);
  const latest = (await (
    await worker.fetch(new Request(`${ORIGIN}/v1/snapshots/latest`), env)
  ).json()) as { snapshot_version: string };
  const file = await worker.fetch(
    new Request(
      `${ORIGIN}/v1/snapshots/${latest.snapshot_version}/${SNAPSHOT_PACK}`,
    ),
    env,
  );
  const body = (await file.json()) as { entries: Entry[] };
  return body.entries.find((e) => e.handle === handle);
}

describe('report content evidence storage (v0.4)', () => {
  it('stores fingerprint and sanitized link domains', async () => {
    await report('st1-store-0000-4000-8000-000000000001', 'store_user', {
      content_fingerprint: FP_A,
      link_domains: [
        'OK.Example', // 小写归一
        'ok.example', // 去重
        'cdn.x.com', // 自家域名子域丢弃
        'not a domain!!', // 非法丢弃
        'sub.trusted.example', // 合法保留
      ],
    });
    const row = await env.DB.prepare(
      'SELECT content_fingerprint, link_domains FROM reports WHERE handle = ?1',
    )
      .bind('store_user')
      .first<{ content_fingerprint: string; link_domains: string }>();
    expect(row?.content_fingerprint).toBe(FP_A);
    expect(JSON.parse(row?.link_domains ?? '[]')).toEqual([
      'ok.example',
      'sub.trusted.example',
    ]);
  });

  it('rejects malformed fingerprint payloads without losing the vote', async () => {
    const badFp = await report(
      'st1-badfp-0000-4000-8000-000000000002',
      'bad_fp_user',
      { content_fingerprint: 'NOT-A-FP' },
    );
    expect(badFp.status).toBe('rejected');
    expect(badFp.error).toBe('invalid_content_fingerprint');

    const badDomains = await report(
      'st1-baddm-0000-4000-8000-000000000003',
      'bad_dm_user',
      { link_domains: 'scam.example' },
    );
    expect(badDomains.status).toBe('rejected');
    expect(badDomains.error).toBe('invalid_link_domains');

    const tooMany = await report(
      'st1-many-0000-4000-8000-000000000004',
      'many_dm_user',
      {
        link_domains: [
          'a.example',
          'b.example',
          'c.example',
          'd.example',
          'e.example',
          'f.example',
        ],
      },
    );
    expect(tooMany.status).toBe('rejected');
    expect(tooMany.error).toBe('invalid_link_domains');
  });

  it('accepts reports without evidence fields (older clients)', async () => {
    const result = await report(
      'st1-plain-0000-4000-8000-000000000005',
      'plain_user',
    );
    expect(result.status).toBe('recorded');
  });
});

describe('snapshot content evidence aggregation (v0.4)', () => {
  it('emits fingerprints/domains only at >= 2 independent installations', async () => {
    // fp_user：FP_A 有 3 个安装上报 → 下发；'scam.example' 有 2 个安装 → 下发；
    // 'lonely.example' 只有 1 个安装 → 不下发
    const installs = [
      'fp1aa-3001-4001-8000-300000000001',
      'fp2aa-3001-4001-8000-300000000002',
      'fp3aa-3001-4001-8000-300000000003',
    ];
    await report(installs[0], 'fp_user', {
      content_fingerprint: FP_A,
      link_domains: ['scam.example'],
    });
    await report(installs[1], 'fp_user', {
      content_fingerprint: FP_A,
      link_domains: ['scam.example'],
    });
    await report(installs[2], 'fp_user', {
      content_fingerprint: FP_A,
      link_domains: ['lonely.example'],
    });

    // mix_user：达标进快照，但指纹 FP_C 只有 1 票、无域名 → 两个字段都不携带
    await promoteToCandidate('mix_user');
    await report('mix1-aaab-4bbb-8bbb-400000000001', 'mix_user', {
      content_fingerprint: FP_C,
    });

    const fpEntry = await publishAndGetEntry('fp_user');
    expect(fpEntry?.fingerprints).toEqual([FP_A]);
    expect(fpEntry?.domains).toEqual(['scam.example']);

    const mixEntry = await publishAndGetEntry('mix_user');
    expect(mixEntry?.fingerprints).toBeUndefined();
    expect(mixEntry?.domains).toBeUndefined();
  });

  it('caps evidence at 5 per entry and keeps deterministic ordering', async () => {
    // 8 条指纹各 2 个独立安装上报（唯一索引一行 = 一票，同一安装重复上报不算）：
    // 并列最高，取字典序最小的 5 条
    const fps = Array.from({ length: 8 }, (_, i) => `f${i}${'0'.repeat(14)}`);
    for (let pair = 0; pair < fps.length; pair++) {
      const suffix = String(pair).padStart(2, '0');
      await report(`cap${pair}a-aaac-4ccc-8ccc-5000000000${suffix}`, 'cap_user', {
        content_fingerprint: fps[pair],
      });
      await report(`cap${pair}b-aaac-4ccc-8ccc-5000000000${suffix}`, 'cap_user', {
        content_fingerprint: fps[pair],
      });
    }
    const entry = await publishAndGetEntry('cap_user');
    expect(entry?.fingerprints).toHaveLength(5);
    expect(entry?.fingerprints).toEqual([...(entry?.fingerprints ?? [])].sort());
    expect(entry?.domains).toBeUndefined();
  });
});
