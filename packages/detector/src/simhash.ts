/**
 * SimHash 模糊指纹（v0.5 Campaign 基础；v0.8 指纹 v1）。
 *
 * v0.4 的 cyrb53 是精确指纹：换一个词/插一个空格就失配，垃圾号换措辞即绕过。
 * SimHash 把归一化文本降到 64 bit 位向量：语义近似 -> 位向量近似，
 * 检测侧用「汉明距离 <= threshold」判「话术变体」（同模板的换词版）。
 *
 * 与 cyrb53 的关系：fingerprintText 接口不变（同步、返回 16 位 hex），
 * 实现换成 simhash 后，旧快照里的精确指纹与新的变体检测自然共存——
 * 精确集合命中走 exact（v0.4 行为），simhashes 集合走汉明距离（v0.5）。
 *
 * 指纹 v1（v0.8）：v0 的三个已知盲区——
 * 1. 无 NFKC 折叠：全角字母/数字（如全角写的 dm me）与半角写法指纹不同，全角规避直接 miss；
 * 2. 无停用字处理：中文高频字（的/了/是/在…）在所有文本中重复投票，稀释判别力；
 * 3. 最短长度门槛 12 字符：黄推短隐语（「我福不黑不信你看」9 字符）不产指纹。
 * v1 用 normalizeForFingerprintV1 + 停用字过滤 + 更低门槛，输出仍是 16 位 hex，
 * 但高 4 bit 固定为版本标记 0x3（低 60 bit 才是哈希）。
 *
 * 版本化原因：指纹是单向哈希，服务端没有原文无法重算历史指纹。
 * 直接改算法 = 社区指纹库瞬间全部失配。v0/v1 并存让旧模板继续生效、
 * 新指纹随新上报自然积累；恰好 0x3 开头的旧值（约 6%）被当作 v1 参与距离时，
 * 因哈希函数族不同距离伪随机（期望 ~30），阈值 2 必然拒绝，只多一个永不可达候选。
 *
 * 隐私：同 v0，输入是归一化文本，输出是单向位哈希，原文永不出设备。
 */
import {
  normalizeForFingerprint,
  normalizeForFingerprintV1,
  MIN_FINGERPRINT_LENGTH,
  MIN_FINGERPRINT_LENGTH_V1,
} from './fingerprint';

/** 汉明距离阈值：<= 此距离视为同一话术的变体。2 容忍「换词/插词/删词」的常见单点编辑。 */
export const SIMHASH_HAMMING_THRESHOLD = 2;

/** 指纹 v1 的版本标记：v1 值的高 4 bit 固定为 0x3，低 60 bit 为 v1 SimHash。 */
export const SIMHASH_VERSION_NIBBLE = 0x3;

/** 词权重上限：高频词（的/了/是…）不稀释长词的判别力 */
const MAX_TOKEN_WEIGHT = 8;

/** v1 有效 n-gram 下限：低于此投票数量区分度不足（对应约 6 个归一化字符）。 */
export const MIN_GRAM_COUNT_V1 = 12;

/**
 * v1 停用字（字符级）：只剔绝对高频、中性的字。保守选择——
 * 「不/这/那/一」等模棱两可的字留着（「不黑」是黄推隐语关键词），
 * 宁可少剔也不误伤模板判别力。
 */
const STOP_CHARS = new Set(
  '的了是在我你他她它们有和就都而及与着或也不很还没什吗嘛啊吧呢',
);

/** v1 停用词（英文，精确匹配整词）：归一化后无空格，只有恰好相邻的 2-4 字符整词才命中。 */
const STOP_WORDS_EN = new Set([
  'a', 'an', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'the', 'and', 'or', 'of', 'to', 'for', 'with', 'in', 'on', 'at', 'by',
  'from', 'it', 'he', 'she', 'we', 'you', 'me', 'my', 'your', 'this',
  'that', 'these', 'those', 'not', 'so', 'but', 'as', 'if', 'then', 'than',
]);

function isStopOnly(gram: string): boolean {
  if (STOP_WORDS_EN.has(gram)) {
    return true;
  }
  for (const ch of gram) {
    if (!STOP_CHARS.has(ch)) {
      return false;
    }
  }
  return true;
}

/** 与 normalizeForFingerprint 同域：小写 -> URL/@占位 -> 剥符号，按空白切词 */
export function simhashTokens(text: string): string[] {
  const normalized = normalizeForFingerprint(text);
  if (normalized.length < MIN_FINGERPRINT_LENGTH) {
    return [];
  }
  return ngramsOf(normalized);
}

/**
 * v1 token 化：归一化（含 NFKC 全角折叠）后切 2-4 字符 n-gram，
 * 剔除「全由停用字/词组成」的 gram（纯噪声投票），再按有效 gram 数判下限。
 */
export function simhashTokensV1(text: string): string[] {
  const normalized = normalizeForFingerprintV1(text);
  if (normalized.length < MIN_FINGERPRINT_LENGTH_V1) {
    return [];
  }
  const grams = ngramsOf(normalized).filter((g) => !isStopOnly(g));
  if (grams.length < MIN_GRAM_COUNT_V1) {
    return [];
  }
  return grams;
}

/**
 * 2-4 字符滑动窗口 n-gram：
 * n-gram 对词序敏感（"giveaway free" vs "free giveaway" 特征不同），
 * 同时容忍单字词/插词（精确词切分做不到）。
 */
function ngramsOf(normalized: string): string[] {
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
  return voteBits(simhashTokens(text));
}

/**
 * v1 位向量：投票只落在低 60 bit，高 4 bit 固定为版本标记 SIMHASH_VERSION_NIBBLE。
 * 输出形状仍是 16 位 hex，但 v1 值恒以 '3' 开头——检测侧据此与 v0 模板隔离。
 */
export function textToSimhashV1(text: string): bigint | null {
  const bits = voteBits(simhashTokensV1(text));
  if (bits === null) {
    return null;
  }
  return (bits & 0x0fffffffffffffffn) | (BigInt(SIMHASH_VERSION_NIBBLE) << 60n);
}

function voteBits(tokens: string[]): bigint | null {
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

/** 指纹值是否 v1 版本：高 4 bit 为版本标记，v1 恒以 '3' 开头。 */
export function isSimhashV1(value: string): boolean {
  return value.startsWith(SIMHASH_VERSION_NIBBLE.toString(16));
}