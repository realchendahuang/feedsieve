#!/usr/bin/env node
/**
 * 一次性搬运：把 D1 导出的 SQLite 库导入 PostgreSQL（目标库须已跑完 drizzle/ 迁移且为空）。
 *
 *   wrangler d1 export feedsieve-community --remote --output d1.sql
 *   sqlite3 d1.sqlite < d1.sql
 *   DATABASE_URL=postgres://… node scripts/import-d1-export.mjs d1.sqlite
 *
 * 只搬 PG 里存在的表和列（旧的 d1_migrations、seasons 不搬）；文本里的 U+0000 去掉（PG 不接受）。
 * 全部在一个事务里：任何一行写不进去就整体回滚。写完逐表核对行数，再把自增序列推到 max(id)。
 */
import { DatabaseSync } from 'node:sqlite';
import postgres from 'postgres';

const [file] = process.argv.slice(2);
if (!file || !process.env.DATABASE_URL) {
  console.error('usage: DATABASE_URL=… node scripts/import-d1-export.mjs <d1.sqlite>');
  process.exit(1);
}

// 有外键的表排在被引用的表之后
const ORDER_FIRST = ['admin_keyword_packs', 'training_samples'];
const BATCH = 1000;

const lite = new DatabaseSync(file, { readOnly: true });
const pg = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

const pgColumns = new Map();
for (const row of await pg`
  select table_name, column_name, data_type
  from information_schema.columns
  where table_schema = 'public'
  order by table_name, ordinal_position`) {
  if (!pgColumns.has(row.table_name)) pgColumns.set(row.table_name, new Map());
  pgColumns.get(row.table_name).set(row.column_name, row.data_type);
}

const liteTables = lite
  .prepare(
    "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '_cf_%'",
  )
  .all()
  .map((r) => r.name);
const skipped = liteTables.filter((t) => !pgColumns.has(t));
const tables = liteTables
  .filter((t) => pgColumns.has(t))
  .sort(
    (a, b) =>
      (ORDER_FIRST.includes(b) ? 1 : 0) - (ORDER_FIRST.includes(a) ? 1 : 0) ||
      (a < b ? -1 : a > b ? 1 : 0),
  );
const missingInD1 = [...pgColumns.keys()].filter((t) => !liteTables.includes(t));

function convert(value, type) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string')
    return value.includes('\u0000') ? value.replaceAll('\u0000', '') : value;
  if (typeof value === 'bigint') return Number(value);
  if (
    typeof value === 'number' &&
    (type === 'bigint' || type === 'integer') &&
    !Number.isInteger(value)
  ) {
    throw new Error(`non-integer ${value} for ${type} column`);
  }
  if (value instanceof Uint8Array) throw new Error('unexpected blob value');
  return value;
}

const counts = [];
await pg.begin(async (tx) => {
  for (const table of tables) {
    const columns = [...pgColumns.get(table).keys()];
    const liteCols = new Set(
      lite
        .prepare(`pragma table_info("${table}")`)
        .all()
        .map((c) => c.name),
    );
    const shared = columns.filter((c) => liteCols.has(c));
    const types = pgColumns.get(table);
    const rows = lite
      .prepare(`select ${shared.map((c) => `"${c}"`).join(', ')} from "${table}"`)
      .all();
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH).map((row) => {
        const out = {};
        for (const c of shared) {
          try {
            out[c] = convert(row[c], types.get(c));
          } catch (error) {
            throw new Error(`${table}.${c}: ${error.message}`, { cause: error });
          }
        }
        return out;
      });
      await tx`insert into ${tx(table)} ${tx(chunk, shared)}`;
    }
    const [{ n }] = await tx`select count(*)::int as n from ${tx(table)}`;
    counts.push({ table, d1: rows.length, pg: n });
    if (n !== rows.length)
      throw new Error(`row count mismatch on ${table}: d1=${rows.length} pg=${n}`);
  }
  // identity 列推到 max(id)，之后的插入不会撞主键
  for (const { table_name, column_name } of await tx`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' and is_identity = 'YES'`) {
    await tx.unsafe(
      `select setval(pg_get_serial_sequence('"${table_name}"', '${column_name}'),
                     coalesce((select max("${column_name}") from "${table_name}"), 1),
                     (select max("${column_name}") from "${table_name}") is not null)`,
    );
  }
});

console.table(counts);
if (skipped.length) console.log('not imported (no such table in PostgreSQL):', skipped.join(', '));
if (missingInD1.length)
  console.log('PostgreSQL tables with no D1 source (left empty):', missingInD1.join(', '));
await pg.end();
lite.close();
