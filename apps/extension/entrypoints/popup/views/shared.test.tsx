// @vitest-environment happy-dom
// 悬浮提示的落点：弹窗只有 420×600，提示框得整块留在里面，且默认不盖住顶部导航。
import { afterEach, describe, expect, it } from 'vitest';
import { placeTip } from './shared';

const VIEW_W = 420;
const VIEW_H = 600;

function useViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

function anchorAt(top: number, left = 94, width = 14): {
  top: number;
  bottom: number;
  left: number;
  width: number;
} {
  return { top, bottom: top + width, left, width };
}

/** 五行说明文字量出来的尺寸，最容易顶出弹窗的那一档。 */
const TALL = { width: 260, height: 84 };

describe('placeTip', () => {
  afterEach(() => useViewport(VIEW_W, VIEW_H));
  useViewport(VIEW_W, VIEW_H);

  it('锚点在上半页也放到下方，不盖住顶部导航', () => {
    // 淘金设置里「流速与量级」那一行：上方的空间其实塞得下，但塞下去就压住导航了
    expect(placeTip(anchorAt(103), TALL)).toEqual({ left: 8, top: 125, placement: 'bottom' });
  });

  it('下方放不下才翻到上方', () => {
    expect(placeTip(anchorAt(560), TALL)).toEqual({ left: 8, top: 468, placement: 'top' });
  });

  it('左右夹在弹窗里，不会半个提示框出界', () => {
    const left = placeTip(anchorAt(300, 0), TALL).left;
    expect(left).toBe(8);
    const right = placeTip(anchorAt(300, 400), TALL).left;
    expect(right).toBe(VIEW_W - TALL.width - 8);
    expect(right + TALL.width).toBe(VIEW_W - 8);
  });

  it('两边都塞不下时整块夹进弹窗', () => {
    useViewport(VIEW_W, 200);
    const { top } = placeTip(anchorAt(100), { width: 260, height: 300 });
    expect(top).toBe(8);
  });

  it('还没量到尺寸时也给得出合法落点', () => {
    const placement = placeTip(anchorAt(300), null);
    expect(placement.placement).toBe('bottom');
    expect(Number.isFinite(placement.left)).toBe(true);
    expect(Number.isFinite(placement.top)).toBe(true);
  });
});
