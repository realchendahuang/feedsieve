/**
 * 测试前在 Node 里准备测试库：不存在就建库，然后跑 drizzle/ 下的全部迁移。
 * 需要本地 PostgreSQL：仓库根目录 `docker compose up -d postgres`。
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { testDatabaseUrl } from './database-url';

export default async function setup(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`invalid test database name: ${name}`);

  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  try {
    // 生产库用 C collation 建库，测试库同样用 C（PG17 builtin 提供者的 C，字节序）。
    // 已存在但不是这个 locale 的测试库（旧版 en_US 建的）drop 后重建。
    const [existing] = await admin<{ prov: string; loc: string | null }[]>`
      select datlocprovider as prov, datlocale as loc from pg_database where datname = ${name}`;
    if (existing && !(existing.prov === 'b' && existing.loc === 'C')) {
      await admin.unsafe(`drop database "${name}" with (force)`);
    }
    if (!existing || !(existing.prov === 'b' && existing.loc === 'C')) {
      await admin.unsafe(
        `create database "${name}" template template0 locale_provider builtin builtin_locale 'C'`,
      );
    }
  } catch (error) {
    throw new Error(
      `连不上测试数据库，先在仓库根目录跑 docker compose up -d postgres（${String(error)}）`,
      { cause: error },
    );
  } finally {
    await admin.end();
  }

  const client = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: './drizzle' });
  } finally {
    await client.end();
  }
}
