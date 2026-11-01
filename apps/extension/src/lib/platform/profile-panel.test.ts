import { describe, expect, it, vi } from 'vitest';
import { openProfilePanel, profileHandleFromUrl } from './profile-panel';

const POPUP = 'chrome-extension://id/popup.html?view=profile&panel=1';

describe('openProfilePanel', () => {
  it('侧边栏能打开时优先用侧边栏，不再开窗口', async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    const openWindow = vi.fn().mockResolvedValue(undefined);
    await expect(
      openProfilePanel({ sidePanel: { open }, windowId: 7, openWindow, popupUrl: POPUP }),
    ).resolves.toEqual({ opened: true, via: 'panel' });
    expect(open).toHaveBeenCalledWith({ windowId: 7 });
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('侧边栏被拒绝（转发手势不认）时退回独立窗口', async () => {
    const open = vi.fn().mockRejectedValue(new Error('requires a user gesture'));
    const openWindow = vi.fn().mockResolvedValue(undefined);
    await expect(
      openProfilePanel({ sidePanel: { open }, windowId: 7, openWindow, popupUrl: POPUP }),
    ).resolves.toEqual({ opened: true, via: 'window' });
    expect(openWindow).toHaveBeenCalledWith(POPUP);
  });

  it('没有侧边栏 API 时直接开独立窗口', async () => {
    const openWindow = vi.fn().mockResolvedValue(undefined);
    await expect(
      openProfilePanel({ windowId: 7, openWindow, popupUrl: POPUP }),
    ).resolves.toEqual({ opened: true, via: 'window' });
  });

  it('拿不到 windowId 时直接开独立窗口', async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    const openWindow = vi.fn().mockResolvedValue(undefined);
    await expect(
      openProfilePanel({ sidePanel: { open }, openWindow, popupUrl: POPUP }),
    ).resolves.toEqual({ opened: true, via: 'window' });
    expect(open).not.toHaveBeenCalled();
  });

  it('两条路都失败时返回 opened:false', async () => {
    const open = vi.fn().mockRejectedValue(new Error('no gesture'));
    const openWindow = vi.fn().mockRejectedValue(new Error('blocked'));
    await expect(
      openProfilePanel({ sidePanel: { open }, windowId: 7, openWindow, popupUrl: POPUP }),
    ).resolves.toEqual({ opened: false, via: null });
  });
});

describe('profileHandleFromUrl', () => {
  it('从个人主页 URL 取 handle，兼容子 Tab', () => {
    expect(profileHandleFromUrl('https://x.com/Jack_FluxAI')).toBe('jack_fluxai');
    expect(profileHandleFromUrl('https://x.com/Jack_FluxAI/with_replies')).toBe('jack_fluxai');
  });

  it('首页、帖子详情、坏 URL 返回 null', () => {
    expect(profileHandleFromUrl('https://x.com/home')).toBeNull();
    expect(profileHandleFromUrl('https://x.com/i/status/1')).toBeNull();
    expect(profileHandleFromUrl('not a url')).toBeNull();
    expect(profileHandleFromUrl(undefined)).toBeNull();
  });
});
