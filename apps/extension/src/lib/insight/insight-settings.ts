/**
 * 主页洞察的显示开关（browser.storage.local）：
 * - 「流速与量级」：推文上的流速/量级标签和倍数，默认开启。
 * - 「主页人气行」：资料卡下的一行概况，默认关闭。
 */
const INSIGHT_BADGES_KEY = 'insightBadges';
const PROFILE_LINE_KEY = 'profileLine';

/** 旧设置没有这个键时按开启处理（沿用原来的默认）。 */
const badgesOn = (value: unknown): boolean => value !== false;
/** 人气行是新功能，没设置过就是关闭。 */
const profileLineOn = (value: unknown): boolean => value === true;

async function readFlag(key: string, read: (value: unknown) => boolean): Promise<boolean> {
  const result = await browser.storage.local.get(key);
  return read(result[key]);
}

function subscribeFlag(
  key: string,
  read: (value: unknown) => boolean,
  onChange: (enabled: boolean) => void,
): () => void {
  const listener = (changes: Record<string, unknown>, areaName: string): void => {
    if (areaName !== 'local' || !changes[key]) return;
    onChange(read((changes[key] as { newValue?: unknown }).newValue));
  };
  browser.storage.onChanged.addListener(
    listener as Parameters<typeof browser.storage.onChanged.addListener>[0],
  );
  return () =>
    browser.storage.onChanged.removeListener(
      listener as Parameters<typeof browser.storage.onChanged.removeListener>[0],
    );
}

export async function getInsightBadgesEnabled(): Promise<boolean> {
  return readFlag(INSIGHT_BADGES_KEY, badgesOn);
}

export async function setInsightBadgesEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [INSIGHT_BADGES_KEY]: enabled });
}

export function subscribeInsightBadges(onChange: (enabled: boolean) => void): () => void {
  return subscribeFlag(INSIGHT_BADGES_KEY, badgesOn, onChange);
}

export async function getProfileLineEnabled(): Promise<boolean> {
  return readFlag(PROFILE_LINE_KEY, profileLineOn);
}

export async function setProfileLineEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [PROFILE_LINE_KEY]: enabled });
}

export function subscribeProfileLineEnabled(onChange: (enabled: boolean) => void): () => void {
  return subscribeFlag(PROFILE_LINE_KEY, profileLineOn, onChange);
}
