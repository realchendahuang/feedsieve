export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// 服务器加盐哈希：原始 installation UUID 绝不落库（OPEN_SOURCE_GOVERNANCE.md §5）
// salt 缺配时 `${salt}:${id}` 里的 salt 是 undefined，哈希退化为确定性的
// "undefined:<id>"（等价无盐，DB 泄露可离线穷举）——必须 fail closed，不能静默退化。
/**
 * 盐只要「配了」就能用：缺失、空串、被拼成字符串 "undefined" 时 fail closed。
 *
 * 2026-09-08 曾加过「至少 16 位」的检查，但线上一直在用的盐不到 16 位，检查一上线，
 * 所有用安装哈希的接口（名单上传、抢救、反馈样本、贡献统计）都返回 500，持续到 2026-10-30。
 * 换盐会让 3738 个历史安装的哈希全部对不上（撤票失效、可能重复计票），所以沿用旧盐、放宽检查。
 * 新部署仍建议用 ≥ 32 位随机盐。
 */
export function isUsableSalt(salt: unknown): salt is string {
  return typeof salt === 'string' && salt.trim().length > 0 && salt !== 'undefined';
}

export async function hashInstallationId(salt: string, installationId: string): Promise<string> {
  if (!isUsableSalt(salt)) {
    throw new Error('installation_salt_missing');
  }
  return sha256Hex(`${salt}:${installationId}`);
}

// IP 哈希：独立域前缀（与安装哈希不交叉），同样的 fail-closed 盐检查。
// 原始 IP 绝不落库（0001 隐私红线）。
export async function hashIp(salt: string, ip: string): Promise<string> {
  if (!isUsableSalt(salt)) {
    throw new Error('installation_salt_missing');
  }
  return sha256Hex(`ip:${salt}:${ip}`);
}
