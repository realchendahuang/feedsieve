/**
 * 社区 API 基地址（名单/词库/贡献/开关共用）。
 * 构建期由 wxt.config.ts 注入 __FEEDSIEVE_API_BASE__：dev/本地测试可用
 * FEEDSIEVE_API_BASE 环境变量指向本地 wrangler dev；未设置时走官方线上实例。
 * 生产构建不设该变量，行为与原先完全一致。
 */
declare const __FEEDSIEVE_API_BASE__: string | undefined;

const OVERRIDE =
  typeof __FEEDSIEVE_API_BASE__ === 'string' ? __FEEDSIEVE_API_BASE__.trim() : '';
const NORMALIZED = OVERRIDE.replace(/\/+$/, '');

export const API_BASE = NORMALIZED || 'https://api.feedsieve.win';
