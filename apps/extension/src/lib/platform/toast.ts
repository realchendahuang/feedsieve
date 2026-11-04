/**
 * 弹窗唯一的瞬时提示通道。
 *
 * 以前有两套：App 的 notice 与热帖视图自带的「撤销」吐司，各自 fixed 在底部，
 * 同时出现时会叠在一起。现在所有视图都往这里发，App 只渲染一个 <ToastHost />。
 *
 * 纯提示 4 秒自动消失；带「撤销 / 不看」这类操作的提示留 8 秒，够用户点。
 */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastEntry {
  id: number;
  text: string;
  actions?: ToastAction[];
  /** 毫秒；不传按默认时长。 */
  duration?: number;
}

export const TOAST_MS = 4_000;
export const TOAST_WITH_ACTION_MS = 8_000;

let current: ToastEntry | null = null;
let sequence = 0;
const listeners = new Set<(entry: ToastEntry | null) => void>();

function emit(): void {
  for (const listener of listeners) listener(current);
}

/** 发一条提示；同一条文字连续触发也会重新计时（新的 id）。 */
export function showToast(
  text: string,
  options: { actions?: ToastAction[]; duration?: number } = {},
): void {
  sequence += 1;
  current = {
    id: sequence,
    text,
    ...(options.actions?.length ? { actions: options.actions } : {}),
    ...(options.duration !== undefined ? { duration: options.duration } : {}),
  };
  emit();
}

export function dismissToast(): void {
  if (current === null) return;
  current = null;
  emit();
}

export function getToast(): ToastEntry | null {
  return current;
}

export function subscribeToast(listener: (entry: ToastEntry | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 仅供测试：清空状态与监听。 */
export function resetToastForTest(): void {
  current = null;
  sequence = 0;
  listeners.clear();
}
