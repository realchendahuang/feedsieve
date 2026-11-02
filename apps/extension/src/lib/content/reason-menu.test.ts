// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { openReasonMenu } from './reason-menu';
import { MANUAL_REPORT_REASONS } from '../community/manual-reasons';

beforeEach(() => {
  document.body.innerHTML = '';
});

function anchor(): HTMLButtonElement {
  const button = document.createElement('button');
  document.body.appendChild(button);
  return button;
}

it('列出全部分类原因和「仅拉黑」，选择后关闭并回调', () => {
  const onPick = vi.fn();
  const onClose = vi.fn();
  const menu = openReasonMenu(anchor(), { language: 'zh', onPick, onClose });

  const options = [...document.querySelectorAll<HTMLButtonElement>('.fs-reason-option')];
  expect(options).toHaveLength(MANUAL_REPORT_REASONS.length + 1);
  expect(document.querySelector('.fs-reason-menu-title')?.textContent).toBe('为什么拉黑？');
  expect(document.querySelector('.fs-reason-personal')?.textContent).toBe('仅拉黑，不参与社区');

  document.querySelector<HTMLButtonElement>('[data-fs-reason="scam_phishing"]')!.click();
  expect(onPick).toHaveBeenCalledWith('scam_phishing');
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.fs-reason-menu')).toBeNull();

  // 已关闭后手动清理不会重复回调
  menu();
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('「仅拉黑」回调 null', () => {
  const onPick = vi.fn();
  openReasonMenu(anchor(), { language: 'zh', onPick });
  document.querySelector<HTMLButtonElement>('.fs-reason-personal')!.click();
  expect(onPick).toHaveBeenCalledWith(null);
});

it('点击外部关闭，点菜单内部不关闭', async () => {
  const onPick = vi.fn();
  const onClose = vi.fn();
  openReasonMenu(anchor(), { language: 'zh', onPick, onClose });
  // 监听器在下一个宏任务挂上
  await new Promise((resolve) => setTimeout(resolve, 0));

  const menu = document.querySelector('.fs-reason-menu')!;
  menu.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  expect(onClose).not.toHaveBeenCalled();

  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onPick).not.toHaveBeenCalled();
});

it('按 Esc 关闭且不选原因', async () => {
  const onPick = vi.fn();
  const onClose = vi.fn();
  openReasonMenu(anchor(), { language: 'zh', onPick, onClose });
  await new Promise((resolve) => setTimeout(resolve, 0));

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onPick).not.toHaveBeenCalled();
  expect(document.querySelector('.fs-reason-menu')).toBeNull();
});
