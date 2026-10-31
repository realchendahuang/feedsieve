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
  // 首帧值与 SSR 严格一致（'system'/false）：客户端首帧若读 localStorage/matchMedia，
  // 依赖 mode 的 aria-label/title 会 hydration 不匹配。实际视觉无闪烁——
  // THEME_BOOT_SCRIPT 在水合前就按存储值给 <html> 落了类；挂载 effect 再把
  // React 状态对齐到真实偏好。
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [systemDark, setSystemDark] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // 水合后一次性同步真实偏好：SSR 一致性要求首帧用占位值，这里 setState 属
    // 该规则文档认可的「mount 时同步外部状态」例外。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModeState(readStoredMode());
    setSystemDark(window.matchMedia('(prefers-color-scheme: dark)').matches);
    setHydrated(true);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved = resolveTheme(mode, systemDark);

  // hydrated 门禁挡掉挂载帧的 'system'+false 占位值：那次 applyTheme 会把
  // THEME_BOOT_SCRIPT 预先落好的深色类盖成一帧浅色。
  useEffect(() => {
    if (hydrated) applyTheme(mode, systemDark);
  }, [mode, systemDark, hydrated]);

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
