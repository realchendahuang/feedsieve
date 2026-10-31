import { simhashToHex, textToSimhash, textToSimhashV1 } from './simhash';

/**
 * 内容指纹（v0.4，IMPLEMENTATION_PLAN.md Phase 7；v0.5 升级为 SimHash）。
 *
 * 纯账号名单的天然缺点：垃圾号换号但复用同一话术模板，名单抓不到新 handle。
 * 指纹把「话术骨架」变成可聚合的实体：归一化 -> 确定性哈希。
 *
 * 归一化抹平的变体：大小写、全半角标点、emoji、URL 落点、@提及对象、
 * 空白（含垃圾号防检测插的空格）。
 *
 * v0.5：fingerprintText 从 cyrb53 精确哈希升级为 64 bit SimHash 位向量
 * （实现见 simhash.ts）。输出形状不变（16 位 hex），但同一话术的
 * 「换词变体」距离相近，detect 侧用汉明距离 <= 阈值判变体命中。
 * 精确集合命中（v0.4 行为）与 simhash 集合命中（v0.5）在 detect 管线
 * 里共存：exact 优先，simhash 兜底。
 *
 * 隐私：指纹是归一化文本的单向哈希，原文永不出设备；
 * 只有用户拉黑成功后才随上报发送（apps/extension/src/lib/contribute.ts）。
 */

/** 归一化后短于此长度不产指纹：话术太短，和无关内容碰撞的概率不可忽略。 */
export const MIN_FINGERPRINT_LENGTH = 12;

/**
 * 指纹 v1 的归一化长度门槛（v0.8）：比 v0 的 12 低，
 * 覆盖黄推短隐语（「我福不黑不信你看」9 字符）；最终门槛
 * 还有有效 n-gram 数（MIN_GRAM_COUNT_V1，见 simhash.ts）双保险。
 */
export const MIN_FINGERPRINT_LENGTH_V1 = 8;

/** URL 与 @提及统一替换成占位词（占位词是纯字母数字，能活过符号剥离），换链接/换提及对象不换指纹。 */
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+(?:\.[\w-]+)+(?:\/\S*)?/gi;
const MENTION_RE = /@[A-Za-z0-9_]{1,15}/g;

/**
 * 归一化：小写 -> URL/@提及占位 -> 剥离一切非文字字符（emoji / 标点 / 空白，
 * 含垃圾号防检测插的全角空格）。输出只含字母数字与占位词。
 * simhash.ts 复用本函数切 n-gram 特征。
 */
export function normalizeForFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(URL_RE, 'fsurl')
    .replace(MENTION_RE, 'fsmention')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * 指纹 v1 归一化（v0.8）：在 v0 基础上先做 NFKC 折叠——
 * 全角字母/数字（如全角写的 dm me、500）折成半角，全角空格/标点被折叠后
 * 再由 v0 的正则剥离。零宽/控制字符（U+200B 等）属 Cf 类，同样被
 * 剥离正则消除（v0 行为，v1 补显式测试）。输出与 v0 同形状。
 */
export function normalizeForFingerprintV1(text: string): string {
  return normalizeForFingerprint(text.normalize('NFKC'));
}

/**
 * 文本 -> 16 位十六进制指纹（64 bit SimHash 位向量）。
 * 同步纯函数：detect() 管线是同步的，不引入 WebCrypto 异步。
 * 同一话术的换词变体距离近（<= SIMHASH_HAMMING_THRESHOLD），
 * 精确一致距离为 0。
 */
export function fingerprintText(text: string): string | null {
  const value = textToSimhash(text);
  if (value === null) {
    return null;
  }
  return simhashToHex(value);
}

/**
 * Detector / 扩展共用的指纹入口：正文优先（推文是复制的载体），
 * 无正文时退回简介（垃圾号爱在 bio 埋话术，PureTwitter 实证）。
 */
export function contentFingerprint(input: { text?: string; bio?: string }): string | null {
  const text = input.text?.trim() ? input.text : input.bio;
  if (!text) {
    return null;
  }
  return fingerprintText(text);
}

/**
 * 指纹 v1 入口（v0.8）：v0 同构，但走 v1 归一化（NFKC + 停用字 + 更低门槛）。
 * 输出仍是 16 位 hex，高 4 bit 为版本标记 0x3（v1 值恒以 '3' 开头）。
 * 新拉黑账号产生的指纹应从这里出，随上报自然积累 v1 模板；
 * 检测侧（detect.ts）同时消费 v0/v1 模板，旧值不失效。
 */
export function contentFingerprintV1(input: { text?: string; bio?: string }): string | null {
  const text = input.text?.trim() ? input.text : input.bio;
  if (!text) {
    return null;
  }
  return fingerprintTextV1(text);
}

/** v1 指纹（16 位 hex，高 4 bit 版本标记 0x3）；文本不达门槛返回 null。 */
export function fingerprintTextV1(text: string): string | null {
  const value = textToSimhashV1(text);
  if (value === null) {
    return null;
  }
  return simhashToHex(value);
}

/** 复读追踪器选项 */
export interface RepetitionTrackerOptions {
  /** 达到此次数视为复读（默认 3：同一模板出现两次内不标，压误伤） */
  minRepeat?: number;
  /** 追踪上限（长会话内存保护；FIFO 淘汰最旧的） */
  maxTracked?: number;
}

export interface RepetitionTracker {
  /**
   * 记一个账号使用该模板。达到不同账号阈值后每次调用都返回 true ——
   * 同一账号重复发帖或 X 虚拟滚动重挂 DOM 只算一次。
   */
  track(fingerprint: string, identity: string): boolean;
  /** 该指纹当前累计的不同账号数 */
  countOf(fingerprint: string): number;
}

/**
 * 本地复读追踪（v0.4 copy-paste clustering 的最简形态）：
 * 会话内存，不持久、不上传，页面关闭即消失。
 */
export function createRepetitionTracker(options: RepetitionTrackerOptions = {}): RepetitionTracker {
  const minRepeat = options.minRepeat ?? 3;
  const maxTracked = options.maxTracked ?? 600;
  const identities = new Map<string, Set<string>>();
  return {
    track(fingerprint, identity) {
      const seen = identities.get(fingerprint) ?? new Set<string>();
      seen.add(identity.toLowerCase());
      identities.set(fingerprint, seen);
      if (identities.size > maxTracked) {
        const oldest = identities.keys().next().value;
        if (oldest !== undefined && oldest !== fingerprint) {
          identities.delete(oldest);
        }
      }
      return seen.size >= minRepeat;
    },
    countOf(fingerprint) {
      return identities.get(fingerprint)?.size ?? 0;
    },
  };
}
