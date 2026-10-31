import { sha256Hex } from './hash';

/** 6 位数字验证码：crypto 随机，前导零保留。 */
export function generateEmailCode(): string {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return String((buffer[0] ?? 0) % 1_000_000).padStart(6, '0');
}

/** 验证码哈希：域分离（email-code:）+ 盐 + 邮箱哈希绑定，库里不存明文码。 */
export function emailCodeHash(salt: string, emailHash: string, code: string): Promise<string> {
  return sha256Hex(`email-code:${salt}:${emailHash}:${code}`);
}
