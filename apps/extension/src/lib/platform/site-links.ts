/**
 * 官网公示站（feedsieve.win）统一出口：插件内任何「看完整名单/榜单」引流
 * 一律指向官网真路由，不再指向 API host。
 */
declare const __FEEDSIEVE_API_BASE__: string | undefined;

const OVERRIDE =
  typeof __FEEDSIEVE_API_BASE__ === 'string' ? __FEEDSIEVE_API_BASE__.trim() : '';
// 本地 FEEDSIEVE_API_BASE 指向 wrangler dev 时官网是同一个 worker，共 host；
// 生产不设变量，走线上官网。
const SITE_BASE = OVERRIDE ? OVERRIDE.replace(/\/+$/, '') : 'https://feedsieve.win';

export const SITE_URLS = {
  ranked: `${SITE_BASE}/lists/ranked`,
  whitelist: `${SITE_BASE}/lists/whitelist`,
  blacklist: `${SITE_BASE}/lists/blacklist`,
  rescue: `${SITE_BASE}/lists/rescue`,
  keywords: `${SITE_BASE}/lists/keywords`,
} as const;

export type SiteList = keyof typeof SITE_URLS;

export async function openOfficialPage(
  url: SiteList | string,
): Promise<void> {
  const target = SITE_URLS[url as keyof typeof SITE_URLS] ?? url;
  await browser.tabs.create({ url: target });
}
