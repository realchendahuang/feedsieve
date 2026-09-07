export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// 服务器加盐哈希：原始 installation UUID 绝不落库（OPEN_SOURCE_GOVERNANCE.md §5）
// salt 缺配时 `${salt}:${id}` 里的 salt 是 undefined，哈希退化为确定性的
// "undefined:<id>"（等价无盐，DB 泄露可离线穷举）——必须 fail closed，不能静默退化。
export async function hashInstallationId(
  salt: string,
  installationId: string,
): Promise<string> {
  if (typeof salt !== 'string' || salt.length < 16) {
    throw new Error('installation_salt_missing');
  }
  return sha256Hex(`${salt}:${installationId}`);
}
