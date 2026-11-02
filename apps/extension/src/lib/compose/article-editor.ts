/**
 * X 文章编辑器增强（内容脚本，只在 /compose/articles 下生效）：
 *
 * - 粘贴 Markdown 自动转成 X 文章格式（转换规则见 markdown-article.ts）。
 *   做法：拦下这次粘贴，换成转换好的 HTML 再交给 X 自己的编辑器粘贴，所以 ⌘Z 照常能撤销。
 *   ⌘⇧V / Ctrl+Shift+V 粘贴原文不转换；从网页、Word 复制来的带格式内容不接管。
 * - 右下角小面板：正文字数、预计阅读时长、小标题大纲（点击跳转）、导入 .md 文件、复制为 Markdown。
 * - 本机备份：编辑时把标题和正文（转成 Markdown）存进 storage.local，每篇留 5 个版本，
 *   X 编辑器出问题或误删时可以在面板「发帖 › 文章备份」里复制回来。
 *
 * 不替你点「发布」，内容不离开本机。
 */
import type { UiLanguage } from '../platform/i18n';
import {
  htmlHasStructure,
  looksLikeMarkdown,
  markdownToArticle,
  textStats,
} from './markdown-article';
import { articleToMarkdown } from './article-export';
import { saveBackup } from './schedule-store';

const EDITOR_SELECTOR = '[data-testid="composer"]';
const TITLE_SELECTOR = 'textarea[name="文章标题"], [data-testid="twitter-article-title"] textarea';
const PANEL_ID = 'feedsieve-article-panel';
const STYLE_ID = 'feedsieve-article-styles';
const TOAST_ID = 'feedsieve-article-toast';
const ARTICLE_PATH = /^\/compose\/articles\/edit\/(\d{1,25})/;
/** 编辑停下来这么久后存一次备份 */
const BACKUP_DEBOUNCE_MS = 5_000;

const COPY = {
  zh: {
    outline: '大纲',
    stats: (chars: number, words: number, minutes: number) =>
      `${chars.toLocaleString()} 字${words ? ` · ${words.toLocaleString()} 词` : ''} · ${minutes} 分钟`,
    importMd: '导入 Markdown 文件',
    copyMd: '复制为 Markdown',
    copied: '已复制 Markdown',
    copyFailed: '复制失败',
    collapse: '收起',
    expand: '展开',
    converted: '已按 Markdown 排版 · ⌘Z 撤销',
    imported: '已导入',
    importFailed: '导入失败',
  },
  en: {
    outline: 'Outline',
    stats: (chars: number, words: number, minutes: number) =>
      `${chars ? `${chars.toLocaleString()} chars · ` : ''}${words.toLocaleString()} words · ${minutes} min`,
    importMd: 'Import Markdown file',
    copyMd: 'Copy as Markdown',
    copied: 'Markdown copied',
    copyFailed: 'Copy failed',
    collapse: 'Collapse',
    expand: 'Expand',
    converted: 'Formatted from Markdown · ⌘Z to undo',
    imported: 'Imported',
    importFailed: 'Import failed',
  },
} as const;

/** 把 HTML 交给 X 的编辑器粘贴（Draft.js 走它自己的 HTML 转换，撤销栈正常）。 */
export function pasteHtml(editor: Element, html: string, text: string): void {
  const data = new DataTransfer();
  data.setData('text/html', html);
  data.setData('text/plain', text);
  editor.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
  );
}

/** 编辑器里的小标题（X 的「标题」是 h1，「副标题」是 h2）。 */
export function readOutline(
  editor: Element,
): Array<{ level: 1 | 2; text: string; element: Element }> {
  return [...editor.querySelectorAll('h1[data-block="true"], h2[data-block="true"]')]
    .map((element) => ({
      level: (element.tagName === 'H1' ? 1 : 2) as 1 | 2,
      text: (element.textContent ?? '').trim(),
      element,
    }))
    .filter((item) => item.text.length > 0);
}

function editorText(editor: Element): string {
  return [...editor.querySelectorAll('[data-block="true"]')]
    .map((b) => b.textContent ?? '')
    .join('\n');
}

function ensureArticleStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${PANEL_ID} {
      position: fixed; right: 16px; bottom: 16px; z-index: 30; width: 232px; max-height: 50vh;
      display: flex; flex-direction: column; overflow: hidden;
      border: 1px solid rgba(127, 127, 127, 0.3); border-radius: 12px;
      background: var(--fs-article-bg, rgba(21, 24, 28, 0.96)); color: var(--fs-article-fg, #e7e9ea);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
    }
    #${PANEL_ID} .fs-ap-head { display: flex; align-items: center; gap: 6px; padding: 8px 8px 8px 12px; }
    #${PANEL_ID} .fs-ap-title { font-weight: 700; }
    #${PANEL_ID} .fs-ap-stats { flex: 1; min-width: 0; color: rgba(127, 127, 127, 1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #${PANEL_ID} button {
      display: inline-flex; align-items: center; justify-content: center; flex: none;
      width: 26px; height: 26px; padding: 0; border: 0; border-radius: 999px;
      background: transparent; color: inherit; cursor: pointer;
    }
    #${PANEL_ID} button:hover { background: rgba(127, 127, 127, 0.18); }
    #${PANEL_ID} svg { width: 16px; height: 16px; }
    #${PANEL_ID} ol { list-style: none; margin: 0; padding: 0 6px 8px; overflow: auto; }
    #${PANEL_ID} ol:empty { display: none; }
    #${PANEL_ID} li button {
      display: block; width: 100%; height: auto; padding: 4px 6px; border-radius: 6px; text-align: left;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font: inherit;
    }
    #${PANEL_ID} li.fs-ap-l2 button { padding-left: 18px; color: rgba(127, 127, 127, 1); }
    #${PANEL_ID}.is-collapsed ol { display: none; }
    #${TOAST_ID} {
      position: fixed; left: 50%; bottom: 24px; z-index: 40; transform: translateX(-50%);
      padding: 8px 14px; border-radius: 999px; background: rgb(29, 155, 240); color: #fff;
      font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
      pointer-events: none;
    }
    .fs-ap-flash { animation: fs-ap-flash 1.2s ease-out; }
    @keyframes fs-ap-flash { from { background: rgba(29, 155, 240, 0.25); } to { background: transparent; } }
  `;
  (document.head ?? document.documentElement).append(style);
}

const ICONS = {
  // lucide file-down / chevron-down / chevron-up（ISC License）
  // lucide copy（ISC License）
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
  import: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>`,
  down: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`,
  up: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>`,
};

export interface ArticleHelperDeps {
  getLanguage: () => UiLanguage;
}

export function createArticleHelper(deps: ArticleHelperDeps) {
  let enabled = true;
  let plainUntil = 0;
  let collapsed = false;
  let observer: MutationObserver | null = null;
  let observed: Element | null = null;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let backupTimer: ReturnType<typeof setTimeout> | null = null;
  let started = false;
  const copy = () => COPY[deps.getLanguage()];

  const onArticlePage = () => ARTICLE_PATH.test(location.pathname);
  const articleId = () => ARTICLE_PATH.exec(location.pathname)?.[1] ?? null;
  const titleValue = () => document.querySelector<HTMLTextAreaElement>(TITLE_SELECTOR)?.value ?? '';

  function currentMarkdown(editorEl: Element): string {
    return articleToMarkdown(editorEl, titleValue());
  }

  function scheduleBackup(): void {
    if (backupTimer) clearTimeout(backupTimer);
    backupTimer = setTimeout(() => {
      backupTimer = null;
      const editorEl = editor();
      const id = articleId();
      if (!editorEl || !id) return;
      void saveBackup(id, {
        savedAt: Date.now(),
        title: titleValue(),
        markdown: articleToMarkdown(editorEl),
      }).catch(() => undefined);
    }, BACKUP_DEBOUNCE_MS);
  }

  function copyMarkdown(): void {
    const editorEl = editor();
    if (!editorEl) return;
    void navigator.clipboard
      .writeText(currentMarkdown(editorEl))
      .then(() => toast(copy().copied))
      .catch(() => toast(copy().copyFailed));
  }
  const editor = () => (onArticlePage() ? document.querySelector(EDITOR_SELECTOR) : null);

  function toast(text: string): void {
    document.getElementById(TOAST_ID)?.remove();
    const el = document.createElement('div');
    el.id = TOAST_ID;
    el.setAttribute('role', 'status');
    el.textContent = text;
    document.body.append(el);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2_500);
  }

  /** 标题框是空的才填（不覆盖你已经写好的标题）；填完把焦点还给正文。 */
  function fillTitle(title: string, editorEl: Element): void {
    const input = document.querySelector<HTMLTextAreaElement>(TITLE_SELECTOR);
    if (!input || input.value.trim() !== '') return;
    input.focus();
    input.select();
    // execCommand 走浏览器原生输入，X 的受控组件能收到
    const ok = document.execCommand('insertText', false, title);
    if (!ok) input.value = title;
    (editorEl as HTMLElement).focus();
  }

  function convertAndPaste(editorEl: Element, markdown: string): void {
    const result = markdownToArticle(markdown);
    if (result.html) pasteHtml(editorEl, result.html, result.text);
    // 等 X 把这次粘贴提交完再动焦点：粘贴还没渲染时就让编辑器失焦，它会拿粘贴前的内容覆盖回去
    if (result.title) {
      const title = result.title;
      setTimeout(() => fillTitle(title, editorEl), 300);
    }
  }

  function onPaste(event: ClipboardEvent): void {
    if (!enabled || !event.isTrusted) return;
    const target = event.target as Element | null;
    const editorEl = target?.closest?.(EDITOR_SELECTOR);
    if (!editorEl || !onArticlePage()) return;
    if (Date.now() < plainUntil) return;
    const data = event.clipboardData;
    if (!data || data.files.length > 0) return;
    const text = data.getData('text/plain');
    const html = data.getData('text/html');
    if (!looksLikeMarkdown(text) || (html && htmlHasStructure(html))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    convertAndPaste(editorEl, text);
    toast(copy().converted);
    scheduleRender();
  }

  function onKeydown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === 'KeyV') {
      plainUntil = Date.now() + 1_000;
    }
  }

  /** 光标放到正文最后（Draft 靠 selectionchange 同步选区，等一下再粘贴）。 */
  async function caretToEnd(editorEl: HTMLElement): Promise<void> {
    editorEl.focus();
    const texts = editorEl.querySelectorAll('[data-text="true"]');
    const last = texts[texts.length - 1];
    const selection = getSelection();
    if (!selection) return;
    const range = document.createRange();
    if (last?.firstChild) range.setStart(last.firstChild, last.firstChild.textContent?.length ?? 0);
    else {
      const blocks = editorEl.querySelectorAll('[data-block="true"]');
      const node = blocks[blocks.length - 1] ?? editorEl;
      range.selectNodeContents(node);
      range.collapse(false);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  function importFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.mdown,.txt,text/markdown,text/plain';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      const editorEl = editor() as HTMLElement | null;
      if (!file || !editorEl) return;
      void file
        .text()
        .then(async (text) => {
          await caretToEnd(editorEl);
          const blocks = editorEl.querySelectorAll('[data-block="true"]');
          // 最后一段有字：先回车起一个新段落，否则导入的第一段会并进去
          if ((blocks[blocks.length - 1]?.textContent ?? '').trim() !== '') {
            editorEl.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                bubbles: true,
                cancelable: true,
              }),
            );
            await new Promise((resolve) => setTimeout(resolve, 60));
          }
          convertAndPaste(editorEl, text);
          toast(copy().imported);
          scheduleRender();
        })
        .catch(() => toast(copy().importFailed));
    });
    input.click();
  }

  function themeColors(panel: HTMLElement): void {
    // 跟着 X 的主题：取页面背景色，浅色主题下用浅底深字
    const bg = getComputedStyle(document.body).backgroundColor;
    const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
    const light = match ? Number(match[1]) + Number(match[2]) + Number(match[3]) > 382 : false;
    panel.style.setProperty(
      '--fs-article-bg',
      light ? 'rgba(255, 255, 255, 0.97)' : 'rgba(21, 24, 28, 0.96)',
    );
    panel.style.setProperty('--fs-article-fg', light ? '#0f1419' : '#e7e9ea');
  }

  function ensurePanel(): HTMLElement {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-label', copy().outline);
    themeColors(panel);
    document.body.append(panel);
    return panel;
  }

  function scheduleRender(): void {
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      render();
    }, 400);
  }

  function render(): void {
    const editorEl = enabled ? editor() : null;
    if (!editorEl) {
      document.getElementById(PANEL_ID)?.remove();
      return;
    }
    const c = copy();
    const panel = ensurePanel();
    panel.classList.toggle('is-collapsed', collapsed);
    const stats = textStats(editorText(editorEl));
    const outline = readOutline(editorEl);

    const head = document.createElement('div');
    head.className = 'fs-ap-head';
    const title = Object.assign(document.createElement('span'), {
      className: 'fs-ap-title',
      textContent: c.outline,
    });
    const statsEl = Object.assign(document.createElement('span'), {
      className: 'fs-ap-stats',
      textContent: c.stats(stats.cjk, stats.words, stats.minutes),
    });
    const importButton = document.createElement('button');
    importButton.type = 'button';
    importButton.title = c.importMd;
    importButton.setAttribute('aria-label', c.importMd);
    importButton.innerHTML = ICONS.import;
    importButton.addEventListener('click', importFile);
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.title = c.copyMd;
    copyButton.setAttribute('aria-label', c.copyMd);
    copyButton.innerHTML = ICONS.copy;
    copyButton.addEventListener('click', copyMarkdown);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.title = collapsed ? c.expand : c.collapse;
    toggle.setAttribute('aria-label', toggle.title);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.innerHTML = collapsed ? ICONS.up : ICONS.down;
    toggle.addEventListener('click', () => {
      collapsed = !collapsed;
      render();
    });
    head.append(title, statsEl, copyButton, importButton, toggle);

    const list = document.createElement('ol');
    for (const item of outline) {
      const li = document.createElement('li');
      li.className = item.level === 1 ? 'fs-ap-l1' : 'fs-ap-l2';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.text;
      button.title = item.text;
      button.addEventListener('click', () => {
        item.element.scrollIntoView({ block: 'center', behavior: 'smooth' });
        item.element.classList.remove('fs-ap-flash');
        void (item.element as HTMLElement).offsetWidth;
        item.element.classList.add('fs-ap-flash');
      });
      li.append(button);
      list.append(li);
    }
    panel.replaceChildren(head, list);
  }

  /** 每秒看一次：进出文章页、编辑器换了节点时重新挂监听（由页面巡检驱动）。 */
  function poll(): void {
    const editorEl = enabled ? editor() : null;
    if (editorEl !== observed) {
      observer?.disconnect();
      observed = editorEl;
      if (editorEl) {
        observer = new MutationObserver(() => {
          scheduleRender();
          scheduleBackup();
        });
        observer.observe(editorEl, { childList: true, subtree: true, characterData: true });
        // 打开一篇已有的文章也先存一份（X 那边的内容就是这一版）
        scheduleBackup();
      }
      render();
    }
  }

  function start(): void {
    if (started) return;
    started = true;
    ensureArticleStyles();
    document.addEventListener('paste', onPaste, true);
    document.addEventListener('keydown', onKeydown, true);
    // 标题框不在编辑器里，改标题也要备份
    document.addEventListener('input', onTitleInput, true);
    poll();
  }

  function onTitleInput(event: Event): void {
    if (enabled && (event.target as Element | null)?.matches?.(TITLE_SELECTOR)) scheduleBackup();
  }

  function setEnabled(next: boolean): void {
    enabled = next;
    poll();
    if (!enabled) document.getElementById(PANEL_ID)?.remove();
  }

  function stop(): void {
    started = false;
    document.removeEventListener('paste', onPaste, true);
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('input', onTitleInput, true);
    if (backupTimer) clearTimeout(backupTimer);
    observer?.disconnect();
    observer = null;
    observed = null;
    if (renderTimer) clearTimeout(renderTimer);
    if (toastTimer) clearTimeout(toastTimer);
    for (const id of [PANEL_ID, STYLE_ID, TOAST_ID]) document.getElementById(id)?.remove();
  }

  return { start, stop, setEnabled, render, tick: poll };
}
