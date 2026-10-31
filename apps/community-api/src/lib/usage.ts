import { sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { trainingSampleUsage } from '../db/schema';

/**
 * 按顺序扣 training_sample_usage 里的多项日限额，一条语句一次往返。
 * 每一项是 CTE 里的一个条件 UPSERT，后一项只在前一项成功（EXISTS）时才执行：
 * 第一项超限则后面的计数都不变，第一项通过而后一项超限则前一项已扣的不回滚，
 * 与逐项依次执行（失败即停）一致。多行 ON CONFLICT … WHERE 是逐行判断的，
 * 不能把几项合成一条多行 UPSERT。全部扣成功返回 true。
 */
export async function chargeUsageInOrder(
  db: DbOrTx,
  day: string,
  units: number,
  limits: ReadonlyArray<readonly [identity: string, limit: number]>,
): Promise<boolean> {
  const usage = trainingSampleUsage;
  const steps = limits.map(([identity, limit], i) => {
    const gate = i === 0 ? sql`` : sql`WHERE EXISTS (SELECT 1 FROM ${sql.identifier(`c${i - 1}`)})`;
    return sql`
      INSERT INTO ${usage} (identity, day, count)
      SELECT ${identity}::text, ${day}::text, ${units}::int
      ${gate}
      ON CONFLICT (identity, day) DO UPDATE SET count = ${usage.count} + excluded.count
      WHERE ${usage.count} + excluded.count <= ${limit}::int
      RETURNING 1 AS ok`;
  });
  const last = steps[steps.length - 1]!;
  const ctes = steps.slice(0, -1).map((step, i) => sql`${sql.identifier(`c${i}`)} AS (${step})`);
  const statement = ctes.length ? sql`WITH ${sql.join(ctes, sql`, `)} ${last}` : last;
  const rows = await db.execute(statement);
  return rows.length > 0;
}
