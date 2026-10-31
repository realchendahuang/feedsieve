/**
 * 在推文动作栏（回复 / 转发 / 点赞 / 收藏 / 分享那一排）里加一个和 X 原生按钮一模一样的格子。
 *
 * 做法：复制动作栏里最后一个原生按钮的外层结构（分享 / 收藏这类不带计数的），只把图标换成
 * 自己的。这样宽度、间距、垂直对齐都跟着 X 的布局走，不用自己猜尺寸。React 的事件处理不随
 * cloneNode 带过来，所以复制出来的格子是「死」的，点击由我们自己接管。
 * 找不到可复制的原生按钮时，退回一个独立的圆形按钮。
 */

export const ACTION_SLOT_ATTR = 'data-fs-action';
const SVG_NS = 'http://www.w3.org/2000/svg';
/** X 动作栏图标的尺寸（1.25em @ 15px） */
const ICON_SIZE = '18.75';

export interface ActionSlot {
  root: HTMLElement;
  button: HTMLButtonElement;
  /** 换图标；传字符串时显示文字（失败提示） */
  setContent(content: SVGSVGElement | string): void;
}

export const ACTION_ICONS = {
  /** 机器人脸：AI 味检测 */
  robot: [
    'M12 4v3',
    'M6 7.5h12A2 2 0 0 1 20 9.5v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-7a2 2 0 0 1 2-2Z',
    'M9.5 12.5v1.5',
    'M14.5 12.5v1.5',
    'M1.75 12v3',
    'M22.25 12v3',
  ],
  /** 用户 + 叉：拉黑 */
  userX: [
    'M15 19.5v-1.25A3.75 3.75 0 0 0 11.25 14.5h-5A3.75 3.75 0 0 0 2.5 18.25v1.25',
    'M8.75 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
    'M17.5 8l4 4',
    'M21.5 8l-4 4',
  ],
  check: ['M20 6 9 17l-5-5'],
} as const;

/** X 风格的线条图标（细线，和原生图标同粗细）。 */
export function actionIcon(name: keyof typeof ACTION_ICONS): SVGSVGElement {
  const paths: readonly string[] = ACTION_ICONS[name];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', ICON_SIZE);
  svg.setAttribute('height', ICON_SIZE);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-fs-icon', name);
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

function nativeTemplate(group: Element): Element | null {
  const children = [...group.children].filter((c) => !c.hasAttribute(ACTION_SLOT_ATTR));
  for (const child of children.reverse()) {
    // 不复制带数字的（回复 / 转发 / 点赞 / 浏览），复制分享 / 收藏这类纯图标的
    if (!child.querySelector('svg') || !child.querySelector('button')) continue;
    if (/\d/.test(child.textContent ?? '')) continue;
    return child;
  }
  return null;
}

export function createActionSlot(group: Element, kind: string, label: string): ActionSlot {
  const template = nativeTemplate(group);
  let root: HTMLElement;
  let button: HTMLButtonElement;
  let iconHost: HTMLElement;
  const holder = document.createElement('span');
  holder.className = 'fs-act-ico';

  const native = template?.cloneNode(true) as HTMLElement | undefined;
  const nativeButton = native?.matches('button')
    ? (native as HTMLButtonElement)
    : native?.querySelector('button');
  const nativeSvg = native?.querySelector('svg');
  if (native && nativeButton && nativeSvg) {
    root = native;
    button = nativeButton;
    for (const node of [root, ...root.querySelectorAll('*')]) {
      for (const attr of [...node.attributes]) {
        if (attr.name === 'id' || attr.name === 'href' || attr.name.startsWith('aria-')) {
          node.removeAttribute(attr.name);
        }
        if (attr.name === 'data-testid') node.removeAttribute(attr.name);
      }
    }
    nativeSvg.replaceWith(holder);
    iconHost = holder;
  } else {
    root = document.createElement('div');
    button = document.createElement('button');
    button.className = 'fs-act-fallback';
    button.appendChild(holder);
    root.appendChild(button);
    iconHost = holder;
  }
  root.setAttribute(ACTION_SLOT_ATTR, kind);
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  return {
    root,
    button,
    setContent(content) {
      if (typeof content === 'string') {
        const text = document.createElement('span');
        text.className = 'fs-act-text';
        text.textContent = content;
        iconHost.replaceChildren(text);
      } else {
        iconHost.replaceChildren(content);
      }
    },
  };
}

/**
 * 插进动作栏之后调用：按原生「收藏 → 分享」之间的实际间距，给自家格子补左边距，
 * 让新图标和原生图标等距。量不到（节点还没布局）时保留样式里的默认间距。
 */
export function alignActionSlot(root: HTMLElement): void {
  const group = root.parentElement;
  if (!group) return;
  const natives = [...group.children].filter(
    (c) => !c.hasAttribute(ACTION_SLOT_ATTR) && c.getBoundingClientRect().width > 0,
  );
  const [a, b] = natives.slice(-2);
  const prev = root.previousElementSibling;
  if (!a || !b || !prev) return;
  const nativeGap = b.getBoundingClientRect().left - a.getBoundingClientRect().right;
  const currentMargin = parseFloat(getComputedStyle(root).marginLeft) || 0;
  const currentGap = root.getBoundingClientRect().left - prev.getBoundingClientRect().right;
  if (!(nativeGap > 0 && nativeGap < 40) || root.getBoundingClientRect().width === 0) return;
  root.style.marginLeft = `${Math.max(0, currentMargin + nativeGap - currentGap)}px`;
}

/** 动作栏格子的公共样式（ensureStyles 里拼进去）。 */
export const ACTION_SLOT_CSS = `
  [${ACTION_SLOT_ATTR}] { margin-left: 8px; }
  [${ACTION_SLOT_ATTR}] .fs-act-ico {
    position: relative; display: inline-grid; place-items: center;
    min-width: 18.75px; height: 18.75px; color: rgb(113, 118, 123);
    transition: color 150ms ease;
  }
  [${ACTION_SLOT_ATTR}] .fs-act-ico svg { display: block; position: relative; }
  /* 悬停圆底，和 X 原生按钮同尺寸（34.75px） */
  [${ACTION_SLOT_ATTR}] .fs-act-ico::before {
    content: ""; position: absolute; left: 50%; top: 50%; width: 34.75px; height: 34.75px;
    margin: -17.375px 0 0 -17.375px; border-radius: 9999px; background: transparent;
    transition: background-color 150ms ease;
  }
  [${ACTION_SLOT_ATTR}] button { cursor: pointer; }
  [${ACTION_SLOT_ATTR}] button:hover .fs-act-ico { color: var(--fs-act-fg); }
  [${ACTION_SLOT_ATTR}] button:hover .fs-act-ico::before { background: var(--fs-act-bg); }
  [${ACTION_SLOT_ATTR}] .fs-act-text { position: relative; font: 600 12px/1 system-ui, sans-serif; white-space: nowrap; }
  [${ACTION_SLOT_ATTR}] .fs-act-fallback {
    display: inline-grid; place-items: center; width: 34.75px; height: 34.75px; padding: 0;
    border: 0; background: transparent;
  }
  [${ACTION_SLOT_ATTR}="ai"] { --fs-act-fg: #7856ff; --fs-act-bg: rgba(120, 86, 255, 0.1); }
  [${ACTION_SLOT_ATTR}="block"] { --fs-act-fg: #d97706; --fs-act-bg: rgba(245, 158, 11, 0.12); }
  /* 拉黑：平时不显示（位置照占，布局不跳），悬停这条推文才出现；进行中 / 完成 / 失败时常显 */
  [${ACTION_SLOT_ATTR}="block"] { opacity: 0; transition: opacity 150ms ease; }
  article:hover [${ACTION_SLOT_ATTR}="block"],
  [${ACTION_SLOT_ATTR}="block"]:focus-within,
  [${ACTION_SLOT_ATTR}="block"]:has(button:not([data-fs-state="idle"])) { opacity: 1; }
  [${ACTION_SLOT_ATTR}="block"] button[data-fs-state="busy"] svg { animation: fs-pulse 1s ease-in-out infinite; }
  [${ACTION_SLOT_ATTR}="block"] button[data-fs-state="done"] .fs-act-ico { color: #d97706; }
  [${ACTION_SLOT_ATTR}="block"] button[data-fs-state="failed"] .fs-act-ico { color: #f4212e; }
`;
