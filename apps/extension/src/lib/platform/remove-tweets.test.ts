// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cancelPendingHides,
  hiddenForOtherPost,
  HIDDEN_TWEET_CELL_ATTRIBUTE,
  hideCellsSoon,
  mutateWithStableViewport,
} from './remove-tweets';

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

  it('引用帖里的 status 链接不会抢走格子归属（认时间戳那条）', () => {
    vi.useFakeTimers();
    const cell = tweetCell('spamking88', '777');
    const article = cell.querySelector('article')!;
    article.insertAdjacentHTML('afterbegin', '<div><a href="/quoted/status/999">quoted</a></div>');
    article.insertAdjacentHTML(
      'beforeend',
      '<a href="/spamking88/status/777"><time datetime="2026-11-06T00:00:00Z">1h</time></a>',
    );
    document.body.append(cell);
    hideCellsSoon([cell], 0);
    vi.advanceTimersByTime(0);
    expect(cell.getAttribute(HIDDEN_TWEET_CELL_ATTRIBUTE)).toBe('777');
  });

describe('隐藏格子的归属校验', () => {
  it('隐藏时记下这条推文的 status id', () => {
    vi.useFakeTimers();
    const cell = tweetCell('spamking88', '2118366625804202080');
    document.body.append(cell);
    hideCellsSoon([cell], 0);
    vi.advanceTimersByTime(0);
    expect(cell.getAttribute(HIDDEN_TWEET_CELL_ATTRIBUTE)).toBe('2118366625804202080');
    expect(hiddenForOtherPost(cell, '2118366625804202080')).toBe(false);
  });

  it('X 把格子复用给别的推文后，旧隐藏不再连坐', () => {
    vi.useFakeTimers();
    const cell = tweetCell('spamking88', '111');
    document.body.append(cell);
    hideCellsSoon([cell], 0);
    vi.advanceTimersByTime(0);
    expect(hiddenForOtherPost(cell, '222')).toBe(true);
    // 老数据（'true'）和读不到 id 的格子不做判断，保持原来的行为
    cell.setAttribute(HIDDEN_TWEET_CELL_ATTRIBUTE, 'true');
    expect(hiddenForOtherPost(cell, '222')).toBe(false);
  });

  it('取消待执行的隐藏后，格子不会再被藏起来', () => {
    vi.useFakeTimers();
    const cell = tweetCell('spamking88', '333');
    document.body.append(cell);
    hideCellsSoon([cell], 650);
    cancelPendingHides();
    vi.advanceTimersByTime(1_000);
    expect(cell.hasAttribute(HIDDEN_TWEET_CELL_ATTRIBUTE)).toBe(false);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
  document.documentElement.scrollTop = 0;
  document.documentElement.scrollLeft = 0;
});

describe('hideCellsSoon', () => {
  it('keeps the React-owned cell connected, then collapses it after the feedback delay', () => {
    vi.useFakeTimers();
    const cell = tweetCell('spamking88', '1');
    document.body.append(cell);
    hideCellsSoon([cell], 650);

    expect(cell.isConnected).toBe(true);
    expect(cell.hasAttribute(HIDDEN_TWEET_CELL_ATTRIBUTE)).toBe(false);
    vi.advanceTimersByTime(649);
    expect(cell.hasAttribute(HIDDEN_TWEET_CELL_ATTRIBUTE)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(cell.isConnected).toBe(true);
    expect(cell.getAttribute(HIDDEN_TWEET_CELL_ATTRIBUTE)).toBe('1');
  });

  it('leaves already-detached cells alone', () => {
    vi.useFakeTimers();
    const cell = tweetCell('spamking88', '1');
    cell.remove(); // X 重渲染后节点已脱离文档
    hideCellsSoon([cell], 650);
    vi.advanceTimersByTime(650);
    expect(cell.isConnected).toBe(false);
    expect(cell.hasAttribute(HIDDEN_TWEET_CELL_ATTRIBUTE)).toBe(false);
  });

  it('restores document scrollTop after the collapsed row triggers anchoring', () => {
    vi.useFakeTimers();
    const frames = captureAnimationFrames();
    const cell = tweetCell('spamking88', '1');
    document.body.append(cell);
    const scroller = document.scrollingElement as HTMLElement;
    scroller.scrollTop = 480;
    scroller.style.setProperty('overflow-anchor', 'auto', 'important');
    const setAttribute = cell.setAttribute.bind(cell);
    vi.spyOn(cell, 'setAttribute').mockImplementation((name, value) => {
      setAttribute(name, value);
      if (name === HIDDEN_TWEET_CELL_ATTRIBUTE) {
        // 模拟 Chrome 在行高消失时对 scrollTop 的锚点补偿。
        scroller.scrollTop = 318;
      }
    });

    hideCellsSoon([cell], 650);
    vi.advanceTimersByTime(650);

    expect(scroller.scrollTop).toBe(480);
    expect(scroller.style.getPropertyValue('overflow-anchor')).toBe('none');

    // 模拟 X 在同一帧布局后再次修正虚拟列表高度。
    scroller.scrollTop = 270;
    runNextFrame(frames);
    expect(scroller.scrollTop).toBe(480);
    expect(scroller.style.getPropertyValue('overflow-anchor')).toBe('auto');
    expect(scroller.style.getPropertyPriority('overflow-anchor')).toBe('important');

    // 第二帧覆盖浏览器在恢复锚点后的延迟结算。
    scroller.scrollTop = 196;
    runNextFrame(frames);
    expect(scroller.scrollTop).toBe(480);
  });

  it('also restores a nested scroll container used by a reply drawer', () => {
    const frames = captureAnimationFrames();
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'scroll';
    const cell = tweetCell('spamking88', '1');
    scroller.append(cell);
    document.body.append(scroller);
    scroller.scrollTop = 190;

    mutateWithStableViewport([cell], () => {
      scroller.scrollTop = 24;
      cell.setAttribute(HIDDEN_TWEET_CELL_ATTRIBUTE, 'true');
    });

    expect(scroller.scrollTop).toBe(190);
    runNextFrame(frames);
    expect(scroller.scrollTop).toBe(190);
    runNextFrame(frames);
    expect(scroller.scrollTop).toBe(190);
  });
});

function captureAnimationFrames(): FrameRequestCallback[] {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  return frames;
}

function runNextFrame(frames: FrameRequestCallback[]): void {
  const callback = frames.shift();
  expect(callback).toBeDefined();
  callback?.(0);
}
