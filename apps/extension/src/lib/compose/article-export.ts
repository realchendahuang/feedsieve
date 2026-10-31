/**
 * X 文章编辑器（Draft.js）当前内容 → Markdown：「复制为 Markdown」和本机备份共用。
 *
 * Draft 渲染出的结构（2026-10-31 实测）：每段是 `[data-block="true"]`，标签 / class 表示类型
 * （h1 = 标题、h2 = 副标题、`longform-unordered-list-item`、`longform-ordered-list-item`、blockquote、
 * 其余是正文）；段里的文字在 `span[data-offset-key]`，加粗 / 斜体 / 删除线写在它的 style 上，
 * 链接是包在外面的 `<a href>`。
 */

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]])/g, '\\$1');
}

function wrap(text: string, style: string): string {
  if (!text.trim()) return text;
  // 记号要贴着文字，首尾空白放在外面
  const lead = /^\s*/.exec(text)![0];
  const tail = /\s*$/.exec(text)![0];
  let core = text.slice(lead.length, text.length - tail.length);
  if (/line-through/.test(style)) core = `~~${core}~~`;
  if (/italic/.test(style)) core = `*${core}*`;
  if (/bold|font-weight:\s*[6-9]00/.test(style)) core = `**${core}**`;
  return lead + core + tail;
}

function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeMarkdown(node.textContent ?? '');
  if (!(node instanceof Element)) return '';
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') ?? '';
    const label = [...node.childNodes].map(inlineMarkdown).join('');
    return /^(https?:|mailto:)/i.test(href) ? `[${label}](${href})` : label;
  }
  if (node.matches('span[data-offset-key]') && node.querySelector('[data-text="true"]')) {
    return wrap(escapeMarkdown(node.textContent ?? ''), node.getAttribute('style') ?? '');
  }
  return [...node.childNodes].map(inlineMarkdown).join('');
}

type BlockKind = 'h1' | 'h2' | 'ul' | 'ol' | 'quote' | 'p';

function kindOf(block: Element): BlockKind {
  const tag = block.tagName;
  const cls = block.className;
  if (tag === 'H1' || /header-one/.test(cls)) return 'h1';
  if (tag === 'H2' || /header-two/.test(cls)) return 'h2';
  if (/unordered-list-item/.test(cls)) return 'ul';
  if (/ordered-list-item/.test(cls)) return 'ol';
  if (tag === 'BLOCKQUOTE' || /blockquote/.test(cls)) return 'quote';
  return 'p';
}

/** 列表缩进：Draft 用 public-DraftStyleDefault-depthN 表示层级 */
function depthOf(block: Element): number {
  const match = /DraftStyleDefault-depth(\d)/.exec(block.className);
  return match ? Number(match[1]) : 0;
}

export function articleToMarkdown(editor: Element, title = ''): string {
  const out: string[] = [];
  if (title.trim()) out.push(`# ${title.trim()}`);
  let previous: BlockKind | null = null;
  let counter = 0;
  for (const block of editor.querySelectorAll('[data-block="true"]')) {
    const kind = kindOf(block);
    const text = inlineMarkdown(block).replace(/\u200b/g, '');
    if (kind !== 'ol') counter = 0;
    const indent = '  '.repeat(depthOf(block));
    let line: string;
    switch (kind) {
      case 'h1':
        line = `## ${text.trim()}`;
        break;
      case 'h2':
        line = `### ${text.trim()}`;
        break;
      case 'ul':
        line = `${indent}- ${text.trim()}`;
        break;
      case 'ol':
        counter += 1;
        line = `${indent}${counter}. ${text.trim()}`;
        break;
      case 'quote':
        line = text
          .split('\n')
          .map((part) => `> ${part}`)
          .join('\n');
        break;
      default:
        // 段内软换行用行尾两个空格保住
        line = text.split('\n').join('  \n');
    }
    if (kind === 'p' && !text.trim()) {
      previous = kind;
      continue;
    }
    // 同一个列表的项之间不空行，其余段落之间空一行
    const sameList = (kind === 'ul' || kind === 'ol') && previous === kind;
    out.push(sameList ? `\n${line}` : `\n\n${line}`);
    previous = kind;
  }
  return out.join('').replace(/^\n+/, '').trim() + '\n';
}
