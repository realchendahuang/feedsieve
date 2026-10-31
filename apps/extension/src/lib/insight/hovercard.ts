/**
 * 徽标悬停卡片：替代浏览器原生 title 小黄条，可以分行、对齐、跟随亮暗主题。
 *
 * 内容在悬停的那一刻才生成（resolve 回调），所以总是最新数据。
 * 全部文本走 textContent；卡片挂在 body 上、pointer-events: none，不影响页面交互。
 */
export const HOVERCARD_CLASS = 'fs-hovercard';
const SHOW_DELAY_MS = 120;

export interface HoverContent {
  title: string;
  rows: Array<[label: string, value: string]>;
  notes?: string[];
  footer?: string;
}

export function createHovercard(options: {
  /** 返回悬停目标对应的内容；不是我们的徽标时返回 null。 */
  resolve: (target: Element) => { anchor: Element; content: HoverContent } | null;
}) {
  let card: HTMLElement | null = null;
  let current: Element | null = null;
  let timer: number | undefined;

  function ensureCard(): HTMLElement {
    if (card?.isConnected) return card;
    card = document.createElement('div');
    card.className = HOVERCARD_CLASS;
    card.setAttribute('role', 'tooltip');
    document.body.appendChild(card);
    return card;
  }

  function render(content: HoverContent): HTMLElement {
    const element = ensureCard();
    element.replaceChildren();
    const title = document.createElement('div');
    title.className = 'fs-hc-title';
    title.textContent = content.title;
    element.appendChild(title);
    if (content.rows.length > 0) {
      const grid = document.createElement('div');
      grid.className = 'fs-hc-rows';
      for (const [label, value] of content.rows) {
        const l = document.createElement('span');
        l.className = 'fs-hc-label';
        l.textContent = label;
        const v = document.createElement('span');
        v.className = 'fs-hc-value';
        v.textContent = value;
        grid.append(l, v);
      }
      element.appendChild(grid);
    }
    for (const note of content.notes ?? []) {
      const n = document.createElement('div');
      n.className = 'fs-hc-note';
      n.textContent = note;
      element.appendChild(n);
    }
    if (content.footer) {
      const f = document.createElement('div');
      f.className = 'fs-hc-foot';
      f.textContent = content.footer;
      element.appendChild(f);
    }
    return element;
  }

  function place(element: HTMLElement, anchor: Element): void {
    const rect = anchor.getBoundingClientRect();
    element.style.visibility = 'hidden';
    element.setAttribute('data-open', '');
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const gap = 8;
    let top = rect.bottom + gap;
    if (top + height > window.innerHeight - 8) top = rect.top - height - gap;
    const left = Math.min(
      Math.max(8, rect.left + rect.width / 2 - width / 2),
      window.innerWidth - width - 8,
    );
    element.style.top = `${Math.max(8, top)}px`;
    element.style.left = `${left}px`;
    element.style.visibility = '';
  }

  function hide(): void {
    window.clearTimeout(timer);
    current = null;
    card?.removeAttribute('data-open');
  }

  function onOver(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const hit = target ? options.resolve(target) : null;
    if (!hit) {
      if (current) hide();
      return;
    }
    if (hit.anchor === current) return;
    current = hit.anchor;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (current !== hit.anchor || !hit.anchor.isConnected) return;
      // 悬停那一刻再取一次，拿最新数据
      const fresh = options.resolve(hit.anchor) ?? hit;
      place(render(fresh.content), hit.anchor);
    }, SHOW_DELAY_MS);
  }

  function listen(): void {
    document.addEventListener('mouseover', onOver, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
  }

  return { listen, hide, render };
}
