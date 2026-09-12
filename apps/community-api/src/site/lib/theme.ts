/**
 * 主题三态机：system（默认）/ light / dark（KOSX 同款）。
 * localStorage["feedsieve:theme"]；html .dark class + data-theme-mode ——
 * 首帧之前由 THEME_BOOT_SCRIPT 写入，水合后由 ThemeProvider 接管。
 */
export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'feedsieve:theme';

/** 两种解析主题的浏览器 chrome 色，随主题切换同步进 meta */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: '#f5f6f7',
  dark: '#14171a',
};

const CYCLE: ThemeMode[] = ['system', 'light', 'dark'];

export function resolveTheme(mode: ThemeMode, systemDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemDark ? 'dark' : 'light';
  return mode;
}

export function cycleTheme(mode: ThemeMode): ThemeMode {
  const next = CYCLE[(CYCLE.indexOf(mode) + 1) % CYCLE.length];
  return next ?? 'system';
}

export function readStoredMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(mode: ThemeMode, systemDark: boolean): ResolvedTheme {
  const resolved = resolveTheme(mode, systemDark);
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.themeMode = mode;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLORS[resolved]);
  return resolved;
}

export const THEME_BOOT_SCRIPT = `(function(){try{var m="system";try{m=localStorage.getItem("feedsieve:theme")||"system"}catch(e){}var d=m==="dark"||(m!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.dataset.themeMode=m;var t=document.querySelector('meta[name="theme-color"]');if(t)t.setAttribute("content",d?"#14171a":"#f5f6f7");}catch(e){}})();`;
