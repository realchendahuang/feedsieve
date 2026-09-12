import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  applyTheme,
  readStoredMode,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeMode,
} from './../lib/theme';

type ThemeContextValue = {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
};

/** 无 Provider 时给安全空实现（404 兜底等游离在壳外的渲染也不炸） */
const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  resolved: 'light',
  setMode: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  // 首帧值 lazy 初始化（localStorage / matchMedia 只在客户端执行），
  // 不在 effect 里 setState；effect 只保留系统偏好订阅回调。
  const [mode, setModeState] = useState<ThemeMode>(() =>
    typeof window === 'undefined' ? 'system' : readStoredMode(),
  );
  const [systemDark, setSystemDark] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved = resolveTheme(mode, systemDark);

  useEffect(() => {
    applyTheme(mode, systemDark);
  }, [mode, systemDark]);

  const setMode = useCallback((next: ThemeMode) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* 隐私模式写不进就只切本次会话 */
    }
    setModeState(next);
  }, []);

  return <ThemeContext value={{ mode, resolved, setMode }}>{children}</ThemeContext>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
