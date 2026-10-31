/**
 * 每个测试文件开始前清空所有业务表（和 D1 时代按测试文件隔离存储的语义一致：同一文件里的用例
 * 共享数据，文件之间互不影响）；每个测试后关闭测试代码直接调用业务函数时建立的连接。
 * 清表前校验库名（含 test 或以 g_ 开头），防止 FEEDSIEVE_TEST_DATABASE_URL 指到真实库。
 */
import { env } from 'cloudflare:workers';
import { sql } from 'drizzle-orm';
import { afterEach, beforeAll } from 'vitest';
import { closeLooseDb, getDb } from '../src/db/client';

beforeAll(async () => {
  const db = getDb(env);
  const [current] = await db.execute<{ name: string }>(sql`select current_database() as name`);
  const name = current?.name ?? '';
  if (!name.includes('test') && !name.startsWith('g_')) {
    throw new Error(`拒绝清空非测试库：${name}（库名需包含 test 或以 g_ 开头）`);
  }
  const rows = await db.execute<{ name: string }>(
    sql`select quote_ident(tablename) as name from pg_tables where schemaname = 'public'`,
  );
  await db.execute(
    sql.raw(`truncate table ${rows.map((r) => r.name).join(', ')} restart identity cascade`),
  );
  await closeLooseDb();
});

afterEach(async () => {
  await closeLooseDb();
});
