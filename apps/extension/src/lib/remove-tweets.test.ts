// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectCellsByHandle, removeCellsSoon } from './remove-tweets';

/** 构造 X 时间线格子：cellInnerDiv 包一个 article，含作者链接与正文。 */
function tweetCell(handle: string, postId: string): HTMLElement {
  const cell = document.createElement('div');
  cell.dataset.testid = 'cellInnerDiv';

  const article = document.createElement('article');
  article.dataset.testid = 'tweet';

  const nameArea = document.createElement('div');
  nameArea.dataset.testid = 'User-Name';
  const authorLink = document.createElement('a');
  authorLink.href = `/${handle}/status/${postId}`;
  nameArea.append(authorLink);

  const text = document.createElement('div');
  text.dataset.testid = 'tweetText';
  text.textContent = 'spam message';

  article.append(nameArea, text);
  cell.append(article);
  return cell;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('collectCellsByHandle', () => {
  it('collects only cells whose author matches the handle, deduped', () => {
    const target = tweetCell('spamking88', '1');
    document.body.append(target, tweetCell('spamking88', '2'), tweetCell('cleanuser', '3'));

    const cells = collectCellsByHandle('spamking88');

    expect(cells).toHaveLength(2);
    expect(cells).toContain(target);
  });

  it('falls back to the article when no cellInnerDiv wrapper exists', () => {
    const bareArticle = tweetCell('spamking88', '1').querySelector('article')!;
    document.body.append(bareArticle);

    const cells = collectCellsByHandle('spamking88');

    expect(cells).toEqual([bareArticle]);
  });

  it('skips articles it cannot parse (no author link)', () => {
    const cell = document.createElement('div');
    const article = document.createElement('article');
    article.dataset.testid = 'tweet';
    article.textContent = 'unparseable';
    cell.append(article);
    document.body.append(cell);

    expect(collectCellsByHandle('whatever')).toEqual([]);
  });
});

describe('removeCellsSoon', () => {
  it('removes connected cells after the delay', () => {
    vi.useFakeTimers();
    try {
      const cell = tweetCell('spamking88', '1');
      document.body.append(cell);
      removeCellsSoon([cell], 650);

      expect(cell.isConnected).toBe(true);
      vi.advanceTimersByTime(649);
      expect(cell.isConnected).toBe(true);
      vi.advanceTimersByTime(1);
      expect(cell.isConnected).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves already-detached cells alone', () => {
    vi.useFakeTimers();
    try {
      const cell = tweetCell('spamking88', '1');
      cell.remove(); // X 重渲染后节点已脱离文档
      removeCellsSoon([cell], 650);
      vi.advanceTimersByTime(650);
      expect(cell.isConnected).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});