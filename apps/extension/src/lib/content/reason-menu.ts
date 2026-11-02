/**
 * 手动拉黑的原因选择浮层。
 *
 * 固定在按钮下方（下方放不下时翻到上方），点外部 / Esc / 滚动时关闭。
 * 选择具体原因返回分类；选择「仅拉黑」返回 null —— 只拉黑，不参与社区计票。
 * 不用 X 的弹层容器：X 的虚拟列表会裁剪 overflow，挂在 body 上才不会被截断。
 */
import {
  MANUAL_REPORT_REASONS,
  manualReasonLabel,
  type ManualReportReason,
} from '../community/manual-reasons';
import type { UiLanguage } from '../platform/i18n';

export interface ReasonMenuOptions {
  language: UiLanguage;
  onPick: (reason: ManualReportReason | null) => void;
  onClose?: () => void;
}

const MENU_WIDTH = 232;
const VIEWPORT_MARGIN = 8;

export function openReasonMenu(anchor: HTMLElement, options: ReasonMenuOptions): () => void {
  const { language, onPick, onClose } = options;
  const menu = document.createElement('div');
  menu.className = 'fs-reason-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', language === 'zh' ? '拉黑原因' : 'Block reason');

  const title = document.createElement('div');
  title.className = 'fs-reason-menu-title';
  title.textContent = language === 'zh' ? '为什么拉黑？' : 'Why block?';
  menu.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'fs-reason-menu-grid';
  menu.appendChild(grid);

  let closed = false;
  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onViewportChange, true);
    window.removeEventListener('resize', onViewportChange);
    menu.remove();
    onClose?.();
  };

  const choose = (reason: ManualReportReason | null): void => {
    cleanup();
    onPick(reason);
  };

  for (const reason of MANUAL_REPORT_REASONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fs-reason-option';
    button.setAttribute('role', 'menuitem');
    button.dataset.fsReason = reason;
    button.textContent = manualReasonLabel(reason, language);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      choose(reason);
    });
    grid.appendChild(button);
  }

  const divider = document.createElement('div');
  divider.className = 'fs-reason-menu-divider';
  menu.appendChild(divider);

  const personal = document.createElement('button');
  personal.type = 'button';
  personal.className = 'fs-reason-option fs-reason-personal';
  personal.setAttribute('role', 'menuitem');
  personal.textContent =
    language === 'zh' ? '仅拉黑，不参与社区' : 'Block only, no community vote';
  personal.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    choose(null);
  });
  menu.appendChild(personal);

  document.body.appendChild(menu);

  // 先量高度再定位；happy-dom 里量到 0 时用默认尺寸兜底。
  const rect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const width = menuRect.width || MENU_WIDTH;
  const height = menuRect.height || 232;
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN),
  );
  const below = rect.bottom + 6;
  const top =
    below + height <= window.innerHeight - VIEWPORT_MARGIN
      ? below
      : Math.max(VIEWPORT_MARGIN, rect.top - height - 6);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  function onPointerDown(event: Event): void {
    const target = event.target;
    if (target instanceof Node && (menu.contains(target) || anchor.contains(target))) return;
    cleanup();
  }
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    cleanup();
  }
  function onViewportChange(event: Event): void {
    if (event.target instanceof Node && menu.contains(event.target)) return;
    cleanup();
  }

  // 打开这次点击本身也会派发 pointerdown；等事件循环走完再挂监听。
  setTimeout(() => {
    if (closed) return;
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);
  }, 0);

  grid.querySelector<HTMLButtonElement>('button')?.focus();

  return cleanup;
}
