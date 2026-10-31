/** UTC 日界（YYYY-MM-DD）：每日配额/配额日字段统一用这个日界。 */
export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Unix 秒时间戳：DB 时间字段统一存秒。 */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
