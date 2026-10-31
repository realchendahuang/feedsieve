/**
 * 从页面里打开侧边栏时，指定它落到哪个视图（storage.session，几秒内有效）。
 * 例：主页资料卡下的洞察行被点击 → 后台写 `{ view: 'profile' }` → 侧边栏启动时读到，切到「主页」。
 */
export const PANEL_VIEW_REQUEST_KEY = 'panelViewRequestV1';
/** 超过这么久的请求不算（避免很久以后打开侧边栏还被带到旧视图）。 */
export const PANEL_VIEW_REQUEST_TTL_MS = 10_000;

export function readPanelViewRequest(value: unknown, now: number): string | null {
  const raw = value as { view?: unknown; at?: unknown } | null | undefined;
  if (!raw || typeof raw.view !== 'string' || typeof raw.at !== 'number') return null;
  return now - raw.at <= PANEL_VIEW_REQUEST_TTL_MS && raw.at <= now + 1_000 ? raw.view : null;
}
