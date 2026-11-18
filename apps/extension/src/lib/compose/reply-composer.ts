/**
 * 把一张图填进某条帖子的回复框，**不替用户点「回复」**。
 *
 * 这是「AI 味」判定卡上的「填入回复框」：打开这条帖子的回复框、把报告图粘进去，
 * 图片上传完成就收手。发不发表决权始终在用户手上（和 docs/16 §6 的
 * 「发帖、排期永远由你点最后一下」同口径，扩展不替你公开发言）。
 *
 * 粘贴用合成 ClipboardEvent + DataTransfer：X 的推文框和文章编辑器都是 Draft.js，
 * 文章编辑器上实测过同一条路能触发官方上传（见 article-images.ts）。推文框的
 * 粘贴处理没真机验证过，所以再加一条兜底：直接往 X 自己的 file input 里塞文件
 * 并派发 change（媒体按钮背后的同一个入口）。
 */

import { extractTweetIdentity, QUOTE_CARD_SELECTOR, tweetSelectors } from '@feedsieve/x-adapter';

export type FillReplyReason =
  'no_article' | 'no_reply_button' | 'no_editor' | 'draft_not_empty' | 'upload_timeout';

export type FillReplyOutcome = { ok: true } | { ok: false; reason: FillReplyReason };

/**
 * 推文框正文（多段串推是 tweetTextarea_0 / _1 …）。
 *
 * 必须带 contenteditable：真实 X 上同一个前缀还挂着 `tweetTextarea_0_label`、
 * `tweetTextarea_0RichTextInputContainer` 两个不可编辑的容器（2026-11-11 在
 * 真实回复框里核实），光按前缀匹配会拿到壳子，focus / paste 全落空。
 */
const EDITOR_SELECTOR =
  ':is([data-testid^="tweetTextarea_"], [role="textbox"])[contenteditable="true"]';
/**
 * 附件预览区。实测它**不是常驻节点**：只有上传成功后才被 X 插进 DOM
 * （2026-11-11 真实回复框：塞文件前 0 个 attachments，6 秒后出现 1 个并带 img）。
 * 无 data-testid 的新版回复框同时兼容刚挂载的 blob 预览图或媒体 CDN 预览图。
 */
const ATTACHMENT_SELECTOR =
  '[data-testid="attachments"] img, img[src^="blob:"], img[src*="pbs.twimg.com/media/"]';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 等文件入口的时限。X 的文件入口和编辑器几乎同时挂上（实测差 0ms，但可能落后一拍），
 * 给一点余量就够；等太久等于把「没有文件入口、该走粘贴」的常见路径也拖慢。
 */
const INPUT_WAIT_MS = 1_200;

async function waitFor<T>(
  probe: () => T | null | undefined | false,
  timeoutMs: number,
  wait: (ms: number) => Promise<void>,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() >= deadline) return null;
    await wait(120);
  }
}

const POST_ID_RE = /\/status\/(\d+)/;
const IN_REPLY_TO_RE = /[?&]in_reply_to=(\d+)/;

function isQuoted(element: Element, article: Element): boolean {
  for (let node: Element | null = element; node && node !== article; node = node.parentElement) {
    if (node.tagName === 'ARTICLE') return true;
    if (node.matches(QUOTE_CARD_SELECTOR) && node.querySelector(tweetSelectors.statusLink)) {
      return true;
    }
  }
  return false;
}

function findReplyButton(article: Element): HTMLElement | null {
  for (const node of article.querySelectorAll<HTMLElement>(
    '[data-testid="reply"], [data-engagement-action="reply"] a, [data-engagement-action="reply"] button, button[data-engagement-action="reply"], a[data-engagement-action="reply"]',
  )) {
    if (!isQuoted(node, article)) return node;
  }
  return null;
}

/** 按帖子 ID 找时间线 / 详情页里的那一条（X 重渲染会换节点，所以每次现找）。 */
export function findArticle(postId: string): HTMLElement | null {
  for (const article of document.querySelectorAll<HTMLElement>(tweetSelectors.article)) {
    const identityId = extractTweetIdentity(article)?.postId;
    if (identityId) {
      if (identityId === postId) return article;
      continue;
    }
    // 极简占位结构兜底：只看正文与引用卡片之外的状态链接和本帖回复动作链接，
    // 防止引用了目标帖或正文里贴了目标帖链接的其它推文被误认成目标。
    const own = [...article.querySelectorAll(tweetSelectors.statusLink)].some(
      (anchor) =>
        !isQuoted(anchor, article) &&
        !anchor.closest(`${tweetSelectors.text}, [data-testid="card.wrapper"]`) &&
        POST_ID_RE.exec(anchor.getAttribute('href') ?? '')?.[1] === postId,
    );
    if (own) return article;
    const replyOwn = [
      ...article.querySelectorAll('[data-engagement-action="reply"] a[href*="in_reply_to="]'),
    ].some(
      (anchor) =>
        !isQuoted(anchor, article) &&
        IN_REPLY_TO_RE.exec(anchor.getAttribute('href') ?? '')?.[1] === postId,
    );
    if (replyOwn) return article;
  }
  return null;
}

function countAttachments(root: ParentNode): number {
  return [...root.querySelectorAll(ATTACHMENT_SELECTOR)].filter(
    (img) => !img.closest('[data-testid="Tweet-User-Avatar"], .x-avatar'),
  ).length;
}

function imageInput(host: ParentNode): HTMLInputElement | null {
  return (
    host.querySelector<HTMLInputElement>('input[type="file"][data-testid="fileInput"]') ??
    host.querySelector<HTMLInputElement>('input[type="file"][accept*="image"]')
  );
}

function isComposerBoundary(node: Element, editor: HTMLElement, article: Element): boolean {
  if (node === document.body || node === document.documentElement) return true;
  if (
    node.matches('main, aside, nav, [data-testid="primaryColumn"], [data-testid="sidebarColumn"]')
  ) {
    return true;
  }
  if (article.contains(editor)) return node === article.parentElement;
  return node.querySelector('article') !== null;
}

/**
 * 回复框的宿主：详情页里是内联展开（没有 dialog），其它地方是弹窗。
 * 往上找到第一个带附件区或文件入口的祖先，找不到就退到编辑器本身。
 *
 * 走到 body / 主栏 / 跨出当前回复框容器必须停：整页里装着侧栏「发帖」框的同款 file input，
 * 继续往上会命中它，那样图就会贴进用户正在写的**新帖草稿**而不是回复框。
 */
function locateHost(editor: HTMLElement, article: Element): ParentNode {
  const dialog = editor.closest('[role="dialog"]');
  if (dialog) return dialog;
  for (let node = editor.parentElement; node; node = node.parentElement) {
    if (isComposerBoundary(node, editor, article)) break;
    if (
      node.querySelector('[data-testid="attachments"]') ||
      node.querySelector('input[type="file"]')
    ) {
      return node;
    }
  }
  return editor;
}

function composerRoot(editor: HTMLElement, article: Element): ParentNode {
  const dialog = editor.closest('[role="dialog"]');
  if (dialog) return dialog;
  const cell = article.closest('[data-testid="cellInnerDiv"]');
  if (cell && cell.contains(editor)) return cell;
  const host = locateHost(editor, article);
  if (host !== editor) return host;
  let top: HTMLElement = editor;
  for (let node = editor.parentElement; node; node = node.parentElement) {
    if (isComposerBoundary(node, editor, article)) break;
    top = node;
  }
  return top !== editor ? top : (editor.parentElement ?? editor);
}

function findFocusedInlineEditor(article: Element): HTMLElement | null {
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    active.matches(EDITOR_SELECTOR) &&
    !active.closest('aside, nav, [data-testid="sidebarColumn"]')
  ) {
    const ownerArticle = active.closest('article');
    if (!ownerArticle || ownerArticle === article) return active;
  }
  return null;
}

function findDetailInlineEditor(article: Element, postId: string): HTMLElement | null {
  if (!new RegExp(`/status/${postId}(?:$|[/?#])`).test(location.pathname)) return null;
  const column =
    article.closest('main, [data-testid="primaryColumn"]') ??
    document.querySelector('main, [data-testid="primaryColumn"]');
  if (!column) return null;
  return (
    [...column.querySelectorAll<HTMLElement>(EDITOR_SELECTOR)].find(
      (node) =>
        !node.closest('aside, nav, [data-testid="sidebarColumn"], [role="dialog"]') &&
        (!node.closest('article') || node.closest('article') === article) &&
        Boolean(article.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING),
    ) ?? null
  );
}

/** 回复框里已经有正文：绝不往上叠图，也不碰用户正在写的内容。 */
function draftIsEmpty(editor: HTMLElement): boolean {
  return (editor.textContent ?? '').trim() === '';
}

function makeFile(blob: Blob, filename: string): File {
  try {
    return new File([blob], filename, { type: blob.type || 'image/png' });
  } catch {
    // 极老的 Firefox 没有 File 构造器：用 Blob 顶上，X 只看 type 和内容
    const fallback = blob as Blob & { name?: string };
    fallback.name = filename;
    return fallback as File;
  }
}

/** 走 X 自己的 file input：媒体上传按钮背后就是它，change 事件会真的上传。 */
function attachViaInput(input: HTMLInputElement, file: File): boolean {
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

/** 合成一次粘贴：Draft.js 收到带文件的 clipboardData 会走自己的上传流程。 */
function attachViaPaste(editor: HTMLElement, file: File): boolean {
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    editor.focus();
    editor.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export interface FillReplyOptions {
  postId: string;
  blob: Blob;
  filename?: string;
  /** 单步等待上限（打开回复框 / 图片上传各一份） */
  waitMs?: number;
  /** 轮询间隔（测试里调小） */
  wait?: (ms: number) => Promise<void>;
}

/**
 * 打开这条帖子的回复框并填入图片。返回 ok 表示图片已经出现在回复框的附件区，
 * 此时不要替用户点发送——继续等用户自己写正文、点「回复」。
 */
export async function fillReplyComposer(options: FillReplyOptions): Promise<FillReplyOutcome> {
  const wait = options.wait ?? sleep;
  const waitMs = options.waitMs ?? 10_000;
  const article = findArticle(options.postId);
  if (!article) return { ok: false, reason: 'no_article' };
  const replyButton = findReplyButton(article);
  if (!replyButton) return { ok: false, reason: 'no_reply_button' };

  // 点之前先把现有编辑器 / 对话框记下来：点完出现的那一个才是这条帖子的回复框
  const editorsBefore = new Set(document.querySelectorAll(EDITOR_SELECTOR));
  const dialogsBefore = new Set(document.querySelectorAll('[role="dialog"]'));
  replyButton.click();

  const cell = article.closest('[data-testid="cellInnerDiv"]');
  let polls = 0;
  const editor = await waitFor(
    () => {
      const tickIndex = polls++;
      const fresh = [...document.querySelectorAll<HTMLElement>(EDITOR_SELECTOR)].filter(
        (node) => !editorsBefore.has(node),
      );
      const freshDialog = [...document.querySelectorAll('[role="dialog"]')].find(
        (node) => !dialogsBefore.has(node),
      );
      const opened = freshDialog?.querySelector<HTMLElement>(EDITOR_SELECTOR) ?? null;
      if (opened) return opened;
      // 已经弹出了新对话框、只是对话框里的编辑器还没挂好：继续等对话框，别退回背景里的内联框
      if (freshDialog) return null;
      // 没有新弹窗时只认「新出现、且不在侧栏/导航里」的内联回复编辑器：
      // 页面上原本就挂着的侧栏发帖框已在 editorsBefore 里排除。
      const scoped = cell
        ? fresh.find((node) => cell.contains(node))
        : fresh.find(
            (node) =>
              node.closest('[role="dialog"]') !== null ||
              !node.closest('aside, nav, [data-testid="sidebarColumn"]'),
          );
      if (scoped) return scoped;
      // 详情页的回复框是内联展开的，而且可能本来就开着：点一下只是把焦点还给它。
      // 新版 X 无 cellInnerDiv 时内联框位于 article 之外的兄弟容器里，先给异步弹窗留一拍，
      // 再回退识别焦点或详情页主帖正下方的内联编辑器。
      const direct =
        article.querySelector<HTMLElement>(EDITOR_SELECTOR) ??
        cell?.querySelector<HTMLElement>(EDITOR_SELECTOR) ??
        findFocusedInlineEditor(article);
      if (direct) return direct;
      return tickIndex >= 1 || waitMs < 120
        ? findDetailInlineEditor(article, options.postId)
        : null;
    },
    waitMs,
    wait,
  );
  if (!editor) return { ok: false, reason: 'no_editor' };

  // 用户（或 X 的草稿恢复）已经在框里写了字：停手。图叠上去会和正文混在一起，
  // 粘贴兜底还可能在光标处插入，等于改用户正在写的东西。
  if (!draftIsEmpty(editor)) return { ok: false, reason: 'draft_not_empty' };

  // 详情页折叠态的内联回复框要聚焦后才挂载工具栏与 fileInput
  editor.focus();
  const scope = () => composerRoot(editor, article);
  const file = makeFile(options.blob, options.filename ?? 'ai-flavor.png');
  const before = countAttachments(scope());
  const attached = () => countAttachments(scope()) > before;

  // 编辑器先渲染、文件入口随后才挂上（真实 X 上观察到两者可能差一拍）。
  // 每一轮轮询重新从编辑器向上定位宿主，避免首拍未挂 fileInput 时把宿主锁死在编辑器节点自身。
  // 只给这段一个短时限：文件入口没等到的常态就是该走粘贴兜底，不能在这里耗满 10 秒。
  const input = await waitFor(
    () => imageInput(locateHost(editor, article)),
    Math.min(waitMs, INPUT_WAIT_MS),
    wait,
  );

  // 有 X 自己的文件入口就先走它（媒体按钮背后就是它，最接近原生行为）。
  // 两条路都试会在上传慢时塞进两张图，所以只挑一条。
  // 真实 X 上这条路已经实测能触发上传并长出 attachments（2026-11-11）。
  if (input) {
    if (!attachViaInput(input, file)) return { ok: false, reason: 'upload_timeout' };
    return (await waitFor(attached, waitMs, wait))
      ? { ok: true }
      : { ok: false, reason: 'upload_timeout' };
  }
  if (attachViaPaste(editor, file)) {
    return (await waitFor(attached, waitMs, wait))
      ? { ok: true }
      : { ok: false, reason: 'upload_timeout' };
  }
  return { ok: false, reason: 'upload_timeout' };
}
