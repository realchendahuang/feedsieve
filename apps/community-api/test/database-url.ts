/**
 * 测试库地址。默认是本地 docker-compose 的 feedsieve_test 库；
 * 同时跑多套测试时用 FEEDSIEVE_TEST_DB 指定不同的库名，避免互相清表。
 */
export function testDatabaseUrl(): string {
  if (process.env.FEEDSIEVE_TEST_DATABASE_URL) return process.env.FEEDSIEVE_TEST_DATABASE_URL;
  const name = process.env.FEEDSIEVE_TEST_DB ?? 'feedsieve_test';
  return `postgres://feedsieve:feedsieve_dev_password@127.0.0.1:54330/${name}`;
}
