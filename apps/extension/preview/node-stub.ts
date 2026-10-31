// 预览工具专用：keyword-packs.ts 在非扩展环境（vitest）会用 node:fs 读仓库里的词库源文件。
// 预览页提供了 browser.runtime.getURL 时不会走到那条分支，这里只需要让 import 不报错。
const unavailable = (): never => {
  throw new Error('node built-ins are not available in the popup preview');
};
export const existsSync = (): boolean => false;
export const readFileSync = unavailable;
export const join = (...parts: string[]): string => parts.join('/');
export const resolve = (...parts: string[]): string => parts.join('/');
export default { existsSync, readFileSync };
