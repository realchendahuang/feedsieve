/**
 * 启发式规则 v1（IMPLEMENTATION_PLAN.md Phase 1）。
 *
 * 每条规则必须保守、可解释：宁可漏判也不误标（误杀有 Unblock 兜底，
 * 但噪音会摧毁「黄框值得信任」这个产品根基）。
 *
 * 规则只消费 Reader 能稳定提供的字段：handle / displayName / text / links。
 */

import type { DetectInput } from './detect';
import { detectorConfig } from './config';

/** 单条启发式的命中结论。null 表示未命中。 */
export interface HeuristicRule {
  id: string;
  check(input: DetectInput): string | null;
}

/** X 新号常见形态：「User123456789」/「用户 9527」。 */
const DEFAULT_NAME_RE = /^(?:user|用户)[\s\u00a0]*\d{5,}$/i;

const defaultNameDigits: HeuristicRule = {
  id: 'default-name-digits',
  check(input) {
    const displayName = input.displayName?.trim();
    if (displayName && DEFAULT_NAME_RE.test(displayName)) {
      return '默认名 + 随机数字，疑似批量注册账号';
    }
    // 曾有「handle 短前缀 + 长数字（ab12345678）作为第二条独立证据」的设想，
    // 但 displayName 缺失通常只是 X 懒加载 / 引用帖 DOM 暂时没解析出来：
    // 昵称没渲染出来时单凭 handle 形态判定，会误标真实用户（真实误标记录见
    // detect.test.ts「does not treat a temporarily missing display name」）。
    // 结论：displayName 缺失 = 证据不足，宁可漏判。
    return null;
  },
};

/**
 * 垃圾推广链接的域名特征词。
 *
 * v0.1 先用确定性关键词而非封禁域名单（维护成本高、易误伤正常站点）；
 * 后续由社区名单的 Domain 实体（v0.4）接管真实黑名单。
 * 不要求词边界：垃圾域名惯用 myfreecrypto.xxx 这类嵌入式命名；
 * 多字词组合误命中正常域名的概率极低，且标注需用户确认才会拉黑。
 */
const SPAM_HOST_HINT_RE = /(?:giveaway|airdrop|freecrypto|freegift|claimrewards?)/i;

const spamLinkHint: HeuristicRule = {
  id: 'spam-link-hint',
  check(input) {
    for (const link of input.links ?? []) {
      if (!link.hostname) {
        continue;
      }
      if (SPAM_HOST_HINT_RE.test(link.hostname)) {
        return `链接指向可疑推广域名（${link.hostname}）`;
      }
    }
    return null;
  },
};

/** 模板化文本：高频垃圾话术。每条 pattern 的 label 会直接成为标注理由。 */
const TEMPLATED_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /(?:加|私)(?:我)?(?:微信|QQ|扣扣)|带单(?:老师)?|内部(?:群|渠道)|包赚|稳赚不赔/i,
    '中文引流 / 带单话术',
  ],
  [
    /\b(?:dm|pm)\s+(?:me|us)\b[\s\S]{0,40}\b(?:invest|crypto|profit|earn|signal)/i,
    '英文 DM 引流 + 变现关键词',
  ],
  [/free\s+(?:crypto|bitcoin|eth|nft|gift\s?cards?)\b/i, '「免费加密货币/礼品卡」模板'],
  // 2026-08 真实样本：大量「500 USDT Giveaway」Tron 假抽奖，giveaway 拼写变体（giweaway）一并覆盖
  [
    /\b\d{1,7}\s*(?:usdt|usdc|btc|eth|sol|trx|tron|xrp|doge)\b[\s\S]{0,80}g[i1](?:v|w)?e?away/i,
    '加密货币 Giveaway 假抽奖模板',
  ],
  [
    /g[i1](?:v|w)?e?away[\s\S]{0,80}\b\d{1,7}\s*(?:usdt|usdc|btc|eth|sol|trx|tron|xrp|doge)\b/i,
    '加密货币 Giveaway 假抽奖模板',
  ],
  // 要求 repost/retweet/follow 这类强互动引流动词，避免误伤日常 "like ... win" 表述
  [/(?:follow|repost|retweet)\b[\s\S]{0,60}(?:claim|win)\b/i, '关注-转发抽奖引流话术'],
];

const templatedText: HeuristicRule = {
  id: 'templated-text',
  check(input) {
    // 正文与简介一起查（PureTwitter 覆盖 full_text/description 的实证：垃圾号爱在 bio 埋引流）
    const haystack = [input.text, input.bio].filter(Boolean).join('\n');
    if (!haystack) {
      return null;
    }
    for (const [pattern, label] of TEMPLATED_PATTERNS) {
      if (pattern.test(haystack)) {
        return `模板化垃圾话术：${label}`;
      }
    }
    return null;
  },
};

/**
 * wordSalad 规则（2026-09-07 真机样本起家的单词沙拉模板检测）。
 * 形状判定见 isWordSaladShape；本规则负责账号侧佐证，两条通道满足其一：
 * 1. 昵称/简介带中文引流隐语（与线上词库同语义的小集合，不自建词包）；
 * 2. 乱码批量 handle（2026-09-08 真机样本 mhmsezruwzxjwl：该批不写引流话术，
 *    昵称本身就是机器随机字母）。
 * 通道 2 只认 handle——昵称/简介会因懒加载缺失（见 defaultNameDigits 注记），
 * handle 是 MVP 冻结决策里唯一稳定的身份字段。
 * 仍宁可漏判干净昵称 + 常规 handle 的同类账号——那类由社区指纹/变体层兜底。
 */
const WORD_SALAD_TOKEN_RE = /^[a-z]{2,12}$/;
const WORD_SALAD_SYMBOL_RE = /^[\p{S}]{1,3}$/u;

/**
 * 判定参数全部取自 runtime 配置（packages/detector/src/config.ts）：
 * 内置兜底在编译期不变，线上覆写随签名词库包下发后经 applyDetectorConfigOverride
 * 原地热更（heuristics 只在规则执行时取值，无模块初始化顺序耦合）。
 */
const weakShapeConfig = detectorConfig.wordSalad;
/**
 * 黄推引流隐语佐证表。只收多字词与明确组合：
 * 单字「约」/「私」会误中「约稿」「私房菜」等正常昵称（2026-09-09 修正），
 * 引流语义靠「约炮/私信/私聊/私我」等完整词表达。
 */
const WORD_SALAD_TRAFFIC_HINT_RE =
  /主页|简介|牵线|福利|同城|上门|全国|空降|约炮|约啪|私信|私聊|私我/i;
/**
 * 「单词沙拉」形状判定（2026-09-07 真机样本：hard/fire/💙/lift/road、
 * make/forgive/✅/who/happy 等批量注册号连续发布；正文 = 随机小写英文单词 +
 * emoji，无标点/数字/链接/大写，单词全是字典词，无法做成关键词包）。
 * 形状单独出现会误伤「心情贴」（some days feel 🖤 hollow 这类真实句式），
 * 判定必须叠加账号侧佐证——由 wordSalad（隐语昵称/乱码 handle）与
 * weak-signal-combo（乱码/数字形态锚点 + 形状佐证）各自收口。
 */
export function isWordSaladShape(text: string): boolean {
  return wordSaladShapeStrength(text) === 'strong';
}

/**
 * 词沙拉形状证据强度（2026-09-11 失守修正：原单布尔门只认 5–9 token 且 ≥4 词，
 * 极简变体（两词 + 两 emoji 行）被挡在门外。弱证据从不单独定案——只在
 * weakSignalCombo 里作为「锚点 + 至少一条内容佐证」的佐证之一。）
 * 任一 token 含数字/标点/大写/中文链接 → 不是该形状。
 */
export type WordSaladStrength = 'strong' | 'weak';

export function wordSaladShapeStrength(text: string): WordSaladStrength | null {
  const trimmed = text?.trim();
  if (!trimmed) {
    return null;
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const { maxTokens, strongMinWords, weakMinTokens, weakMinWords, weakMinSymbols, weakMaxTokens } =
    weakShapeConfig;
  if (tokens.length < weakMinTokens || tokens.length > weakMaxTokens) {
    return null;
  }
  let words = 0;
  let symbols = 0;
  for (const token of tokens) {
    if (WORD_SALAD_TOKEN_RE.test(token)) {
      words += 1;
      continue;
    }
    if (WORD_SALAD_SYMBOL_RE.test(token)) {
      symbols += 1;
      continue;
    }
    return null;
  }
  if (words >= strongMinWords && symbols >= 1 && tokens.length <= maxTokens) {
    return 'strong';
  }
  if (words >= weakMinWords && symbols >= weakMinSymbols) {
    return 'weak';
  }
  return null;
}

/**
 * 乱码 handle 锚点 = 字母段 ≥12 位纯小写字母 + 乱码双征：稀有字母 ≥2
 * （j/q/v/x/z）且最长辅音串 ≥4。均匀随机字母块两条都会撞上；
 * 真人姓名 handle（javierzuniga、juarezvazquez、johnsmith、schwarzenegger）
 * 至多满足其一。稀有集合不收 w/k/y——真实姓名里太常见（wayne/wong/kim）。
 * 尾缀数字容忍 ≤2 位（2026-09-11 真机样本 ohbfwzyzopkkt2 型批次：上批纯字母
 * 规则发布后，该批仅加一位数字尾缀即绕开判定；字母段双征不变）。
 */
const WORD_SALAD_RARE_LETTER_RE = /[jqvxz]/g;
const WORD_SALAD_VOWEL_RE = /[aeiou]/;
/** 尾缀形态按 live config 动态取值（参数可热更）：每次调用重建，量级可忽略。 */
function digitSuffixPattern(): RegExp {
  return new RegExp(
    `^[a-z]{${detectorConfig.garbledHandle.minLetterRun},}\\d{0,${detectorConfig.garbledHandle.trailingDigits}}$`,
  );
}

function maxConsonantRun(handle: string): number {
  let max = 0;
  let run = 0;
  for (const ch of handle) {
    if (WORD_SALAD_VOWEL_RE.test(ch)) {
      run = 0;
    } else {
      run += 1;
      max = Math.max(max, run);
    }
  }
  return max;
}

function isGarbledBatchHandle(handle: string | undefined): boolean {
  const normalized = handle?.trim().replace(/^@+/, '').toLowerCase() ?? '';
  if (!digitSuffixPattern().test(normalized)) {
    return false;
  }
  const rare = normalized.match(WORD_SALAD_RARE_LETTER_RE)?.length ?? 0;
  return rare >= detectorConfig.garbledHandle.rareLetterCount &&
    maxConsonantRun(normalized) >= detectorConfig.garbledHandle.maxConsonantRun;
}

const wordSalad: HeuristicRule = {
  id: 'word-salad',
  check(input) {
    const text = input.text?.trim();
    if (!text || (input.links?.length ?? 0) > 0) {
      return null;
    }
    if (wordSaladShapeStrength(text) !== 'strong') {
      return null;
    }
    // 佐证双通道：① 官方词库佐证（DetectInput.keywordCorroborated，仅评测层
    // 手工注入——生产管线 keyword 命中即直接返回，不会走到 word-salad）；
    // ② 原硬编码隐语表，离线兜底。
    const side = [input.displayName, input.bio].filter(Boolean).join(' ');
    if (
      !WORD_SALAD_TRAFFIC_HINT_RE.test(side) &&
      !input.keywordCorroborated &&
      !isGarbledBatchHandle(input.handle)
    ) {
      return null;
    }
    return '英文单词沙拉模板（随机词 + emoji），疑似引流黄推';
  },
};

/**
 * 黄推「福」隐语（2026-08 真实样本：「我福不黑不信你看」「有人想批评一下我的福嘛」）。
 * 福 = 福利（露骨内容）；这类短语在正常中文语境几乎不出现，单命中即可标。
 */
const PORN_BAIT_FU_RE =
  /福不黑|(?:批评|评价|点评|看看|欣赏|指导)(?:一下)?我的福|我的福(?:嘛|呢)|福利(?:在主页|在简介|已备好|自取)/;

/**
 * 擦边词。单独出现常见于正常语境（如「茶有点涩」「玩得开」），
 * 因此要求两条以上组合才判，压误伤。
 */
const EROGENOUS_MARKERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/涩|色色/, '涩'],
  [/没我骚|比我[^。]{0,8}骚/, '骚'],
  [/玩[得的]{1,2}更?开/, '玩得开'],
  [/[🍑🍒🍆💧💋🌹]/u, '擦边emoji'],
];

const pornBaitZh: HeuristicRule = {
  id: 'porn-bait-zh',
  check(input) {
    const text = [input.text, input.bio].filter(Boolean).join('\n');
    if (!text) {
      return null;
    }
    if (PORN_BAIT_FU_RE.test(text)) {
      return '「福利」引流域黄推话术';
    }
    const hits: string[] = [];
    for (const [pattern, label] of EROGENOUS_MARKERS) {
      if (pattern.test(text)) {
        hits.push(label);
        if (hits.length >= 2) {
          return `擦边引流组合话术（${hits.join('+')}）`;
        }
      }
    }
    return null;
  },
};

/**
 * 弱信号组合层。
 *
 * 单条内容弱信号（单个擦边 marker、纯 emoji 正文、装饰昵称、重复字符、
 * 单词沙拉形状）在正常账号里都常见，任何一条单发都会成批误标，因此它们
 * 永远不单独成立；只有叠加在「账号形状异常」的锚点上才参与判定。
 *
 * 锚点两个家族（见各自函数注释）：乱码批量号（isGarbledBatchHandle）与
 * 数字形态批量号（isDigitPatternBatchHandle，子信号求和制）。锚点 + ≥1 条
 * 内容佐证才标——对应已实证的批量黄推形态（乱码/数字尾缀号 + 变体话术/
 * emoji 灌水/沙拉正文）。
 * 排在 DEFAULT_HEURISTICS 末位：任何单发规则先命中先解释，本规则只收尾。
 */
const EMOJI_CHAR_RE = /\p{Extended_Pictographic}/gu;
/** emoji 与紧随的变体选择符 / ZWJ 一起剥，剩余符号（© 等）与非空白全算残留。 */
const EMOJI_SEQUENCE_RE = /\p{Extended_Pictographic}[\u{FE0E}\u{FE0F}\u{200D}]*/gu;
const LEFTOVER_SYMBOL_RE = /[\p{S}\u{200B}-\u{200F}\u{2060}\u{FEFF}\s]/gu;
const URL_STRIP_RE = /https?:\/\/\S+|\b[\w-]+(?:\.[\w-]+)+\/\S*/gi;
/** 重复字符只认非标点/符号/空白的连续 4 连（!!!、……、--- 是正常用法）。 */
const REPEATED_CHAR_RE = /([^\s\p{P}\p{S}])\1{3,}/u;

function countEmoji(text: string): number {
  return (text.match(EMOJI_CHAR_RE)?.length ?? 0);
}

function isPureEmojiText(text: string): boolean {
  if (!countEmoji(text)) {
    return false;
  }
  const remaining = text
    .replace(EMOJI_SEQUENCE_RE, '')
    .replace(LEFTOVER_SYMBOL_RE, '')
    .trim();
  return remaining === '';
}

function hasRepeatedChars(text: string): boolean {
  // 先剥 URL：网址里的连续字符（ahhhh、//）不是话术信号
  return REPEATED_CHAR_RE.test(text.replace(URL_STRIP_RE, ' '));
}

/**
 * 数字形态批量号锚点（子信号求和制，阈下不成立）。
 *
 * 批量注册号除「纯字母乱码」外的另一大形态是 name+digits（jenny83922、
 * ab12345678）与字母数字交替（a1b2c3d4e5）。单条子信号在真实 handle 里
 * 都常见（john2024、mary_smith、admin888），求和到门槛才当锚点：
 * - ≥5 位连续数字段（机器尾缀）+2
 * - 字母数字严格交替 ≥4 组（a1b2c3d4）+3
 * - 数字占比 >45%（jenny83922=0.5 中，john2024=0.5 不中——前者有长数字段
 *   叠加，后者只有短段，靠占比门槛压掉纯短尾缀）+1
 * - 长度 ≥12 +1
 * - 去数字后剩余字母段 ≥5 且全无元音（zxcvbn 型）+2
 * 门槛 3：ab12345678（2+1）、jenny83922（2+1）过线；
 * john2024（1）、mary123（0）、music_lover2024（0）到不了。
 * 锚点只意味着「账号形状异常」，仍须叠加内容佐证才标注。
 */
const DIGIT_CLUSTER_RE = /\d+/g;
const ALTERNATION_RE = /^(?:[a-z]\d){4,}$|^(?:\d[a-z]){4,}$/;

export function isDigitPatternBatchHandle(handle: string | undefined): boolean {
  const normalized = handle?.trim().replace(/^@+/, '').toLowerCase() ?? '';
  if (!normalized || !/\d/.test(normalized)) {
    return false;
  }
  let suspicion = 0;
  const w = detectorConfig.digitAnchorWeights;
  const clusters = normalized.match(DIGIT_CLUSTER_RE) ?? [];
  if (Math.max(...clusters.map((d) => d.length)) >= 5) {
    suspicion += w.digitCluster5;
  }
  if (ALTERNATION_RE.test(normalized)) {
    suspicion += w.alternation;
  }
  const digitCount = clusters.reduce((sum, d) => sum + d.length, 0);
  if (digitCount / normalized.length > 0.45) {
    suspicion += w.digitRatio;
  }
  if (normalized.length >= 12) {
    suspicion += w.minLength12;
  }
  const lettersOnly = normalized.replace(/\d+/g, '');
  if (lettersOnly.length >= 5 && !/[aeiou]/.test(lettersOnly)) {
    suspicion += w.noVowelLetters;
  }
  return suspicion >= w.threshold;
}

/** 组合层锚点：乱码批量号或数字形态批量号。 */
export function hasBatchHandleAnchor(handle: string | undefined): boolean {
  return isGarbledBatchHandle(handle) || isDigitPatternBatchHandle(handle);
}

const weakSignalCombo: HeuristicRule = {
  id: 'weak-signal-combo',
  check(input) {
    if (!hasBatchHandleAnchor(input.handle)) {
      return null;
    }
    const evidence: string[] = [];
    const text = [input.text, input.bio].filter(Boolean).join('\n');
    if (text) {
      // 单个擦边 marker（≥2 条已由 porn-bait-zh 先行命中，这里只收尾）
      const marker = EROGENOUS_MARKERS.find(([pattern]) => pattern.test(text));
      if (marker) {
        evidence.push(`擦边特征（${marker[1]}）`);
      } else if (isPureEmojiText(text)) {
        evidence.push('纯 emoji 正文');
      }
      if (isWordSaladShape(text)) {
        evidence.push('英文单词沙拉形状');
      } else if (wordSaladShapeStrength(text) === 'weak') {
        // 弱形状（2–3 词 + ≥2 emoji）永不单独定案，仅在锚点成立时作为佐证之一
        evidence.push('英文单词沙拉弱形状');
      }
      if (hasRepeatedChars(text)) {
        evidence.push('重复灌水字符');
      }
    }
    const nameEmoji = countEmoji(input.displayName?.trim() ?? '');
    if (nameEmoji >= detectorConfig.combo.minNameEmoji) {
      evidence.push(`装饰昵称（${nameEmoji} 个 emoji）`);
    }
    if (evidence.length === 0) {
      return null;
    }
    return `批量注册特征 + ${evidence.join(' + ')}`;
  },
};

/** 默认启发式集合，按优先级排列（前面的先命中先解释）。 */
export const DEFAULT_HEURISTICS: readonly HeuristicRule[] = [
  defaultNameDigits,
  pornBaitZh,
  spamLinkHint,
  templatedText,
  wordSalad,
  weakSignalCombo,
];

/**
 * 弱信号组合层单独导出：扩展运行时只装配本规则（其余内置单信号规则
 * 留在 detector 评测层，分层决策见 extension detection-policy）。
 */
export { weakSignalCombo };
