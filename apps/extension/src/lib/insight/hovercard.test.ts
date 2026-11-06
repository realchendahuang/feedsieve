// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHovercard, HOVERCARD_CLASS } from './hovercard';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

/** 造一个「我们的徽标」：resolve 只认它，其它元素一律当普通内容。 */
function badge(): HTMLElement {
  const el = document.createElement('span');
  el.className = 'fs-velocity';
  el.textContent = '2.3K';
  document.body.appendChild(el);
  return el;
}

function hover(el: Element): void {
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
}

function card(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.${HOVERCARD_CLASS}`);
}

describe('徽标悬停卡片', () => {
  it('悬停徽标弹出卡片，移开后收起', () => {
    vi.useFakeTimers();
    const target = badge();
    const hovercard = createHovercard({
      resolve: (el) =>
        el === target
          ? { anchor: target, content: { title: '量级', rows: [['转发', '12']], footer: '福滤娃' } }
          : null,
    });
    hovercard.listen();

    hover(target);
    vi.advanceTimersByTime(150);
    expect(card()?.textContent).toContain('量级');

    hovercard.hide();
    expect(card()?.hasAttribute('data-open')).toBe(false);
    hovercard.unlisten();
  });

  it('unlisten 之后不再响应悬停（扩展停用/重载后旧脚本不能再弹卡）', () => {
    vi.useFakeTimers();
    const target = badge();
    const resolve = vi.fn(() => ({
      anchor: target,
      content: { title: '量级', rows: [] },
    }));
    const hovercard = createHovercard({ resolve });
    hovercard.listen();
    hovercard.unlisten();

    const before = resolve.mock.calls.length;
    hover(target);
    vi.advanceTimersByTime(300);
    expect(resolve.mock.calls.length).toBe(before);
    expect(card()?.hasAttribute('data-open') ?? false).toBe(false);
  });

  it('unlisten 可以重复调用', () => {
    const hovercard = createHovercard({ resolve: () => null });
    hovercard.listen();
    hovercard.unlisten();
    expect(() => hovercard.unlisten()).not.toThrow();
  });
});
