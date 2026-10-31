/**
 * AI 味报告的对外文案（档位 + 评语库）：扩展的检测卡 / 面板 / 分享图与官网公开结果页、
 * OG 预览图共用同一份，保证同一个账号在哪里看到的档位和评语都一样。
 */
export {
  flavorOf,
  type AiVerdict,
  type Flavor,
  type FlavorTone,
  type Lang,
  type Rhythm,
} from './flavor';
export { pickRoast, ROASTS, type RoastPool } from './roasts';
