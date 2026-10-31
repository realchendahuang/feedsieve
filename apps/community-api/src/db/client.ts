/**
 * 数据库连接：PostgreSQL 经 Hyperdrive 接入。
 *
 * Workers 不允许一个请求复用另一个请求建立的连接，连接池由 Hyperdrive 负责。所以每次调用
 * （fetch / scheduled）在入口用 `withDb` 开一个作用域，作用域里第一次 `getDb(env)` 时才建客户端，
 * 作用域结束时关闭。业务代码只管 `getDb(env)`，不传连接。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;
/** 事务里拿到的句柄，和 Db 用法一样 */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

interface Scope {
  db?: Db;
  client?: postgres.Sql;
}

const scope = new AsyncLocalStorage<Scope>();

function connect(env: Cloudflare.Env): { db: Db; client: postgres.Sql } {
  const client = postgres(env.HYPERDRIVE.connectionString, {
    // 一个请求里会并发几条查询（Promise.all），留一点余量
    max: 5,
    // 省掉连接时查询自定义类型的那次往返
    fetch_types: false,
    prepare: true,
    connect_timeout: 10,
    types: {
      // count(*) / sum() 返回 int8 / numeric，按 JS number 读（数值都远小于 2^53）
      int8: {
        to: 20,
        from: [20],
        serialize: (x: number) => String(x),
        parse: (x: string) => Number(x),
      },
      numeric: {
        to: 1700,
        from: [1700],
        serialize: (x: number) => String(x),
        parse: (x: string) => Number(x),
      },
    },
  });
  return { db: drizzle(client, { schema }), client };
}

/** 当前作用域的数据库句柄（第一次调用时连接） */
export function getDb(env: Cloudflare.Env): Db {
  let current = scope.getStore();
  if (!current) {
    // 所有入口都包了 withDb；漏包会让多个请求共用一个连接，所以作用域外只允许测试（FEEDSIEVE_TEST=1）
    if (env.FEEDSIEVE_TEST !== '1') throw new Error('getDb() called outside withDb()');
    current = looseScope();
  }
  if (!current.db) Object.assign(current, connect(env));
  return current.db!;
}

/**
 * 开一个数据库作用域执行 fn，结束后关闭连接。嵌套调用复用外层作用域。
 * 有 waitUntil（fetch / scheduled）时关闭放到响应之后，不拖慢响应。
 */
export async function withDb<T>(
  fn: () => Promise<T>,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<T> {
  if (scope.getStore()) return fn();
  const current: Scope = {};
  try {
    return await scope.run(current, fn);
  } finally {
    const client = current.client;
    current.db = undefined;
    current.client = undefined;
    if (client) {
      const closing = client.end({ timeout: 5 }).catch(() => {});
      if (waitUntil) waitUntil(closing);
      else await closing;
    }
  }
}

/**
 * 作用域之外的调用（只有测试会这样：直接调业务函数，不经过入口）共用一个模块级客户端，
 * 由测试的 setup 在每个测试结束后调用 closeLooseDb 关闭。
 */
let loose: Scope | null = null;
function looseScope(): Scope {
  loose ??= {};
  return loose;
}

export async function closeLooseDb(): Promise<void> {
  const current = loose;
  loose = null;
  await current?.client?.end({ timeout: 5 }).catch(() => {});
}

/** 驱动错误的 SQLSTATE：Drizzle 把它包在 DrizzleQueryError.cause 里 */
function sqlState(error: unknown): string | undefined {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  const code = (cause as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * 并发写同一批行时 PG 可能判死锁（40P01）或序列化失败（40001），重试一次通常就能过。
 * fn 必须是幂等的整段写入（事务内抛错会整体回滚）。
 */
export async function retryOnConflict<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const code = sqlState(error);
    if (code !== '40P01' && code !== '40001') throw error;
    return fn();
  }
}

/**
 * 日志用的数据库错误描述。DrizzleQueryError.message 含完整 SQL 和全部绑定参数（邮箱、handle、
 * 正文等），不能直接打印；这里只取驱动错误的 name / code / constraint_name / message。
 */
export function describeDbError(error: unknown): string {
  if (!(error instanceof DrizzleQueryError))
    return error instanceof Error ? error.message : String(error);
  const cause = error.cause as
    { name?: string; code?: string; constraint_name?: string; message?: string } | undefined;
  if (!cause) return 'DrizzleQueryError';
  return [cause.name, cause.code, cause.constraint_name, cause.message].filter(Boolean).join(' ');
}
