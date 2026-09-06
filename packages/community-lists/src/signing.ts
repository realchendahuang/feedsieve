/**
 * Manifest 发布者签名（Ed25519，v1）。
 *
 * 校验链：manifest（含签名）→ 用内置公钥验签 → 与已存版本比较（防回滚）→
 * 下载文件 → SHA-256 → schema 校验 → 整体写入 last-known-good。
 *
 * 签名覆盖版本、生成时间与全部文件清单（path/sha256/count），
 * 篡改其中任何一个字段都会验签失败 —— 即使攻击者同时替换 manifest 与内容文件。
 * 所有实现（浏览器扩展校验 / Worker 签名 / Node 脚本）共用本模块，
 * 保证签名消息字节完全一致。
 */

/** 64 字节 Ed25519 签名 = base64 88 字符（含 padding），见 validate.ts 的正则 */
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export interface ManifestSignature {
  key_id: string;
  alg: 'ed25519';
  /** base64：Ed25519 原始 64 字节签名 */
  sig: string;
}

export interface TrustedKey {
  key_id: string;
  /** base64：Ed25519 RAW 32 字节公钥 */
  publicKeyBase64: string;
}

export interface SigningMessageInput {
  schemaVersion: number;
  /** 版本字段：快照用 snapshot_version，词库用 pack_version */
  version: string;
  generatedAt: string;
  files: Array<{ path: string; sha256: string; count: number }>;
}

/** 确定性签名消息：白名单字段按固定顺序写入，文件清单按 path 排序。 */
export function buildSigningMessage(input: SigningMessageInput): string {
  const files = [...input.files].sort((a, b) => a.path.localeCompare(b.path));
  const lines = [
    'feedsieve-manifest-v1',
    String(input.schemaVersion),
    input.version,
    input.generatedAt,
  ];
  for (const file of files) {
    lines.push(file.path, file.sha256, String(file.count));
  }
  return lines.join('\n');
}

export function isBase64(value: string): boolean {
  return BASE64_RE.test(value) && value.length % 4 === 0;
}

export function base64ToBytes(value: string): Uint8Array | null {
  if (!isBase64(value)) {
    return null;
  }
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export type SignatureVerifyResult =
  | { ok: true }
  | { ok: false; error: 'unknown_key' | 'signature_invalid' };

/** 用可信公钥表验证 manifest 签名。 */
export async function verifyManifestSignature(
  message: string,
  signature: ManifestSignature,
  trustedKeys: readonly TrustedKey[],
): Promise<SignatureVerifyResult> {
  if (signature.alg !== 'ed25519') {
    return { ok: false, error: 'unknown_key' };
  }
  const trusted = trustedKeys.find((key) => key.key_id === signature.key_id);
  if (!trusted) {
    return { ok: false, error: 'unknown_key' };
  }
  const sigBytes = base64ToBytes(signature.sig);
  const keyBytes = base64ToBytes(trusted.publicKeyBase64);
  if (!sigBytes || sigBytes.length !== 64 || !keyBytes || keyBytes.length !== 32) {
    return { ok: false, error: 'signature_invalid' };
  }
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      keyBytes as BufferSource,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      { name: 'Ed25519' },
      key,
      sigBytes as BufferSource,
      new TextEncoder().encode(message),
    );
    return valid ? { ok: true } : { ok: false, error: 'signature_invalid' };
  } catch {
    return { ok: false, error: 'signature_invalid' };
  }
}

/**
 * 用发布者私钥签名消息（Worker 侧自动签名）。
 * `privateKeyPkcs8Base64` 来自部署配置（PKCS8 DER 的 base64，见 scripts/keygen.mjs）。
 */
export async function signManifestMessage(
  message: string,
  privateKeyPkcs8Base64: string,
  keyId: string,
): Promise<ManifestSignature> {
  const der = base64ToBytes(privateKeyPkcs8Base64);
  if (!der) {
    throw new Error('invalid_private_key');
  }
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der as BufferSource,
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(message)),
  );
  return { key_id: keyId, alg: 'ed25519', sig: bytesToBase64(sig) };
}

const VERSION_PARTS_RE = /^(\d{4})\.(\d{2})\.(\d{2})\.(\d{1,4})$/;

/**
 * 版本元组比较：YYYY.MM.DD.N」。任何一侧格式非法都当作相等
 * （调用方已用 schema 校验拒绝非法版本，这里是防御性兜底）。
 */
export function compareManifestVersions(a: string, b: string): number {
  const pa = a.match(VERSION_PARTS_RE);
  const pb = b.match(VERSION_PARTS_RE);
  if (!pa || !pb) {
    return 0;
  }
  for (let i = 1; i <= 4; i++) {
    const diff = Number(pa[i]) - Number(pb[i]);
    if (diff !== 0) {
      return diff < 0 ? -1 : 1;
    }
  }
  return 0;
}