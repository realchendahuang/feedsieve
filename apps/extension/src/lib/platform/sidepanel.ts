export interface ChromeSidePanelApi {
  open?: (options: { windowId: number }) => Promise<void>;
  close?: (options: { windowId: number }) => Promise<void>;
  setPanelBehavior?: (options: { openPanelOnActionClick: boolean }) => Promise<void>;
  setOptions?: (options: { enabled?: boolean; path?: string; windowId?: number }) => Promise<void>;
}

interface FirefoxSidebarActionApi {
  open?: () => Promise<void>;
  close?: () => Promise<void>;
  toggle?: () => Promise<void>;
}

/**
 * Safe accessor for the side panel API without DOM or React dependencies.
 *
 * Chrome 用 chrome.sidePanel；Firefox 没有 sidePanel，用 sidebar_action 模拟
 * open/close。两者都要求用户手势，从 content script 转发点击时可能失败，
 * 调用方按「打开失败」处理即可。
 */
export function getChromeSidePanel(): ChromeSidePanelApi | undefined {
  if (typeof globalThis === 'undefined') return undefined;
  const glob = globalThis as unknown as {
    chrome?: { sidePanel?: ChromeSidePanelApi };
    browser?: { sidebarAction?: FirefoxSidebarActionApi };
  };
  if (glob.chrome?.sidePanel) return glob.chrome.sidePanel;
  const sidebar = glob.browser?.sidebarAction;
  if (!sidebar) return undefined;
  return {
    ...(sidebar.open
      ? {
          open: async () => {
            await sidebar.open!();
          },
        }
      : {}),
    ...(sidebar.close
      ? {
          close: async () => {
            await sidebar.close!();
          },
        }
      : {}),
  };
}
