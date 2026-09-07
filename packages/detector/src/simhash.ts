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
 * v0 的 token 哈希（hashTokenLegacy，XOR+8 位轮转）实测分布严重退化：
 * 生产指纹库全部值以 'f' 开头、64 位中 21 位恒定、两两平均汉明距离 13（均匀应 ~32）。
 * v0 已有指纹靠它重算才能一致（指纹是单向哈希，无原文不可重算），因此 v0 冻结不动；
 * v1 换用 FNV-1a 64 + splitmix64 finalizer（hashTokenV1），分布实测均匀，
 * 新指纹随 v1 上报自然积累，v0 池只减不增。
 *
 * 版本隔离：客户端 detect 侧严格按模板版本选本地位向量（'3' 前缀 = v1），
 * 不做跨版本距离计算。生产 v0 值实测全部 'f' 开头，与 v1 前缀天然零重叠；
 * 若出现假想的 '3' 开头 v0 旧值，它与 v1 位向量的距离属于不同哈希族的伪随机值，
 * 阈值 2 会拒绝，只是多一个永不可达候选。
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
 * 只有整条 gram 全由停用字/词组成才被剔除，「不黑」「信你」这类混合 gram
 * 照常参与投票，宁可少剔也不误伤模板判别力。
 */
const STOP_CHARS = new Set(
  '的了是在我你他她它们有和就都而及与着或也不很还没什吗嘛啊吧呢',
);

/**
 * v1 停用词（英文，精确匹配整条 gram）。归一化剥掉了空格，英文停用词只能以
 * 「恰好等于某个 2-4 字符 gram」的形式命中；这也连带剔掉含相同子串的内容词
 * （如 cat 里的 at），是对英文短文本判别力的已知小损耗，可接受。
 */
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
  return voteBits(simhashTokens(text), hashTokenLegacy);
}

/**
 * v1 位向量：投票只落在低 60 bit，高 4 bit 固定为版本标记 SIMHASH_VERSION_NIBBLE。
 * 输出形状仍是 16 位 hex，但 v1 值恒以 '3' 开头——检测侧据此与 v0 模板隔离。
 */
export function textToSimhashV1(text: string): bigint | null {
  const bits = voteBits(simhashTokensV1(text), hashTokenV1);
  if (bits === null) {
    return null;
  }
  return (bits & 0x0fffffffffffffffn) | (BigInt(SIMHASH_VERSION_NIBBLE) << 60n);
}

/**
 * v0 token 哈希（冻结）：XOR + 8 位轮转，实测分布退化（见文件头）。
 * 已上报的 v0 指纹依赖此实现重算一致，绝不可改；v0 池只减不增。
 */
function hashTokenLegacy(token: string): bigint {
  let h = 0x35b5e5a7n;
  for (let i = 0; i < token.length; i++) {
    h ^= BigInt(token.charCodeAt(i)) * 0x100000001b3n;
    h = (h >> 8n) | (h << 56n);
  }
  return h & 0xffffffffffffffffn;
}

const MASK_64 = 0xffffffffffffffffn;

/**
 * v1 token 哈希：FNV-1a 64 压缩 + splitmix64 finalizer。
 * 旧哈希的轮转-XOR 结构雪崩性不足（高位坍缩、21/64 位恒定），
 * FNV-1a 乘法扩散后再过一轮 splitmix64 终化，实测任意文本 64 位全活跃、
 * 两两距离均值 ~32（均匀）。无密码学强度要求，分布均匀即可。
 */
function hashTokenV1(token: string): bigint {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < token.length; i++) {
    h ^= BigInt(token.charCodeAt(i));
    h = (h * 0x100000001b3n) & MASK_64;
  }
  h = ((h ^ (h >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
  h = ((h ^ (h >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
  return (h ^ (h >> 31n)) & MASK_64;
}

function voteBits(tokens: string[], hashToken: (token: string) => bigint): bigint | null {
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
    weights.push({ hash: hashToken(token), weight: w });
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