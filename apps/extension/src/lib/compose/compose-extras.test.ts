// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { articleToMarkdown } from './article-export';
import { markdownToArticle } from './markdown-article';
import { draftKey, reduceBackups, tweetLength } from './schedule-store';
import { fillScheduleFields, findScheduleFields, readScheduleFields } from './compose-schedule';

describe('X 计字', () => {
  it('西文 1、中文 2、链接 23', () => {
    expect(tweetLength('hello')).toBe(5);
    expect(tweetLength('你好')).toBe(4);
    expect(tweetLength('看 https://example.com/a/very/long/path')).toBe(2 + 1 + 23);
  });

  it('草稿比对只看前 280 字、忽略首尾空白和换行写法', () => {
    expect(draftKey('  a\r\nb  ')).toBe('a\nb');
    expect(draftKey('x'.repeat(300))).toHaveLength(280);
  });
});

describe('文章备份', () => {
  const v = (savedAt: number, markdown: string, title = 't') => ({ savedAt, markdown, title });

  it('同样内容不记；10 分钟内合并成一版；超过 10 分钟新开一版；最多 5 版', () => {
    let list = reduceBackups([], 'a', v(0, 'one'));
    expect(reduceBackups(list, 'a', v(1000, 'one'))).toBe(list);
    list = reduceBackups(list, 'a', v(60_000, 'two'));
    expect(list[0]!.versions).toEqual([v(60_000, 'two')]);
    for (let i = 1; i <= 6; i++) list = reduceBackups(list, 'a', v(i * 11 * 60_000, `v${i}`));
    expect(list[0]!.versions.map((x) => x.markdown)).toEqual(['v6', 'v5', 'v4', 'v3', 'v2']);
  });

  it('最近改过的文章排最前，空文章不记', () => {
    let list = reduceBackups([], 'a', v(0, 'a'));
    list = reduceBackups(list, 'b', v(0, 'b'));
    expect(list.map((b) => b.id)).toEqual(['b', 'a']);
    expect(reduceBackups(list, 'c', v(0, '  ', ''))).toBe(list);
  });
});

describe('文章 → Markdown', () => {
  /** 按 X 文章编辑器的真实结构拼一段 */
  function editor(html: string): Element {
    document.body.innerHTML = `<div data-testid="composer">${html}</div>`;
    return document.querySelector('[data-testid="composer"]')!;
  }
  const span = (text: string, style = '') =>
    `<span data-offset-key="k"${style ? ` style="${style}"` : ''}><span data-text="true">${text}</span></span>`;
  const block = (tag: string, cls: string, inner: string) =>
    `<${tag} data-block="true" class="${cls}"><div class="public-DraftStyleDefault-block">${inner}</div></${tag}>`;

  it('标题、列表、引用、行内格式和链接', () => {
    const md = articleToMarkdown(
      editor(
        block('h1', 'longform-header-one', span('第一节')) +
          block(
            'div',
            'longform-unstyled',
            span('有 ') +
              span('加粗', 'font-weight: bold;') +
              span(' 和 ') +
              span('斜体', 'font-style: italic;') +
              `<a href="https://x.com">${span('链接')}</a>`,
          ) +
          block('li', 'longform-unordered-list-item public-DraftStyleDefault-depth0', span('一')) +
          block('li', 'longform-unordered-list-item public-DraftStyleDefault-depth0', span('二')) +
          block('li', 'longform-ordered-list-item public-DraftStyleDefault-depth0', span('甲')) +
          block('li', 'longform-ordered-list-item public-DraftStyleDefault-depth0', span('乙')) +
          block('blockquote', 'longform-blockquote', span('行一\n行二')) +
          block('h2', 'longform-header-two', span('小节')) +
          block('div', 'longform-unstyled', span('')),
      ),
      '我的文章',
    );
    expect(md).toBe(
      [
        '# 我的文章',
        '',
        '## 第一节',
        '',
        '有 **加粗** 和 *斜体*[链接](https://x.com)',
        '',
        '- 一',
        '- 二',
        '',
        '1. 甲',
        '2. 乙',
        '',
        '> 行一',
        '> 行二',
        '',
        '### 小节',
        '',
      ].join('\n'),
    );
  });

  it('导出再导入，标题层级和格式保持', () => {
    const source = '# 标题\n\n## 一\n\n正文 **粗**\n\n### 二\n\n- a\n- b\n';
    const html = markdownToArticle(source).html;
    expect(html).toBe(
      '<h1>一</h1><p>正文 <strong>粗</strong></p><h2>二</h2><ul><li>a</li><li>b</li></ul>',
    );
  });
});

describe('12 小时制的安排表', () => {
  function dialog12(): HTMLElement {
    const opts = (values: string[]) =>
      values.map((v) => `<option value="${v}">${v}</option>`).join('');
    const range = (a: number, b: number) =>
      Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
    const el = document.createElement('div');
    el.innerHTML = `
      <label id="a">Month</label><select aria-labelledby="a">${opts(range(1, 12))}</select>
      <label id="b">Day</label><select aria-labelledby="b">${opts(range(1, 31))}</select>
      <label id="c">Year</label><select aria-labelledby="c">${opts(['2026', '2027'])}</select>
      <label id="d">Hour</label><select aria-labelledby="d">${opts(range(1, 12))}</select>
      <label id="e">Minute</label><select aria-labelledby="e">${opts(range(0, 59))}</select>
      <label id="f">AM/PM</label><select aria-labelledby="f"><option value="AM">AM</option><option value="PM">PM</option></select>`;
    document.body.replaceChildren(el);
    return el;
  }

  it('下午 9:30 填成 9 + PM，读回来是 21:30', async () => {
    const el = dialog12();
    const at = new Date(2026, 10, 3, 21, 30).getTime();
    expect(await fillScheduleFields(el, at)).toBe(true);
    const fields = findScheduleFields(el)!;
    expect(fields.hour.value).toBe('9');
    expect(fields.meridiem!.value).toBe('PM');
    expect(readScheduleFields(fields)).toBe(at);
  });

  it('中午 12 点是 12 PM，午夜是 12 AM', async () => {
    const el = dialog12();
    expect(await fillScheduleFields(el, new Date(2026, 10, 3, 12, 0).getTime())).toBe(true);
    expect(findScheduleFields(el)!.hour.value).toBe('12');
    expect(findScheduleFields(el)!.meridiem!.value).toBe('PM');
    expect(await fillScheduleFields(el, new Date(2026, 10, 4, 0, 5).getTime())).toBe(true);
    expect(findScheduleFields(el)!.hour.value).toBe('12');
    expect(findScheduleFields(el)!.meridiem!.value).toBe('AM');
  });
});
