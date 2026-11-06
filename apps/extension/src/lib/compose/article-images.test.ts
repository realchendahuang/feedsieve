// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { insertLocalImages, matchImageFiles, readImageSlots } from './article-images';

function editorWith(blocks: string[]): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = blocks
    .map((text) => `<div data-block="true"><span data-text="true">${text}</span></div>`)
    .join('');
  return host;
}

describe('文章本地图片', () => {
  it('按正文顺序认出占位段（普通段落不算）', () => {
    const host = editorWith([
      '第一段',
      '🖼 图片 1：images/foo.png · 双链图',
      '🖼 图片 2：bar.png',
      '普通段落',
    ]);
    const slots = readImageSlots(host);
    expect(slots.map((slot) => [slot.index, slot.src, slot.name])).toEqual([
      [1, 'images/foo.png', 'foo.png'],
      [2, 'bar.png', 'bar.png'],
    ]);
    expect(slots[0]?.block).toBe(host.querySelectorAll('[data-block="true"]')[1]);
  });

  it('选中的文件按文件名配对，名字对不上的按顺序补位', () => {
    const slots = [{ name: 'foo.png' }, { name: 'BAR.PNG' }, { name: '没选到.png' }];
    const files = [{ name: 'bar.png' }, { name: 'foo.png' }, { name: '随手改名.jpg' }];
    expect(matchImageFiles(slots, files)).toEqual([1, 0, 2]);
    expect(matchImageFiles(slots, [])).toEqual([null, null, null]);
    expect(matchImageFiles([{ name: 'a.png' }], [{ name: 'b.png' }, { name: 'c.png' }])).toEqual([0]);
  });

  it('没选到对应文件时不动编辑器，只报 unmatched', async () => {
    const host = editorWith(['🖼 图片 1：foo.png', '🖼 图片 2：bar.png']);
    const result = await insertLocalImages({
      host,
      files: [],
      slots: readImageSlots(host),
      sleep: async () => {},
    });
    expect(result).toEqual({ inserted: 0, failed: 0, unmatched: 2, remaining: 2 });
  });
});
