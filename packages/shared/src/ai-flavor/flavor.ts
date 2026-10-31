/**
 * AI 味报告的对外文案（纯函数）。
 *
 * 内部判定等级 ai / suspect / human 只驱动逻辑；对外给「AI 味 N%」+ 档位 + 一句锐评，
 * 方便截图传播。百分比按 5 取整：Jev 同一输入会有 ±0.02 的抖动，取整后复测不容易变数字。
 */
/** 回复节奏：≤90 秒间隔占比、≤6 字短回复占比、长度变异系数（扩展与服务端同口径）。 */
export interface Rhythm {
  fast: number;
  short: number;
  cv: number;
}
import { pickRoast, type RoastPool } from './roasts';

export type AiVerdict = 'ai' | 'suspect' | 'human' | 'insufficient';
export type FlavorTone = 'ai' | 'mixed' | 'human';
export type Lang = 'zh' | 'en';

export interface Flavor {
  /** 0–100，按 5 取整 */
  percent: number;
  tone: FlavorTone;
  level: string;
  roast: string;
}

interface Tier {
  min: number;
  tone: FlavorTone;
  pool: RoastPool;
  zh: string;
  en: string;
}

/** 从高到低匹配第一个 score ≥ min 的档位。评语在 roasts.ts，每档几十条。 */
const TIERS: Tier[] = [
  { min: 0.8, tone: 'ai', pool: 'aiMax', zh: 'AI 感爆棚', en: 'Off-the-charts AI' },
  { min: 0.55, tone: 'ai', pool: 'aiStrong', zh: 'AI 味很冲', en: 'Strong AI flavor' },
  { min: 0.45, tone: 'mixed', pool: 'aiBit', zh: '有点 AI 味', en: 'A bit AI-ish' },
  { min: 0.4, tone: 'mixed', pool: 'unsure', zh: '人机难辨', en: 'Hard to tell' },
  { min: 0.2, tone: 'human', pool: 'humanMostly', zh: '人味为主', en: 'Mostly human' },
  { min: 0, tone: 'human', pool: 'humanMax', zh: '活人感爆棚', en: 'Certified human' },
];

/** seed 传账号：同一个号每次抽到同一条评语；不传时取每池第一条。 */
export function flavorOf(
  score: number,
  verdict: AiVerdict,
  rhythm: Rhythm | null,
  lang: Lang,
  seed?: string,
): Flavor {
  const clamped = Math.min(1, Math.max(0, score));
  const percent = Math.round((clamped * 100) / 5) * 5;
  // 服务端的结论优先：节奏机械把 0.45–0.55 判成 ai 时，档位跟着站到 AI 一侧
  let tier = TIERS.find((t) => clamped >= t.min) ?? TIERS[TIERS.length - 1]!;
  if (verdict === 'ai' && tier.tone !== 'ai') tier = TIERS[1]!;
  if (verdict === 'human' && tier.tone === 'ai') tier = TIERS[2]!;
  let pool: RoastPool = tier.pool;
  if (tier.tone !== 'human' && rhythm) {
    if (rhythm.fast >= 0.6) pool = 'clockwork';
    else if (rhythm.short <= 0.05 && rhythm.cv <= 0.3) pool = 'uniform';
  }
  return { percent, tone: tier.tone, level: tier[lang], roast: pickRoast(pool, lang, seed) };
}
