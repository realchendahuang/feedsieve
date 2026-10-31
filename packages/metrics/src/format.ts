/**
 * 中文紧凑计数：徽标和量级标签用。
 *   999 → "999"，12_345 → "1.2万"，32_000 → "3.2万"，150_000_000 → "1.5亿"
 * 保留一位小数并去掉末尾的 .0；≥ 100 万时不保留小数（"120万"）。
 */
export function formatCountZh(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 10_000) return String(Math.round(value));
  const wan = value / 10_000;
  const wanShown = wan >= 100 ? Math.round(wan) : Math.floor(wan * 10) / 10;
  // 9999.6 万四舍五入成 10000 万时改用「亿」
  if (wanShown < 10_000) return `${trimDecimal(wanShown)}万`;
  const yi = value / 100_000_000;
  // 进到这里至少是 9999.x 万，向下取整到 0.9 亿反而变小，下限按 1 亿显示
  return `${trimDecimal(yi >= 100 ? Math.round(yi) : Math.max(1, Math.floor(yi * 10) / 10))}亿`;
}

function trimDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
