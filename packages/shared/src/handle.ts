/**
 * X handle 形态约定（唯一权威源）。
 *
 * 两种形态分开校验，避免「原始输入」与「已归一化存储」混用：
 * - 原始输入：允许可选的前导 @ 与大写（community-api 校验、admin 表单、
 *   extension 手动输入解析共用 HANDLE_INPUT_RE；归一化统一走 normalizeHandle）。
 * - 归一化形态：去 @、小写后 1-15 位（extension 的 xhr-bridge 消毒层、
 *   队列条目消毒等「已是存储形态」的校验用 NORMALIZED_HANDLE_RE）。
 */

/** 原始输入：可选前导 @，1-15 位字母/数字/下划线（大小写均可） */
export const HANDLE_INPUT_RE = /^@?([A-Za-z0-9_]{1,15})$/;

/** 归一化形态：去 @、小写后 1-15 位 */
export const NORMALIZED_HANDLE_RE = /^[a-z0-9_]{1,15}$/;

/**
 * 归一化：去可选前导 @、小写。
 * 非法输入返回 null（不抛错，调用方决定拒绝语义）。
 * 不 trim —— 是否容忍首尾空白由调用方决定（admin 表单先 trim，服务端校验裸值）。
 */
export function normalizeHandle(input: string): string | null {
  const candidate = input.startsWith('@') ? input.slice(1).toLowerCase() : input.toLowerCase();
  return NORMALIZED_HANDLE_RE.test(candidate) ? candidate : null;
}
