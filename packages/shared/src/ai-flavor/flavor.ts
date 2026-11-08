/**
 * AI 味报告的对外文案（纯函数）。
 *
 * 内部判定等级 ai / suspect / human 只驱动逻辑；对外给「AI 味 N%」+ 档位，
 * 方便截图传播。百分比按 5 取整：同一输入会有 ±0.02 的抖动，取整后复测不容易变数字。
 *
 * 一句锐评不在这里：锐评由判定模型（DeepSeek V4.1 Flash）判定时生成，随结论缓存
 * （`comment` 字段），页面与分享卡只显示模型写的这句。以前有一套手写评语池做兜底，
 * 已彻底删除——没有模型锐评就不显示，不再用预制文案冒充模型输出。
 */
/** 回复节奏：≤90 秒间隔占比、≤6 字短回复占比、长度变异系数（扩展与服务端同口径）。 */
export interface Rhythm {
  fast: number;
  short: number;
  cv: number;
}

export type AiVerdict = 'ai' | 'suspect' | 'human' | 'insufficient';
export type FlavorTone = 'ai' | 'mixed' | 'human';
export type Lang = 'zh' | 'en';

export interface Flavor {
  /** 0–100，按 5 取整 */
  percent: number;
  tone: FlavorTone;
  level: string;
}

interface Tier {
  min: number;
  tone: FlavorTone;
  zh: string;
  en: string;
}

/**
 * 从高到低匹配第一个 score ≥ min 的档位。
 * 分档按当前判定模型（goupiti 中转的 DeepSeek V4.1 Flash，0–100 整数口径）的分数分布校准，见
 * apps/community-api/src/ai-accounts/evidence.ts 的 DECISION：强线 0.80 / 节奏分支 0.40；
 * 档位边界围绕这两条线分布（DeepSeek 的 0.78 / 0.82 / 0.88 平台值较多）。
 */
const TIERS: Tier[] = [
  { min: 0.9, tone: 'ai', zh: 'AI 感爆棚', en: 'Off-the-charts AI' },
  { min: 0.8, tone: 'ai', zh: 'AI 味很冲', en: 'Strong AI flavor' },
  { min: 0.7, tone: 'mixed', zh: '有点 AI 味', en: 'A bit AI-ish' },
  { min: 0.5, tone: 'mixed', zh: '人机难辨', en: 'Hard to tell' },
  { min: 0.3, tone: 'human', zh: '人味为主', en: 'Mostly human' },
  { min: 0, tone: 'human', zh: '活人感爆棚', en: 'Certified human' },
];

export function flavorOf(score: number, verdict: AiVerdict, lang: Lang): Flavor {
  const clamped = Math.min(1, Math.max(0, score));
  const percent = Math.round((clamped * 100) / 5) * 5;
  // 服务端的结论优先：节奏机械把 0.45–0.55 判成 ai 时，档位跟着站到 AI 一侧
  let tier = TIERS.find((t) => clamped >= t.min) ?? TIERS[TIERS.length - 1]!;
  if (verdict === 'ai' && tier.tone !== 'ai') tier = TIERS[1]!;
  if (verdict === 'human' && tier.tone === 'ai') tier = TIERS[2]!;
  return { percent, tone: tier.tone, level: tier[lang] };
}
