/**
 * Markdown → X 文章编辑器能吃下的 HTML（纯函数）。
 *
 * X 文章编辑器是 Draft.js，粘贴 HTML 时（2026-10-31 / 11-01 实测）认：
 * `<h1>`（「标题」）、`<h2>`（「副标题」）、段落、`<strong>` `<em>` `<s>`、`<a href>`、
 * `<ul>/<ol><li>`、`<blockquote>`（里面的 `<br>` 保留成换行）。`<h3>` 以下、`<pre>`、`<code>`、`<hr>`、
 * 表格、图片粘贴后都会变成普通段落或丢掉，嵌套列表会并进上一项，所以这里先换成它认的写法：
 * - `#`（文章标题之外）/ `##` → `<h1>`；`###` → `<h2>`；`####` 及以下 → 加粗段落
 * - 嵌套列表拍平成同一层
 * - 开头的 `# 标题` 或 frontmatter 的 `title:` → 文章标题（单独返回，填进标题框）
 * - 代码块 → 引用块，逐行保留缩进
 * - 分隔线 → `———` 段落；表格 → 表头加粗、每行一段，列之间用「 | 」
 * - 图片 → 指向图片地址的链接（X 不收外链图片，要在编辑器里手动插入）
 * 思路参考 xPoster（MIT）的转换表。
 */

export interface ArticleConversion {
  title: string | null;
  html: string;
  /** 转换后正文的纯文本（统计字数用） */
  text: string;
}

const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeUrl(raw: string): string | null {
  const url = raw.trim().replace(/^<|>$/g, '');
  return /^(https?:\/\/|mailto:)/i.test(url) ? url : null;
}

/** 行内：转义 → 代码 → 图片 → 链接 → 加粗 / 斜体 / 删除线。 */
export function inlineToHtml(source: string): string {
  const slots: string[] = [];
  const hold = (html: string): string => {
    slots.push(html);
    return `\ue000${slots.length - 1}\ue001`;
  };
  let text = source.replace(/[\ue000\ue001]/g, '');
  // 行内代码：X 没有等宽样式，保留原文、去掉反引号，里面的 * _ 不当格式
  text = text.replace(/`([^`]+)`/g, (_m, code: string) => hold(escapeHtml(code)));
  // 图片
  text = text.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_m, alt: string, src: string) => {
      const url = safeUrl(src);
      const label = `🖼 ${alt.trim() || '图片'}`;
      return hold(
        url ? `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>` : escapeHtml(label),
      );
    },
  );
  // 链接
  text = text.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_m, label: string, href: string) => {
      const url = safeUrl(href);
      const inner = inlineFormat(escapeHtml(label));
      return hold(url ? `<a href="${escapeHtml(url)}">${inner}</a>` : inner);
    },
  );
  // <https://…> 自动链接
  text = text.replace(/<(https?:\/\/[^>\s]+)>/g, (_m, href: string) =>
    hold(`<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>`),
  );
  let html = inlineFormat(escapeHtml(text));
  html = html.replace(/\ue000(\d+)\ue001/g, (_m, index: string) => slots[Number(index)] ?? '');
  return html;
}

function inlineFormat(html: string): string {
  return (
    html
      .replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>')
      .replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
      // 下划线斜体只认两边不是字母数字的（snake_case 不误伤）
      .replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\w])/g, '$1<em>$2</em>')
  );
}

/** 去掉 HTML 标签，统计用 */
function plain(html: string): string {
  return html
    .replace(/<br>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** 段落里的软换行：中文之间直接接上，西文之间补一个空格。 */
function joinLines(lines: string[]): string {
  let out = '';
  for (const raw of lines) {
    const hard = /( {2,}|\\)$/.test(raw);
    const line = raw.replace(/( {2,}|\\)$/, '').trim();
    if (!out) out = line;
    else if (out.endsWith('\n')) out += line;
    else if (CJK.test(out.slice(-1)) || CJK.test(line.charAt(0))) out += line;
    else out += ` ${line}`;
    if (hard) out += '\n';
  }
  return out;
}

function paragraph(lines: string[]): string {
  return joinLines(lines)
    .split('\n')
    .map((part) => inlineToHtml(part))
    .join('<br>');
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function stripFrontmatter(lines: string[]): { title: string | null; rest: string[] } {
  if (lines[0]?.trim() !== '---') return { title: null, rest: lines };
  const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line));
  if (end < 0) return { title: null, rest: lines };
  let title: string | null = null;
  for (const line of lines.slice(1, end)) {
    const match = /^title\s*:\s*(.+)$/i.exec(line.trim());
    if (match) title = match[1]!.trim().replace(/^["']|["']$/g, '');
  }
  return { title, rest: lines.slice(end + 1) };
}

export function markdownToArticle(source: string): ArticleConversion {
  const all = source.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const front = stripFrontmatter(all);
  let title = front.title;
  const lines = front.rest;
  const blocks: string[] = [];
  let i = 0;
  let sawContent = false;

  const isBlank = (line: string | undefined) => line === undefined || line.trim() === '';
  const startsBlock = (line: string, next: string | undefined) =>
    FENCE.test(line) ||
    HEADING.test(line) ||
    HR.test(line) ||
    QUOTE.test(line) ||
    LIST.test(line) ||
    (line.includes('|') && next !== undefined && TABLE_SEP.test(next));

  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(marker)) code.push(lines[i++]!);
      i++;
      // 去掉公共缩进，行首空格换成 &nbsp;（Draft 会吞掉普通空格）
      const indent = Math.min(...code.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length));
      const body = code
        .map((l) => l.slice(Number.isFinite(indent) ? indent : 0))
        .map((l) => {
          const lead = /^ */.exec(l)![0].length;
          return '&nbsp;'.repeat(lead) + escapeHtml(l.slice(lead));
        })
        .join('<br>');
      if (body.trim()) blocks.push(`<blockquote>${body}</blockquote>`);
      sawContent = true;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const text = heading[2]!;
      i++;
      if (level === 1 && !sawContent && title === null) {
        title = plain(inlineToHtml(text)).trim();
        continue;
      }
      const inner = inlineToHtml(text);
      blocks.push(
        level <= 2
          ? `<h1>${inner}</h1>`
          : level === 3
            ? `<h2>${inner}</h2>`
            : `<p><strong>${inner}</strong></p>`,
      );
      sawContent = true;
      continue;
    }

    if (HR.test(line)) {
      blocks.push('<p>———</p>');
      i++;
      sawContent = true;
      continue;
    }

    if (QUOTE.test(line)) {
      const groups: string[][] = [[]];
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        const inner = QUOTE.exec(lines[i]!)![1]!;
        if (inner.trim() === '') groups.push([]);
        else groups[groups.length - 1]!.push(inner.replace(/^#{1,6}\s+/, ''));
        i++;
      }
      for (const group of groups)
        if (group.length) blocks.push(`<blockquote>${paragraph(group)}</blockquote>`);
      sawContent = true;
      continue;
    }

    if (LIST.test(line)) {
      const ordered = /\d/.test(LIST.exec(line)![2]!);
      const items: string[][] = [];
      while (i < lines.length) {
        const current = lines[i]!;
        const item = LIST.exec(current);
        if (item) {
          if (/\d/.test(item[2]!) !== ordered && items.length > 0 && item[1]!.length === 0) break;
          let text = item[3]!;
          text = text.replace(/^\[ \]\s+/, '☐ ').replace(/^\[[xX]\]\s+/, '☑ ');
          items.push([text]);
          i++;
        } else if (!isBlank(current) && /^\s{2,}/.test(current) && items.length) {
          items[items.length - 1]!.push(current);
          i++;
        } else if (isBlank(current) && LIST.test(lines[i + 1] ?? '')) {
          i++;
        } else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      blocks.push(
        `<${tag}>${items.map((item) => `<li>${paragraph(item)}</li>`).join('')}</${tag}>`,
      );
      sawContent = true;
      continue;
    }

    if (line.includes('|') && TABLE_SEP.test(lines[i + 1] ?? '')) {
      const head = splitRow(line);
      i += 2;
      blocks.push(`<p><strong>${head.map(inlineToHtml).join(' | ')}</strong></p>`);
      while (i < lines.length && lines[i]!.includes('|') && !isBlank(lines[i])) {
        blocks.push(`<p>${splitRow(lines[i]!).map(inlineToHtml).join(' | ')}</p>`);
        i++;
      }
      sawContent = true;
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      (para.length === 0 || !startsBlock(lines[i]!, lines[i + 1]))
    ) {
      para.push(lines[i]!);
      i++;
    }
    blocks.push(`<p>${paragraph(para)}</p>`);
    sawContent = true;
  }

  const html = blocks.join('');
  return {
    title: title && title.length > 0 ? title.slice(0, 100) : null,
    html,
    text: blocks.map(plain).join('\n'),
  };
}

/**
 * 剪贴板里的纯文本像不像 Markdown：至少一行块级标记（标题、列表、引用、代码块、表格、分隔线），
 * 或者行内有链接 / 加粗。普通一句话不转，交给 X 自己粘贴。
 */
export function looksLikeMarkdown(text: string): boolean {
  if (!text || text.length > 200_000) return false;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let block = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (
      HEADING.test(line) ||
      FENCE.test(line) ||
      QUOTE.test(line) ||
      /^\s*([-*+]|\d{1,9}[.)])\s+\S/.test(line) ||
      (line.includes('|') && TABLE_SEP.test(lines[i + 1] ?? ''))
    ) {
      block++;
    }
  }
  if (block >= 1 && lines.length >= 2) return true;
  if (HEADING.test(lines[0] ?? '') || FENCE.test(lines[0] ?? '')) return true;
  return /\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*\n]+\*\*|~~[^~\n]+~~/.test(text);
}

/** HTML 剪贴板是不是已经带了结构（从网页、Word 复制来的）：带了就让 X 自己处理。 */
export function htmlHasStructure(html: string): boolean {
  return /<(h[1-6]|ul|ol|li|blockquote|strong|b|em|i|a\s|table)\b/i.test(html);
}

export interface TextStats {
  /** 汉字数（含全角标点之外的 CJK 字符） */
  cjk: number;
  /** 西文词数 */
  words: number;
  /** 预计阅读分钟（中文 400 字 / 分，英文 200 词 / 分），至少 1 */
  minutes: number;
}

export function textStats(text: string): TextStats {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const words = (
    text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').match(/[A-Za-z0-9][\w'’-]*/g) ?? []
  ).length;
  const minutes = Math.max(1, Math.round(cjk / 400 + words / 200));
  return { cjk, words, minutes };
}
