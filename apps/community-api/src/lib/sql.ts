import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

/** LIKE / ILIKE 通配符转义（\ % _），PostgreSQL 默认就以反斜杠为转义符。顺带去掉 PG 不接受的 U+0000。 */
export function escapeLike(value: string): string {
  return stripNul(value).replace(/[\\%_]/g, '\\$&');
}

/** PostgreSQL 的 text 不接受 U+0000（SQLite 接受），写库前对客户端自由文本统一去掉。 */
export function stripNul(value: string): string {
  return value.replaceAll(String.fromCharCode(0), '');
}

/**
 * 字符串按 UTF-16 码元比较（不用 localeCompare）。批量 UPSERT / UPDATE … FROM (VALUES …) 前
 * 把行按主键排成固定顺序，并发请求锁行的顺序一致，避免 PG 死锁（40P01）。
 */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 按 C collation（字节序）比较/排序。生产库本身用 C collation 建库，这里再显式声明，
 * 保证 handle 排序、游标比较、min() 等结果不随库的默认 collation 变化。
 */
export function collateC(column: SQLWrapper): SQL {
  return sql`${column} collate "C"`;
}
