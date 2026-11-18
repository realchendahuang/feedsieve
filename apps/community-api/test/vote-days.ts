import { env } from 'cloudflare:workers';
import { sql } from 'drizzle-orm';
import { getDb } from '../src/db/client';

/**
 * 政策 v4 起，3 张同一天的拉黑票不够上榜（要横跨 ≥ 2 天、或 v2 加权共识达标、或净票 ≥ 5，
 * 见 src/lib/listing.ts）。测试里的票都是同一刻投的：把刚写入的这条举报，按 id 奇偶隔一条
 * 挪到 25 小时前（既必然落在不同 UTC 自然日，又避开 24 小时统计窗口的整秒跳变边界）。
 */
export async function spreadLatestReport(): Promise<void> {
  await getDb(env).execute(sql`
    UPDATE reports SET created_at = created_at - 90000
    WHERE id = (SELECT max(id) FROM reports) AND id % 2 = 0`);
}
