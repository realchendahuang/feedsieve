import { env } from 'cloudflare:workers';
import { sql } from 'drizzle-orm';
import { getDb } from '../src/db/client';

/**
 * 政策 v4 起，3 张同一天的拉黑票不够上榜（要横跨 ≥ 2 天、或 v2 加权共识达标、或净票 ≥ 5，
 * 见 src/lib/listing.ts）。测试里的票都是同一刻投的：把刚写入的这条举报，按 id 奇偶隔一条
 * 挪到前一天，模拟真实世界里陆续投票。
 */
export async function spreadLatestReport(): Promise<void> {
  await getDb(env).execute(sql`
    UPDATE reports SET created_at = created_at - 86400
    WHERE id = (SELECT max(id) FROM reports) AND id % 2 = 0`);
}
