/**
 * 「流速与量级」显示开关（默认开启），存 browser.storage.local。
 */
const INSIGHT_BADGES_KEY = 'insightBadges';

export async function getInsightBadgesEnabled(): Promise<boolean> {
  const result = await browser.storage.local.get(INSIGHT_BADGES_KEY);
  return result[INSIGHT_BADGES_KEY] !== false;
}

export async function setInsightBadgesEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [INSIGHT_BADGES_KEY]: enabled });
}

export function subscribeInsightBadges(onChange: (enabled: boolean) => void): () => void {
  const listener = (changes: Record<string, unknown>, areaName: string): void => {
    if (areaName !== 'local' || !changes[INSIGHT_BADGES_KEY]) return;
    onChange((changes[INSIGHT_BADGES_KEY] as { newValue?: unknown }).newValue !== false);
  };
  browser.storage.onChanged.addListener(
    listener as Parameters<typeof browser.storage.onChanged.addListener>[0],
  );
  return () =>
    browser.storage.onChanged.removeListener(
      listener as Parameters<typeof browser.storage.onChanged.removeListener>[0],
    );
}
