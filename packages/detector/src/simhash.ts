/**
 * SimHash 模糊指纹（v0.5 Campaign 基础）。
 *
 * v0.4 的 cyrb53 是精确指纹：换一个词/插一个空格就失配，垃圾号换措辞即绕过。
 * SimHash 把归一化文本降到 64 bit 位向量：语义近似 -> 位向量近似，
 * 检测侧用「汉明距离 <= threshold」判「话术变体」（同模板的换词版）。
 *
 * 与 cyrb53 的关系：fingerprintText 接口不变（同步、返回 16 位 hex），
 * 实现换成 simhash 后，旧快照里的精确指纹与新的变体检测自然共存——
 * 精确集合命中走 exact（v0.4 行为），simhashes 集合走汉明距离（v0.5）。
 *
 * 隐私：同 cyrb53，输入是归一化文本，输出是单向位哈希，原文永不出设备。
 */
import {
  normalizeForFingerprint,
  MIN_FINGERPRINT_LENGTH,
} from './fingerprint';

/** 汉明距离阈值：<= 此距离视为同一话术的变体。2 容忍「换词/插词/删词」的常见单点编辑。 */
export const SIMHASH_HAMMING_THRESHOLD = 2;

/** 词权重上限：高频词（的/了/是…）不稀释长词的判别力 */
const MAX_TOKEN_WEIGHT = 8;

/** 与 normalizeForFingerprint 同域：小写 -> URL/@占位 -> 剥符号，按空白切词 */
export function simhashTokens(text: string): string[] {
  const normalized = normalizeForFingerprint(text);
  if (normalized.length < MIN_FINGERPRINT_LENGTH) {
    return [];
  }
  // 归一化的输出只剩字母数字与占位词，按 2-4 字符的 n-gram 切分：
  // n-gram 对词序敏感（"giveaway free" vs "free giveaway" 特征不同），
  // 同时容忍单字词/插词（精确词切分做不到）
  const grams: string[] = [];
  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i <= normalized.length - n; i++) {
      grams.push(normalized.slice(i, i + n));
    }
  }
  return grams;
}

/**
 * 归一化文本 -> 64 bit 位向量（无符号 BigInt，低 64 位）。
 * 每个 n-gram 特征按词频加权投票：常见词权重低，长特征/罕见词权重高。
 */
export function textToSimhash(text: string): bigint | null {
  const tokens = simhashTokens(text);
  if (tokens.length === 0) {
    return null;
  }
  const counts = new Map<string, number>();
  for (const t of tokens) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const weights: Array<{ hash: bigint; weight: number }> = [];
  for (const [token, count] of counts) {
    const w = Math.min(count, MAX_TOKEN_WEIGHT);
    if (w <= 0) {
      continue;
    }
    // 用 token 本身的 64 bit 哈希做位置特征；哈希分布均匀即可，无需密码学强度
    let h = 0x35b5e5a7n;
    for (let i = 0; i < token.length; i++) {
      h ^= BigInt(token.charCodeAt(i)) * 0x100000001b3n;
      h = (h >> 8n) | (h << 56n);
    }
    weights.push({ hash: h & 0xffffffffffffffffn, weight: w });
  }
  const bits = new Array<number>(64).fill(0);
  for (const { hash, weight } of weights) {
    for (let b = 0; b < 64; b++) {
      if ((hash >> BigInt(b)) & 1n) {
        bits[b] = (bits[b] ?? 0) + weight;
      } else {
        bits[b] = (bits[b] ?? 0) - weight;
      }
    }
  }
  let result = 0n;
  for (let b = 63; b >= 0; b--) {
    result = (result << 1n) | ((bits[b] ?? 0) > 0 ? 1n : 0n);
  }
  return result;
}

/** 汉明距离：两个 64 bit 位向量不同的位数。 */
export function hammingDistance(a: bigint, b: bigint): number {
  let diff = a ^ b;
  let count = 0;
  while (diff !== 0n) {
    diff &= diff - 1n; // 清除最低置位
    count++;
  }
  return count;
}

/** 位向量 -> 16 位 hex（与 fingerprintText 的输出形状一致，可存快照）。 */
export function simhashToHex(value: bigint): string {
  return value.toString(16).padStart(16, '0');
}

/** 16 位 hex -> 位向量；非法输入返回 null。 */
export function simhashFromHex(value: string): bigint | null {
  if (!/^[0-9a-f]{16}$/i.test(value)) {
    return null;
  }
  return BigInt(`0x${value}`);
}
