/**
 * 从 X 页面里的「主页洞察」行打开扩展界面，优先侧边栏。
 *
 * `sidePanel.open()` 要求用户手势，而这里的点击是内容脚本转发过来的；部分
 * Chrome / Edge 版本不认这个手势，Promise 会直接 reject。以前失败就静默，
 * 用户看到的是「点了没反应」。这里失败后退回一个和工具栏弹窗同尺寸的独立
 * 窗口，保证点击一定有反馈。
 *
 * 注意：`sidePanel.open()` 必须在 `openProfilePanel()` 被调用的同一拍发起，
 * 不能先 await 其它东西，否则用户手势会过期。
 */
import { profileFromPath } from '@feedsieve/x-adapter';
import type { ChromeSidePanelApi } from './sidepanel';

export type ProfilePanelVia = 'panel' | 'window';

/** 从点击发生的标签页 URL 取主页主人，独立窗口才能落到同一个博主。 */
export function profileHandleFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return profileFromPath(new URL(url).pathname)?.handle ?? null;
  } catch {
    return null;
  }
}

export interface ProfilePanelResult {
  opened: boolean;
  via: ProfilePanelVia | null;
}

export interface ProfilePanelDeps {
  sidePanel?: Pick<ChromeSidePanelApi, 'open'>;
  /** 发起点击的标签页所在窗口；拿不到就跳过后备侧边栏 */
  windowId?: number;
  /** 打开独立窗口（popup.html?view=profile&panel=1） */
  openWindow: (url: string) => Promise<unknown>;
  popupUrl: string;
}

export async function openProfilePanel(deps: ProfilePanelDeps): Promise<ProfilePanelResult> {
  const { sidePanel, windowId, openWindow, popupUrl } = deps;
  if (windowId !== undefined && sidePanel?.open) {
    try {
      await sidePanel.open({ windowId });
      return { opened: true, via: 'panel' };
    } catch {
      // 手势不被识别、侧边栏被策略禁用、窗口不支持侧边栏：都走独立窗口
    }
  }
  try {
    await openWindow(popupUrl);
    return { opened: true, via: 'window' };
  } catch {
    return { opened: false, via: null };
  }
}
