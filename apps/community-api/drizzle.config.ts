import { defineConfig } from 'drizzle-kit';

// 迁移生成在 drizzle/，线上用 `pnpm db:migrate`（DATABASE_URL 指向目标库）执行。
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgres://feedsieve:feedsieve_dev_password@127.0.0.1:54330/feedsieve',
  },
  strict: true,
  verbose: true,
});
