import { SITE_NAME, SITE_URL } from './site';

/**
 * 页面级 head 模板：title / description / canonical / OG / Twitter 一并套用，
 * og:image 指向 resvg 动态分享卡（/og/...png），?v= 缓存破坏版本走站点级版本旗。
 */
export interface PageSeo {
  title: string;
  description: string;
  /** 站内路径，如 /lists/blacklist */
  path: string;
  ogImage?: string;
  /** loader 空数据时的软 404 防法：整页 noindex */
  noindex?: boolean;
}

/** OG 图缓存破坏版本（发布期手动 +1）；走环境变量的原因：随快照节奏走 */
const OG_VERSION = (globalThis as { __FS_OG_V__?: number }).__FS_OG_V__ ?? 1;

export function pageHead(seo: PageSeo) {
  const url = `${SITE_URL}${seo.path}`;
  const image = seo.ogImage ?? `${SITE_URL}/og/site.png?v=${OG_VERSION}`;
  const robots = seo.noindex ? [{ name: 'robots', content: 'noindex' }] : [];
  return {
    meta: [
      { title: `${seo.title} · ${SITE_NAME}` },
      { name: 'description', content: seo.description },
      ...robots,
      { property: 'og:title', content: seo.title },
      { property: 'og:description', content: seo.description },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: url },
      { property: 'og:image', content: image },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: seo.title },
      { name: 'twitter:description', content: seo.description },
      { name: 'twitter:image', content: image },
    ],
    links: [{ rel: 'canonical', href: url }],
  };
}
