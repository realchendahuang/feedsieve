/**
 * 文章正文里的本地图片占位符 → X 编辑器里的图片对象。
 *
 * 背景：X 文章编辑器是 Draft.js，粘贴 HTML 只能得到文字/链接，`![...](images/x.png)`
 * 这类相对路径图片没有任何办法在转换阶段变成图片。路线图里的做法是「占位符替换法」：
 * 1. 转换时把本地图片写成占位段「🖼 图片 N：路径」；
 * 2. 用户在面板里选好本地图片文件；
 * 3. 把光标放到占位段，走 X 自己的「插入 › 媒体」上传入口（`input[type=file]` 的
 *    change 事件），图片会插到光标所在段落之后；
 * 4. 再把占位段清空并删掉，正文里就只剩图片对象。
 *
 * 这里的 DOM 步骤都是在 x.com 文章编辑器上实测出来的（2026-11-06）；X 改版后如果
 * 菜单/上传入口对不上，函数会抛错，由调用方降级成「保留占位符 + 提示手动插入」。
 */

import { parseImagePlaceholder } from './markdown-article';

export interface ImageSlot {
  /** 占位编号（1 起，与正文一致） */
  index: number;
  /** Markdown 里写的原始路径 */
  src: string;
  /** 文件名（匹配用户选择的图片用） */
  name: string;
  /** 占位符所在的 Draft 段落 */
  block: Element;
}

/** 扫正文里的占位段，按 DOM 顺序返回。 */
export function readImageSlots(root: ParentNode): ImageSlot[] {
  const slots: ImageSlot[] = [];
  for (const block of root.querySelectorAll('[data-block="true"]')) {
    const parsed = parseImagePlaceholder(block.textContent ?? '');
    if (parsed) slots.push({ ...parsed, block });
  }
  return slots;
}

export interface FileLike {
  name: string;
}

/**
 * 把用户选的文件配到占位符上：先按文件名（不含目录、不区分大小写）对上，
 * 剩下的按下标顺序补位。返回与 slots 等长的数组，没配到的为 null。
 */
export function matchImageFiles(
  slots: readonly FileLike[],
  files: readonly FileLike[],
): Array<number | null> {
  const byName = new Map<string, number[]>();
  files.forEach((file, index) => {
    const key = file.name.trim().toLowerCase();
    const list = byName.get(key);
    if (list) list.push(index);
    else byName.set(key, [index]);
  });
  const used = new Set<number>();
  const result: Array<number | null> = slots.map((slot) => {
    const key = slot.name.trim().toLowerCase();
    const candidates = byName.get(key);
    while (candidates?.length) {
      const index = candidates.shift()!;
      if (!used.has(index)) {
        used.add(index);
        return index;
      }
    }
    return null;
  });
  // 名字对不上的，按下标顺序补空位（用户只选了图、文件名被改过时的兜底）
  const remaining = files.map((_, index) => index).filter((index) => !used.has(index));
  for (let i = 0; i < result.length && remaining.length > 0; i += 1) {
    if (result[i] === null) result[i] = remaining.shift()!;
  }
  return result;
}

function dispatchSelectionChange(): void {
  document.dispatchEvent(new Event('selectionchange'));
}

function pressKey(target: HTMLElement, key: 'Backspace' | 'Delete'): void {
  const code = key === 'Backspace' ? 8 : 46;
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      code: key,
      keyCode: code,
      which: code,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function pressBackspace(target: HTMLElement): void {
  pressKey(target, 'Backspace');
}

function pressDelete(target: HTMLElement): void {
  pressKey(target, 'Delete');
}

/**
 * 把焦点还给 Draft 编辑器：面板按钮/文件选择框会把焦点拿走，Draft 收不到
 * selectionchange 就不会更新自己的选区，上传上来的图片会插到旧位置。
 */
function focusEditor(host: HTMLElement): void {
  host.focus();
}

/**
 * 合成一次鼠标点击，让 Draft 真的「选中」这段（只改 DOM 选区时它不一定同步
 * 内部 selection，删除类操作会被它忽略）。实测 mousedown/up/click 三步都发才稳。
 */
function clickBlock(host: HTMLElement, block: Element): void {
  focusEditor(host);
  const rect = block.getBoundingClientRect();
  const x = rect.x + Math.min(24, rect.width / 2);
  const y = rect.y + rect.height / 2;
  for (const type of ['mousedown', 'mouseup', 'click'] as const) {
    block.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        view: window,
      }),
    );
  }
}

/** 选中整段占位文字（Draft 通过 selectionchange 同步选区）。 */
function selectBlock(host: HTMLElement, block: Element): void {
  focusEditor(host);
  const range = document.createRange();
  range.selectNodeContents(block);
  const selection = getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
  dispatchSelectionChange();
}

/** 光标落到段落开头或末尾。 */
function caretToBlock(host: HTMLElement, block: Element, where: 'start' | 'end'): void {
  focusEditor(host);
  const range = document.createRange();
  range.selectNodeContents(block);
  range.collapse(where === 'start');
  const selection = getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
  dispatchSelectionChange();
}

/** 清掉占位段的文字（保留空段落，随后再删）。 */
function clearBlock(host: HTMLElement, block: Element): void {
  selectBlock(host, block);
  pressBackspace(host);
}

/**
 * 删掉已经空了的占位段。实测空段落后面跟着正文时，Backspace 并不掉（上一段是
 * 图片块，Draft 不合并），要用 Delete 把它并进下一段。
 */
/** 找一个 Draft 段落的前/后兄弟段落（段落外面还包着拖拽用的 div）。 */
function siblingBlock(block: Element, direction: 'previous' | 'next'): Element | null {
  let node: Element | null = block.parentElement;
  while (node) {
    node = direction === 'previous' ? node.previousElementSibling : node.nextElementSibling;
    if (!node) return null;
    const found = node.matches('[data-block="true"]')
      ? node
      : node.querySelector('[data-block="true"]');
    if (found) return found;
  }
  return null;
}

function removeEmptyBlock(host: HTMLElement, block: Element): void {
  if (!block.isConnected) return;
  if ((block.textContent ?? '').trim() !== '') return;
  const previous = siblingBlock(block, 'previous');
  const next = siblingBlock(block, 'next');
  clickBlock(host, block);
  caretToBlock(host, block, 'start');
  // 上一段是普通文字段落：Backspace 把空段落并进去（前面是图片时会把图片删掉，
  // 所以只认 DIV 文字段）；否则用 Delete 并进下一段。
  if (previous?.tagName === 'DIV' && !previous.querySelector('img')) {
    pressBackspace(host);
  } else if (next) {
    pressDelete(host);
  }
}

interface InsertOptions {
  host: HTMLElement;
  files: readonly File[];
  slots: readonly ImageSlot[];
  /** 轮询间隔（测试里可以调小） */
  sleep?: (ms: number) => Promise<void>;
  /** 单张图片上传等待上限 */
  uploadTimeoutMs?: number;
}

export interface InsertResult {
  inserted: number;
  failed: number;
  /** 没配到文件的占位符数量 */
  unmatched: number;
  /** 插完后正文里还剩几个占位符 */
  remaining: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(
  probe: () => T | null | undefined | false,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() >= deadline) return null;
    await sleep(120);
  }
}

function countImageBlocks(host: HTMLElement): number {
  return host.querySelectorAll('[data-block="true"] img').length;
}

async function insertOne(
  host: HTMLElement,
  slot: ImageSlot,
  file: File,
  sleep: (ms: number) => Promise<void>,
  uploadTimeoutMs: number,
): Promise<void> {
  // React 重渲染可能换掉段落节点：按占位编号重新找一次
  const current = readImageSlots(host).find((item) => item.index === slot.index) ?? slot;
  focusEditor(host);
  await sleep(120);
  // 先合成一次点击让 Draft 真的选中这段，再选中整段占位文字：
  // X 会把粘贴进来的图片放在这段**之前**（即图片原本的位置）
  clickBlock(host, current.block);
  await sleep(120);
  selectBlock(host, current.block);
  await sleep(120);
  const beforeImages = countImageBlocks(host);
  const transfer = new DataTransfer();
  transfer.items.add(file);
  host.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
  );
  const uploaded = await waitFor(() => countImageBlocks(host) > beforeImages, uploadTimeoutMs, sleep);
  if (!uploaded) throw new Error('image_not_inserted');
  await sleep(300);
  // 上传完成后 React 会重渲染，旧节点可能已经不在文档里：按占位编号重新找
  const target = readImageSlots(host).find((item) => item.index === slot.index)?.block;
  if (!target) return;
  // 占位段还在图片后面：先清文字，再删空段落
  clickBlock(host, target);
  await sleep(150);
  clearBlock(host, target);
  await sleep(180);
  if ((target.textContent ?? '').trim() !== '') {
    const retry = readImageSlots(host).find((item) => item.index === slot.index)?.block;
    if (retry) {
      clickBlock(host, retry);
      await sleep(150);
      clearBlock(host, retry);
      await sleep(180);
    }
  }
  removeEmptyBlock(host, target);
}

/**
 * 把选中的图片插到占位符位置。**一次只插一张**：Draft 连续插入时重渲染会让
 * 第二张的选区/占位段错位，实测多张连插会丢图或合并段落；面板会保留剩余
 * 占位符和按钮，用户再点一次即可。失败不回滚——用户可以按 ⌘Z 撤销。
 */
export async function insertLocalImages(options: InsertOptions): Promise<InsertResult> {
  const { host, files, slots } = options;
  const sleep = options.sleep ?? defaultSleep;
  const uploadTimeoutMs = options.uploadTimeoutMs ?? 15_000;
  const matched = matchImageFiles(slots, files);
  const index = matched.findIndex((value) => value !== null);
  const remaining = () => readImageSlots(host).length;
  if (index < 0) {
    return { inserted: 0, failed: 0, unmatched: slots.length, remaining: remaining() };
  }
  const file = files[matched[index]!]!;
  try {
    await insertOne(host, slots[index]!, file, sleep, uploadTimeoutMs);
    return {
      inserted: 1,
      failed: 0,
      unmatched: slots.length - 1,
      remaining: remaining(),
    };
  } catch {
    return { inserted: 0, failed: 1, unmatched: slots.length - 1, remaining: remaining() };
  }
}
