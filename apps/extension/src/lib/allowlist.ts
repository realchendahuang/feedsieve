/**
 * 个人白名单：一票否决（误杀治理，PureTwitter 同款设计）。
 * 名单/启发式命中后，白名单命中即洗白——绝不标注、绝不进待拉黑。
 * 优先级高于一切识别来源。
 */

export interface AllowlistItem {
  handle: string;
  xUserId?: string;
  addedAt: number;
}

const STORAGE_KEY = 'allowlist';

export async function getAllowlist(): Promise<AllowlistItem[]> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const value = result[STORAGE_KEY];
  return Array.isArray(value) ? (value as AllowlistItem[]) : [];
}

export async function isAllowed(handle: string): Promise<boolean> {
  const normalized = normalize(handle);
  return (await getAllowlist()).some((item) => item.handle === normalized);
}

/** 幂等加入。 */
export async function addAllowlist(handle: string, xUserId?: string): Promise<void> {
  const normalized = normalize(handle);
  if (!normalized) {
    return;
  }
  const items = await getAllowlist();
  if (items.some((item) => item.handle === normalized)) {
    return;
  }
  items.push({
    handle: normalized,
    addedAt: Date.now(),
    ...(xUserId ? { xUserId } : {}),
  });
  await browser.storage.local.set({ [STORAGE_KEY]: items });
}

export async function removeAllowed(handle: string): Promise<void> {
  const normalized = normalize(handle);
  const remaining = (await getAllowlist()).filter(
    (item) => item.handle !== normalized,
  );
  await browser.storage.local.set({ [STORAGE_KEY]: remaining });
}

export function subscribeAllowlist(onChange: (items: AllowlistItem[]) => void): () => void {
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    areaName: string,
  ) => {
    if (areaName === 'local' && changes[STORAGE_KEY]) {
      void getAllowlist().then(onChange);
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

function normalize(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}
