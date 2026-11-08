/**
 * AI 味报告的对外文案（档位 + 百分比）：扩展的检测卡 / 面板 / 分享图与官网公开结果页、
 * OG 预览图共用同一份，保证同一个账号在哪里看到的档位一样。锐评只来自模型输出（comment），
 * 不再有手写评语池兜底。
 */
export {
  flavorOf,
  type AiVerdict,
  type Flavor,
  type FlavorTone,
  type Lang,
  type Rhythm,
} from './flavor';
