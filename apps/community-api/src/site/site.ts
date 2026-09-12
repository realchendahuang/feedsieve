// 站点级常量：品牌名、站点 URL（多页面共用，避免 URL 漂移）
export const SITE_NAME = '福滤娃 FeedSieve';
export const SITE_URL = 'https://feedsieve.win';
export const SLOGAN = '高置信垃圾账号黄框标注，一键原生拉黑，全端同步消失。';

/** GitHub 开源仓库（页脚/安装入口链接） */
export const GITHUB_URL = 'https://github.com/realchendahuang/feedsieve';

/** Chrome 应用商店安装页 */
export const CHROME_STORE_URL =
  'https://chromewebstore.google.com/detail/feedsieve/amhdjglnonjaoenddnifpnljgmocfdph';

/** 账号 X 主页链接（公示行/榜单行跳转用） */
export function xProfileUrl(handle: string): string {
  return `https://x.com/${encodeURIComponent(handle)}`;
}
