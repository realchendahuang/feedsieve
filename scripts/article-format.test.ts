import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatMarkdown, main } from './article-format.mjs';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'feedsieve-article-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('article-format CLI', () => {
  it('转换结果和扩展里的粘贴转换一致：标题 / HTML / 本地图片占位符', () => {
    const result = formatMarkdown(
      '# 我的文章\n\n导语\n\n## 第一节\n\n![配图](images/foo.png)\n\n结尾',
    );
    expect(result.title).toBe('我的文章');
    expect(result.html).toContain('<p>导语</p><h1>第一节</h1>');
    expect(result.html).toContain('🖼 图片 1：images/foo.png · 配图');
    expect(result.images).toEqual([{ index: 1, src: 'images/foo.png', alt: '配图' }]);
    expect(result.text).toContain('导语');
  });

  it('从文件读并输出 JSON；--html 只出 HTML；--out 写文件', () => {
    const dir = tempDir();
    const input = join(dir, 'article.md');
    writeFileSync(input, '# 标题\n\n正文');

    const log = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(main([input])).toBe(0);
      const json = JSON.parse(String(log.mock.calls.map((call) => call[0]).join('')));
      expect(json.title).toBe('标题');
      expect(json.html).toBe('<p>正文</p>');

      log.mockClear();
      expect(main([input, '--html'])).toBe(0);
      expect(String(log.mock.calls.map((call) => call[0]).join(''))).toBe('<p>正文</p>\n');

      const out = join(dir, 'out.json');
      log.mockClear();
      expect(main([input, '--out', out])).toBe(0);
      expect(JSON.parse(readFileSync(out, 'utf8')).title).toBe('标题');
    } finally {
      log.mockRestore();
    }
  });

  it('没有文件时读标准输入；未知参数返回 1', () => {
    const log = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(main(['--text'], () => '## 小标题\n\n正文')).toBe(0);
      expect(String(log.mock.calls.map((call) => call[0]).join(''))).toContain('小标题');
      expect(main(['--nope'])).toBe(1);
      expect(err).toHaveBeenCalled();
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  });
});
