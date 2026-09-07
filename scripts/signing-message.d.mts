/**
 * scripts/signing-message.mjs 的类型声明（TS 对 .mjs 的相邻声明约定 .d.mts）。
 * 一致性由 signing.test.ts 钉死：任何改动必须两侧同步。
 */
export function buildKeywordPackManifestMessage(
  packVersion: string,
  generatedAt: string | null,
  sha256: string,
  rules: number,
): string;