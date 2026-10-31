// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  fillScheduleFields,
  findScheduleFields,
  readScheduleFields,
  roundUp5,
} from './compose-schedule';
import { pasteHtml, readOutline } from './article-editor';

/** 按 2026-10-31 实测的 X「安排表」结构：五个带标签的下拉框，月 / 日 / 年 / 时 / 分。 */
function scheduleDialog(): HTMLElement {
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const select = (id: number, label: string, values: number[], selected: number) => `
    <label id="L${id}">${label}</label>
    <select id="SELECTOR_${id}" aria-labelledby="L${id}">
      <option value=""></option>
      ${values.map((v) => `<option value="${v}"${v === selected ? ' selected' : ''}>${v}</option>`).join('')}
    </select>`;
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.innerHTML = `
    <div>将于 … 发布</div>
    <div class="all">
      <div class="date">
        ${select(1, '月', range(1, 12), 11)}${select(2, '日', range(1, 30), 1)}${select(3, '年', [2028, 2027, 2026], 2026)}
      </div>
      <div class="time">${select(4, '时', range(0, 23), 0)}${select(5, '分', range(0, 59), 15)}</div>
    </div>`;
  document.body.replaceChildren(dialog);
  // happy-dom 不认 innerHTML 里的 selected，显式设一遍
  const initial: Record<string, string> = {
    SELECTOR_1: '11',
    SELECTOR_2: '1',
    SELECTOR_3: '2026',
    SELECTOR_4: '0',
    SELECTOR_5: '15',
  };
  for (const [id, value] of Object.entries(initial))
    (dialog.querySelector(`#${id}`) as HTMLSelectElement).value = value;
  return dialog;
}

describe('X 安排表下拉框', () => {
  it('按标签认出五个下拉框并读出时间', () => {
    const dialog = scheduleDialog();
    const fields = findScheduleFields(dialog)!;
    expect(fields.month.id).toBe('SELECTOR_1');
    expect(fields.minute.id).toBe('SELECTOR_5');
    expect(readScheduleFields(fields)).toBe(new Date(2026, 10, 1, 0, 15).getTime());
  });

  it('标签认不出时按选项特征认', () => {
    const dialog = scheduleDialog();
    dialog.querySelectorAll('label').forEach((label) => (label.textContent = '?'));
    const fields = findScheduleFields(dialog)!;
    expect([
      fields.month.id,
      fields.day.id,
      fields.year.id,
      fields.hour.id,
      fields.minute.id,
    ]).toEqual(['SELECTOR_1', 'SELECTOR_2', 'SELECTOR_3', 'SELECTOR_4', 'SELECTOR_5']);
  });

  it('填值并派发 change，读回来一致', async () => {
    const dialog = scheduleDialog();
    const changes: string[] = [];
    dialog.addEventListener('change', (event) =>
      changes.push((event.target as HTMLSelectElement).id),
    );
    const at = new Date(2027, 0, 3, 21, 30).getTime();
    expect(await fillScheduleFields(dialog, at)).toBe(true);
    expect(readScheduleFields(findScheduleFields(dialog)!)).toBe(at);
    expect(changes).toEqual(['SELECTOR_3', 'SELECTOR_1', 'SELECTOR_2', 'SELECTOR_4', 'SELECTOR_5']);
  });

  it('选项里没有的值（超出可选年份）返回失败', async () => {
    const dialog = scheduleDialog();
    expect(await fillScheduleFields(dialog, new Date(2030, 0, 1).getTime())).toBe(false);
  });

  it('快捷时间往后取整到 5 分钟', () => {
    expect(roundUp5(new Date(2026, 10, 1, 9, 1).getTime())).toBe(
      new Date(2026, 10, 1, 9, 5).getTime(),
    );
    expect(roundUp5(new Date(2026, 10, 1, 9, 5).getTime())).toBe(
      new Date(2026, 10, 1, 9, 5).getTime(),
    );
  });
});

describe('文章编辑器', () => {
  it('大纲读 h1 / h2 块', () => {
    document.body.innerHTML = `<div data-testid="composer">
      <h1 data-block="true">一</h1><div data-block="true">正文</div><h2 data-block="true">二</h2><h2 data-block="true"> </h2>
    </div>`;
    const outline = readOutline(document.querySelector('[data-testid="composer"]')!);
    expect(outline.map((o) => [o.level, o.text])).toEqual([
      [1, '一'],
      [2, '二'],
    ]);
  });

  it('粘贴走 X 编辑器自己的 paste 事件，带 HTML 和纯文本', () => {
    document.body.innerHTML = '<div data-testid="composer" contenteditable="true"></div>';
    const editor = document.querySelector('[data-testid="composer"]')!;
    let received: { html: string; text: string } | null = null;
    editor.addEventListener('paste', (event) => {
      const data = (event as ClipboardEvent).clipboardData!;
      received = { html: data.getData('text/html'), text: data.getData('text/plain') };
    });
    pasteHtml(editor, '<h2>x</h2>', 'x');
    expect(received).toEqual({ html: '<h2>x</h2>', text: 'x' });
  });
});
