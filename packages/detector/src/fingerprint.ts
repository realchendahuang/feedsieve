import { simhashToHex, textToSimhash } from './simhash';

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
