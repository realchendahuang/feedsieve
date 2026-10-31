import { describeDbError } from '../db/client';

/**
 * 客户端可回显的错误 code 收口：域内错误一律以 snake_case code 抛出并直接
 * 回显；其余（Drizzle/R2/nodemailer 等底层错误）消息可能内嵌绑定值（邮箱等敏感
 * 数据，同 onError 的口径），只回 fallback code，全量错误留服务端日志。
 */
export function publicErrorCode(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  if (/^[a-z0-9_]+$/.test(message)) return message;
  console.error(`[community-api] ${fallback}: ${describeDbError(error)}`);
  return fallback;
}
