import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { hashInstallationId } from '../src/lib/hash';
import { getLeaderboard, markLeaderboardDirty, settleDueSeasons } from '../src/leaderboard';

const ORIGIN = 'https://api.example.com';

async function report(installationId: string, handle: string) {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/v1/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        reports: [{ handle, reason: 'adult_gray_traffic' }],
      }),
    }),
    env,
  );
  expect(res.status).toBe(200);
}

/** 一批上报（单请求 ≤50 条），用于凑满称号门槛的开火数 */
async function reportBatch(installationId: string, handles: string[]) {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/v1/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        reports: handles.map((handle) => ({ handle, reason: 'adult_gray_traffic' })),
      }),
    }),
    env,
  );
  expect(res.status).toBe(200);
}

async function rescue(installationId: string, handle: string) {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/v1/rescues`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        rescues: [{ handle }],
      }),
    }),
    env,
  );
  expect(res.status).toBe(200);
}

interface LeaderboardResponse {
  season: { id: number; starts_at: number; ends_at: number };
  rows: {
    id: string;
    name: string;
    rank: number;
    kills: number;
    first_bloods: number;
    false_positives: number;
    shots: number;
    score: number;
    accuracy: number;
  }[];
  me: (Record<string, unknown> & { rank: number }) | null;
  last_season: { id: number; champions: { name: string }[] } | null;
}

async function leaderboard(body: Record<string, unknown> = {}): Promise<LeaderboardResponse> {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/v1/leaderboard`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as LeaderboardResponse;
}

/** 重算节流（防滥用）会让脏标记最多陈旧 5 分钟；需要立即可见新票的用例先老化节流键 */
async function expireRecomputeThrottle(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO meta (key, value) VALUES ('leaderboard_last_recompute_at', ?1)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
    .bind(String(Math.floor(Date.now() / 1000) - 600))
    .run();
}

describe('打野排位赛 /v1/leaderboard', () => {
  it('三票确认击杀：击杀 +1、首杀 +1，匿名猎手名 = 哈希前缀', async () => {
    await report('hunter-a-0001-ffffff', 'wild_1');
    await report('hunter-b-0002-ffffff', 'wild_1');
    await report('hunter-c-0003-ffffff', 'wild_1');

    const data = await leaderboard();
    // 赛季行由读取侧惰性创建，窗口为当前 ISO 周
    expect(data.season.id).toBeGreaterThan(202500);
    expect(data.rows).toHaveLength(3);

    const hashA = await hashInstallationId(env.INSTALLATION_SALT, 'hunter-a-0001-ffffff');
    const rowA = data.rows.find((row) => row.id === hashA.slice(0, 12));
    expect(rowA).toBeDefined();
    // A 是首个上报者：击杀 + 首杀
    expect(rowA!.kills).toBe(1);
    expect(rowA!.first_bloods).toBe(1);
    expect(rowA!.score).toBe(2);
    expect(rowA!.accuracy).toBe(1);
    expect(rowA!.name).toBe(`猎手#${hashA.slice(0, 6).toUpperCase()}`);
    expect(rowA!.rank).toBe(1);
  });

  it('翻案（误标票反超）：击杀清零、原票转为误伤扣分', async () => {
    await expireRecomputeThrottle();
    await report('fp-a-0001-ffffff', 'fp_1');
    await report('fp-b-0002-ffffff', 'fp_1');
    await report('fp-c-0003-ffffff', 'fp_1');

    const before = await leaderboard();
    const hashA = await hashInstallationId(env.INSTALLATION_SALT, 'fp-a-0001-ffffff');
    expect(before.rows.find((row) => row.id === hashA.slice(0, 12))!.kills).toBe(1);

    // 三个安装都改判抢救 → rescue_count 反超，账号跌出 strong
    await expireRecomputeThrottle();
    await rescue('fp-a-0001-ffffff', 'fp_1');
    await rescue('fp-b-0002-ffffff', 'fp_1');
    await rescue('fp-c-0003-ffffff', 'fp_1');

    const after = await leaderboard();
    const rowA = after.rows.find((row) => row.id === hashA.slice(0, 12))!;
    expect(rowA.kills).toBe(0);
    expect(rowA.first_bloods).toBe(0);
    expect(rowA.false_positives).toBe(1);
    expect(rowA.score).toBe(-2);
  });

  it('推荐白名单一票否决：命中白名单的票按误伤计', async () => {
    await expireRecomputeThrottle();
    await report('wl-a-0001-ffffff', 'wl_1');
    await report('wl-b-0002-ffffff', 'wl_1');
    await report('wl-c-0003-ffffff', 'wl_1');
    const hashA = await hashInstallationId(env.INSTALLATION_SALT, 'wl-a-0001-ffffff');

    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      'INSERT INTO maintainer_whitelist (handle, note, active, created_at, updated_at) VALUES (?1, ?2, 1, ?3, ?3)',
    )
      .bind('wl_1', '误标复核：正常账号', now)
      .run();

    const data = await leaderboard();
    const rowA = data.rows.find((row) => row.id === hashA.slice(0, 12))!;
    expect(rowA.kills).toBe(0);
    expect(rowA.false_positives).toBe(1);
    expect(rowA.score).toBe(-2);
  });

  it('me 定位：installation_id 换算哈希前缀，返回自己的排名行', async () => {
    await expireRecomputeThrottle();
    await report('me-a-0001-ffffff', 'me_1');
    await report('me-b-0002-ffffff', 'me_1');
    await report('me-c-0003-ffffff', 'me_1');

    const byRaw = await leaderboard({ installation_id: 'me-b-0002-ffffff' });
    expect(byRaw.me).not.toBeNull();
    const hashB = await hashInstallationId(env.INSTALLATION_SALT, 'me-b-0002-ffffff');
    expect(byRaw.me!.rank).toBeGreaterThan(1);

    // URL 前缀与 raw 等价：榜单页用 ?me= 传哈希前缀
    const byPrefix = await leaderboard({ me: hashB.slice(0, 12) });
    expect(byPrefix.me!.rank).toBe(byRaw.me!.rank);

    // 未开火的安装：me 为空（rank null 语义 → null）
    const nobody = await leaderboard({ installation_id: 'me-none-9999-ffffff' });
    expect(nobody.me).toBeNull();
  });

  it('榜单只收开过火的猎手；公开响应不含安装原始数据', async () => {
    await report('iso-a-0001-ffffff', 'iso_1');
    const data = await leaderboard();
    expect(data.rows.every((row) => row.shots > 0)).toBe(true);
    expect(data.rows.every((row) => 'bio' in row || 'title' in row)).toBe(true);
    // 响应行字段白名单化：无 email_hash / installation 原始字段
    expect(JSON.stringify(data.rows)).not.toContain('email_hash');
  });

  it('跨周结算：Top3 且命中率达标拿永久称号', async () => {
    // 先触发赛季行创建（每用例独立存储）
    await leaderboard();
    // 三个安装各开 10 火（命中率 100%，满足 shots >= 10 门槛）
    const handles = Array.from({ length: 10 }, (_, index) => `champ_${index}`);
    await reportBatch('champ-a-0001-ffffff', handles);
    await reportBatch('champ-b-0002-ffffff', handles);
    await reportBatch('champ-c-0003-ffffff', handles);

    // 把当前赛季推成「已到期」，直接驱动 cron 结算
    await env.DB.prepare('UPDATE seasons SET ends_at = 1 WHERE settled_at IS NULL').run();
    const settled = await settleDueSeasons(env);
    expect(settled).toBeGreaterThanOrEqual(1);

    const seasonRow = await env.DB.prepare(
      'SELECT settled_at, top_json FROM seasons ORDER BY starts_at DESC LIMIT 1',
    ).first<{ settled_at: number | null; top_json: string | null }>();
    expect(seasonRow!.settled_at).not.toBeNull();
    const top = JSON.parse(seasonRow!.top_json!) as { champions: { name: string; kills: number }[] };
    expect(top.champions).toHaveLength(3);
    expect(top.champions.every((champion) => champion.kills === 10)).toBe(true);

    // 称号永久落在猎手档案上
    for (const installationId of ['champ-a-0001-ffffff', 'champ-b-0002-ffffff', 'champ-c-0003-ffffff']) {
      const hash = await hashInstallationId(env.INSTALLATION_SALT, installationId);
      const row = await env.DB.prepare('SELECT title FROM installations WHERE id = ?1')
        .bind(hash)
        .first<{ title: string | null }>();
      expect(row!.title).toBe('猎黄人');
    }
  });
});

describe('榜单重算节流（防公开端点驱动重算滥用）', () => {
  it('节流窗口内脏标记不触发全量重算；窗口过后恢复', async () => {
    // 首次读取：冷启动必须聚合并写缓存
    const first = await getLeaderboard(env);
    expect(first.rows.length).toBeGreaterThanOrEqual(0);

    // 制造票面变更 + 脏标记
    await report('throttle-aaaa-4000-8000-aaaaaaaaaaa1', 'throttle_user');
    await markLeaderboardDirty(env);
    const second = await getLeaderboard(env);
    // 节流窗口内：直接回陈旧缓存，未重算
    expect(second.computed_at).toBe(first.computed_at);
    expect(second.rows.find((row) => row.id.includes('throttle'))).toBeUndefined();

    // 把上次重算时间拨回窗口之外 → 恢复重算
    const past = Math.floor(Date.now() / 1000) - 600;
    await env.DB.prepare(
      `INSERT INTO meta (key, value) VALUES ('leaderboard_last_recompute_at', ?1)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
      .bind(String(past))
      .run();
    const third = await getLeaderboard(env);
    expect(third.computed_at).toBeGreaterThanOrEqual(first.computed_at);
    // 节流期间被压住的票面变更（throttle_user）此刻计入榜单行数
    expect(third.rows.length).toBeGreaterThan(first.rows.length);
  });
});
