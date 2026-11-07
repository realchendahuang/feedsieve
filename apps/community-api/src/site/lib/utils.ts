import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 头像兜底用的首字母：跳过 handle 开头的 `_`、`.`、emoji 等非字母数字字符
 * （`_exploreai` 不该把下划线当头像字），中文名取第一个汉字，取不到用 `?`。
 */
export function initialOf(name: string): string {
  const visible = name.replace(/^@/, '').trim();
  const match = visible.match(/[\p{L}\p{N}]/u);
  return match ? match[0].toUpperCase() : '?';
}
