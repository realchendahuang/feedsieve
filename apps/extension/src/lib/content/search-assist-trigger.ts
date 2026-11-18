/**
 * X 搜索框的高级搜索轻入口（常驻内容脚本）：
 * 只负责把小按钮挂进搜索胶囊、处理悬停说明和地址变化时的状态复位；
 * 用户点击按钮后才通过 loadDialog 按需加载完整的 20KB+ 高级搜索表单弹窗。
 */
import { createHovercard } from '../insight/hovercard';
import type { UiLanguage } from '../platform/i18n';
import type { SearchAssistPrefs } from '../settings/search-assist';
import type {
  SearchAssistDialogController,
  SearchAssistDialogDeps,
} from './search-assist-dialog';
import {
  SEARCH_ASSIST_SHARED_COPY,
  SEARCH_ASSIST_TRIGGER_CLASS,
} from './search-assist-shared';

const SEARCH_FORM_SELECTORS = [
  '[data-testid="sidebarColumn"] form[role="search"]',
  'form[role="search"]',
] as const;

const SEARCH_LABEL_SELECTOR = '[data-testid="SearchBox_Search_Input_label"]';

export type SearchAssistDialogFactory = (
  deps: SearchAssistDialogDeps,
) => SearchAssistDialogController;

export interface SearchAssistTriggerDeps {
  getLanguage: () => UiLanguage;
  isEnabled: () => boolean;
  getPath?: () => string;
  getSearch?: () => string;
  openUrl?: (url: string) => void;
  openTab?: (url: string) => void;
  loadPrefs?: () => Promise<SearchAssistPrefs>;
  savePrefs?: (prefs: SearchAssistPrefs) => Promise<void>;
  loadDialog: () => SearchAssistDialogFactory | Promise<SearchAssistDialogFactory>;
}

export interface SearchAssist {
  tick(): void;
  stop(): void;
  /** 测试用：入口是否还在页面上。 */
  mounted(): boolean;
  /** 测试用：弹窗是否打开。 */
  isOpen(): boolean;
}

function findSearchForm(): HTMLFormElement | null {
  for (const selector of SEARCH_FORM_SELECTORS) {
    for (const form of document.querySelectorAll<HTMLFormElement>(selector)) {
      if (form.querySelector('input')) return form;
    }
  }
  return null;
}

function findSearchSlot(form: HTMLFormElement): HTMLElement | null {
  return (
    form.querySelector<HTMLElement>(SEARCH_LABEL_SELECTOR) ??
    form.querySelector<HTMLElement>('label') ??
    form.querySelector<HTMLInputElement>('input')?.parentElement ??
    null
  );
}

function slidersIcon(): SVGSVGElement {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M4 7h10', 'M18 7h2', 'M4 17h4', 'M12 17h8', 'M16 5v4', 'M10 15v4']) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

export function createSearchAssistTrigger(deps: SearchAssistTriggerDeps): SearchAssist {
  const getPath = deps.getPath ?? (() => location.pathname);
  const getSearch = deps.getSearch ?? (() => location.search);
  const openUrl = deps.openUrl ?? ((url: string) => location.assign(url));
  const openTab: (url: string) => void =
    deps.openTab ??
    ((url: string) => {
      window.open(url, '_blank', 'noopener');
    });

  let trigger: HTMLButtonElement | null = null;
  let renderedLanguage: UiLanguage | null = null;
  let lastLocation = '';
  let stopped = false;
  let dialog: SearchAssistDialogController | null = null;
  let dialogPromise: Promise<SearchAssistDialogController> | null = null;

  const copy = () => SEARCH_ASSIST_SHARED_COPY[deps.getLanguage()];

  const tips = createHovercard({
    resolve: (target) => {
      const el = target.closest<HTMLElement>('[data-fs-tip]');
      const note = el?.getAttribute('data-fs-tip');
      if (!el || !note) return null;
      return {
        anchor: el,
        content: {
          title: el.getAttribute('data-fs-tip-title') ?? copy().helpTitle,
          rows: [],
          notes: [note],
          footer: copy().toggleFooter,
        },
      };
    },
  });
  tips.listen();

  const dialogDeps = (): SearchAssistDialogDeps => ({
    getLanguage: deps.getLanguage,
    isEnabled: deps.isEnabled,
    getPath,
    getSearch,
    openUrl,
    openTab,
    loadPrefs: deps.loadPrefs,
    savePrefs: deps.savePrefs,
    onExpandedChange: (expanded) => trigger?.setAttribute('aria-expanded', String(expanded)),
    hideTips: () => tips.hide(),
  });

  function createDialog(factory: SearchAssistDialogFactory): SearchAssistDialogController {
    dialog = factory(dialogDeps());
    return dialog;
  }

  function openDialog(): void {
    if (!deps.isEnabled()) return;
    if (dialog) {
      dialog.open();
      return;
    }
    const result = deps.loadDialog();
    if (typeof result === 'function') {
      createDialog(result).open();
      return;
    }
    dialogPromise ??= result
      .then(async (factory) => {
        const instance = createDialog(factory);
        await instance.ready();
        return instance;
      })
      .catch((error) => {
        dialogPromise = null;
        throw error;
      });
    void dialogPromise
      .then((instance) => {
        if (!stopped && deps.isEnabled()) instance.open();
      })
      .catch((error) => {
        console.error('[FeedSieve] 高级搜索弹窗加载失败:', error);
      });
  }

  function buildTrigger(): HTMLButtonElement {
    const c = copy();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = SEARCH_ASSIST_TRIGGER_CLASS;
    button.setAttribute('aria-label', c.trigger);
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('data-fs-tip', c.triggerHelp);
    button.setAttribute('data-fs-tip-title', c.helpTitle);
    button.appendChild(slidersIcon());
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openDialog();
    });
    return button;
  }

  function ensureMounted(): void {
    if (!deps.isEnabled()) {
      dialog?.close();
      trigger?.remove();
      trigger = null;
      renderedLanguage = null;
      return;
    }
    const form = findSearchForm();
    const label = form ? findSearchSlot(form) : null;
    if (!form || !label) {
      dialog?.close();
      trigger?.remove();
      trigger = null;
      return;
    }
    if (!trigger) trigger = buildTrigger();
    if (trigger.parentElement !== label) label.appendChild(trigger);
    if (renderedLanguage !== deps.getLanguage()) {
      const c = copy();
      trigger.setAttribute('aria-label', c.trigger);
      trigger.setAttribute('data-fs-tip', c.triggerHelp);
      trigger.setAttribute('data-fs-tip-title', c.helpTitle);
      renderedLanguage = deps.getLanguage();
      dialog?.reopenForLanguage();
    }
  }

  function syncLocation(): void {
    const locationKey = `${getPath()}${getSearch()}`;
    if (locationKey !== lastLocation) {
      if (lastLocation) dialog?.close();
      lastLocation = locationKey;
    }
    dialog?.syncLocation();
  }

  function tick(): void {
    dialog?.syncBackdrop();
    syncLocation();
    ensureMounted();
  }

  function stop(): void {
    stopped = true;
    dialog?.stop();
    trigger?.remove();
    trigger = null;
    renderedLanguage = null;
  }

  tick();

  return {
    tick,
    stop,
    mounted: () => Boolean(trigger?.isConnected),
    isOpen: () => Boolean(dialog?.isOpen()),
  };
}
