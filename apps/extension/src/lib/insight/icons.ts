/**
 * 页面徽标用的线性图标，路径取自 Lucide（ISC License，https://lucide.dev）。
 * 用 SVG 而不用 emoji：各系统渲染一致，颜色跟随 currentColor。
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

type IconSpec = Array<{ tag: 'path' | 'polyline' | 'circle'; attrs: Record<string, string> }>;

export const ICONS = {
  /** lucide: trending-up */
  trending: [
    { tag: 'polyline', attrs: { points: '22 7 13.5 15.5 8.5 10.5 2 17' } },
    { tag: 'polyline', attrs: { points: '16 7 22 7 22 13' } },
  ],
  /** lucide: flame */
  flame: [
    {
      tag: 'path',
      attrs: {
        d: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z',
      },
    },
  ],
  /** STARTER — lucide: sprout */
  sprout: [
    { tag: 'path', attrs: { d: 'M7 20h10' } },
    { tag: 'path', attrs: { d: 'M10 20c5.5-2.5.8-6.4 3-10' } },
    {
      tag: 'path',
      attrs: {
        d: 'M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z',
      },
    },
    {
      tag: 'path',
      attrs: {
        d: 'M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z',
      },
    },
  ],
  /** NANO — lucide: sparkle */
  sparkle: [
    {
      tag: 'path',
      attrs: {
        d: 'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z',
      },
    },
  ],
  /** MICRO — lucide: star */
  star: [
    {
      tag: 'path',
      attrs: {
        d: 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z',
      },
    },
  ],
  /** MID — lucide: award */
  award: [
    {
      tag: 'path',
      attrs: {
        d: 'm15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526',
      },
    },
    { tag: 'circle', attrs: { cx: '12', cy: '8', r: '6' } },
  ],
  /** MACRO — lucide: gem */
  gem: [
    { tag: 'path', attrs: { d: 'M6 3h12l4 6-10 13L2 9Z' } },
    { tag: 'path', attrs: { d: 'M11 3 8 9l4 13 4-13-3-6' } },
    { tag: 'path', attrs: { d: 'M2 9h20' } },
  ],
  /** MEGA — lucide: crown */
  crown: [
    {
      tag: 'path',
      attrs: {
        d: 'M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z',
      },
    },
    { tag: 'path', attrs: { d: 'M5 21h14' } },
  ],
  /** 动作栏手动拉黑 — lucide: user-x */
  userX: [
    { tag: 'path', attrs: { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' } },
    { tag: 'circle', attrs: { cx: '9', cy: '7', r: '4' } },
    { tag: 'path', attrs: { d: 'm17 8 5 5' } },
    { tag: 'path', attrs: { d: 'm22 8-5 5' } },
  ],
  /** 标黄徽章 — lucide: shield-alert */
  shieldAlert: [
    {
      tag: 'path',
      attrs: {
        d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
      },
    },
    { tag: 'path', attrs: { d: 'M12 8v4' } },
    { tag: 'path', attrs: { d: 'M12 16h.01' } },
  ],
  /** lucide: check */
  check: [{ tag: 'path', attrs: { d: 'M20 6 9 17l-5-5' } }],
  /** 热帖互动数 — lucide: message-circle / repeat-2 / heart / bar-chart-2 / bookmark */
  reply: [{ tag: 'path', attrs: { d: 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z' } }],
  repost: [
    { tag: 'path', attrs: { d: 'm2 9 3-3 3 3' } },
    { tag: 'path', attrs: { d: 'M13 18H7a2 2 0 0 1-2-2V6' } },
    { tag: 'path', attrs: { d: 'm22 15-3 3-3-3' } },
    { tag: 'path', attrs: { d: 'M11 6h6a2 2 0 0 1 2 2v10' } },
  ],
  like: [
    {
      tag: 'path',
      attrs: {
        d: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
      },
    },
  ],
  views: [
    { tag: 'path', attrs: { d: 'M18 20V10' } },
    { tag: 'path', attrs: { d: 'M12 20V4' } },
    { tag: 'path', attrs: { d: 'M6 20v-6' } },
  ],
  bookmark: [{ tag: 'path', attrs: { d: 'm19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z' } }],
  /** lucide: users */
  users: [
    { tag: 'path', attrs: { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' } },
    { tag: 'circle', attrs: { cx: '9', cy: '7', r: '4' } },
    { tag: 'path', attrs: { d: 'M22 21v-2a4 4 0 0 0-3-3.87' } },
    { tag: 'path', attrs: { d: 'M16 3.13a4 4 0 0 1 0 7.75' } },
  ],
} satisfies Record<string, IconSpec>;

export type IconName = keyof typeof ICONS;

/** 图标的原始形状（popup 里用 React 渲染同一套图标）。 */
export function iconParts(name: IconName): IconSpec {
  return ICONS[name] as IconSpec;
}

export function createIcon(name: IconName, size = 13): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.25');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-fs-icon', name);
  for (const part of ICONS[name] as IconSpec) {
    const node = document.createElementNS(SVG_NS, part.tag);
    for (const [key, value] of Object.entries(part.attrs)) node.setAttribute(key, value);
    svg.appendChild(node);
  }
  return svg;
}

/** 量级 → 图标：🌱 → ✦ → ★ → 奖章 → 宝石 → 皇冠，越往上越“贵重”。 */
export const TIER_ICONS: Record<1 | 2 | 3 | 4 | 5 | 6, IconName> = {
  1: 'sprout',
  2: 'sparkle',
  3: 'star',
  4: 'award',
  5: 'gem',
  6: 'crown',
};
