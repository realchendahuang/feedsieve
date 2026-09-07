/**
 * 词库 manifest 签名消息构造（仓库构建脚本专用）。
 *
 * 与 packages/community-lists/src/signing.ts 的 buildSigningMessage 必须逐字节一致；
 * signing.test.ts 有跨实现一致性测试钉死这一点——改任何一侧的参数顺序、字段或
 * join 语义都必须同步另一侧并跑测试，否则本地签名的词库包会在客户端验签失败。
 */

/**
 * @param {string} packVersion 版本字段（YYYY.MM.DD.N）
 * @param {string | null} generatedAt 生成时间；null 时按 buildSigningMessage 的
 *   join 语义序列化成空串（与 Worker 侧签名行为一致）
 * @param {string} sha256 内容文件 SHA-256
 * @param {number} rules 规则数（files[].count 语义）
 * @returns {string}
 */
export function buildKeywordPackManifestMessage(packVersion, generatedAt, sha256, rules) {
  return [
    'feedsieve-manifest-v1',
    '1',
    packVersion,
    generatedAt,
    'official.json',
    sha256,
    String(rules),
  ].join('\n');
}