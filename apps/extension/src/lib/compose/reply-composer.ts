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

import { tweetSelectors } from '@feedsieve/x-adapter';

export type FillReplyReason = 'no_article' | 'no_reply_button' | 'no_editor' | 'upload_timeout';

export type FillReplyOutcome = { ok: true } | { ok: false; reason: FillReplyReason };

/** 推文框正文（多段串推是 tweetTextarea_0 / _1 …） */
const EDITOR_SELECTOR = '[data-testid^="tweetTextarea_"]';
/** 回复框里的媒体预览区：粘贴/选择文件成功后 X 会往里放 img */
const ATTACHMENT_SELECTOR = '[data-testid="attachments"] img';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

/** 按帖子 ID 找时间线 / 详情页里的那一条（X 重渲染会换节点，所以每次现找）。 */
export function findArticle(postId: string): HTMLElement | null {
  for (const article of document.querySelectorAll<HTMLElement>(tweetSelectors.article)) {
    if (article.querySelector(`a[href*="/status/${postId}"]`)) return article;
  }
  return null;
}

function countAttachments(root: ParentNode): number {
  return root.querySelectorAll(ATTACHMENT_SELECTOR).length;
}

function imageInput(host: ParentNode): HTMLInputElement | null {
  return (
    host.querySelector<HTMLInputElement>('input[type="file"][data-testid="fileInput"]') ??
    host.querySelector<HTMLInputElement>('input[type="file"][accept*="image"]')
  );
}

/**
 * 回复框的宿主：详情页里是内联展开（没有 dialog），其它地方是弹窗。
 * 往上找到第一个带附件区或文件入口的祖先，找不到就退到编辑器本身——
 * 绝不能退到 document，否则会抓到侧栏主发帖框的 file input。
 */
function locateHost(editor: HTMLElement): ParentNode {
  const dialog = editor.closest('[role="dialog"]');
  if (dialog) return dialog;
  for (let node = editor.parentElement; node; node = node.parentElement) {
    if (
      node.querySelector('[data-testid="attachments"]') ||
      node.querySelector('input[type="file"]')
    ) {
      return node;
    }
  }
  return editor;
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
  const replyButton = article.querySelector<HTMLElement>('[data-testid="reply"]');
  if (!replyButton) return { ok: false, reason: 'no_reply_button' };

  // 点之前先把现有编辑器 / 对话框记下来：点完出现的那一个才是这条帖子的回复框
  const editorsBefore = new Set(document.querySelectorAll(EDITOR_SELECTOR));
  const dialogsBefore = new Set(document.querySelectorAll('[role="dialog"]'));
  replyButton.click();

  const editor = await waitFor(
    () => {
      const fresh = [...document.querySelectorAll<HTMLElement>(EDITOR_SELECTOR)].filter(
        (node) => !editorsBefore.has(node),
      );
      const freshDialog = [...document.querySelectorAll('[role="dialog"]')].find(
        (node) => !dialogsBefore.has(node),
      );
      const opened = freshDialog?.querySelector<HTMLElement>(EDITOR_SELECTOR) ?? fresh[0] ?? null;
      if (opened) return opened;
      // 详情页的回复框是内联展开的，而且可能本来就开着：点一下只是把焦点还给它。
      // 这时不会有新节点，用这条帖子自己（或它所在的格子里）的编辑器顶上。
      return (
        article.querySelector<HTMLElement>(EDITOR_SELECTOR) ??
        article
          .closest('[data-testid="cellInnerDiv"]')
          ?.querySelector<HTMLElement>(EDITOR_SELECTOR) ??
        null
      );
    },
    waitMs,
    wait,
  );
  if (!editor) return { ok: false, reason: 'no_editor' };

  const host = locateHost(editor);
  const file = makeFile(options.blob, options.filename ?? 'ai-flavor.png');
  const before = countAttachments(host);
  const attached = () => countAttachments(host) > before;

  // 有 X 自己的文件入口就先走它（媒体按钮背后就是它，最接近原生行为）。
  // 两条路都试会在上传慢时塞进两张图，所以只挑一条。
  const input = imageInput(host);
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
