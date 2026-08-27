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
export function hashInstallationId(
  salt: string,
  installationId: string,
): Promise<string> {
  return sha256Hex(`${salt}:${installationId}`);
}
