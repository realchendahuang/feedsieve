export interface ChromeSidePanelApi {
  open?: (options: { windowId: number }) => Promise<void>;
  close?: (options: { windowId: number }) => Promise<void>;
  setPanelBehavior?: (options: { openPanelOnActionClick: boolean }) => Promise<void>;
  setOptions?: (options: { enabled?: boolean; path?: string; windowId?: number }) => Promise<void>;
}

/**
 * Safe accessor for chrome.sidePanel API without DOM or React dependencies.
 */
export function getChromeSidePanel(): ChromeSidePanelApi | undefined {
  if (typeof globalThis !== 'undefined') {
    const glob = globalThis as unknown as {
      chrome?: {
        sidePanel?: ChromeSidePanelApi;
      };
    };
    return glob.chrome?.sidePanel;
  }
  return undefined;
}
