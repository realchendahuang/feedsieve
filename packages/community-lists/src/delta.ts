/**
 * 快照增量（delta）：两版签名快照之间只传变化的条目。
 *
 * 增量本身不签名。扩展把增量套到本地已验签的旧版快照上，重新序列化出新版快照的完整文本，
 * 再和**新版已签名 manifest 里的 SHA-256** 比对；对不上（任何一步失败）就退回下载全量文件。
 * 所以增量只是省流量的捷径，信任链仍然是 manifest 签名 + 全文哈希。
 *
 * 序列化约定与服务端 generateSnapshot 一致：`JSON.stringify(body, null, 2) + '\n'`，
 * 顶层键按新版的顺序；entries 与 verified 都按 handle 的字节序排序（与浏览器语言无关），
 * whitelist 整段随增量下发（条目少，顺序以服务端为准）。
 */

export const SNAPSHOT_DELTA_VERSION = 1;

type Row = Record<string, unknown> & { handle: string };

export interface ListDelta {
  upsert: Row[];
  remove: string[];
}

export interface SnapshotDelta {
  delta_version: typeof SNAPSHOT_DELTA_VERSION;
  from: string;
  to: string;
  /** 新版顶层键的顺序 */
  key_order: string[];
  /** 新版除 entries / verified / whitelist 以外的顶层字段 */
  header: Record<string, unknown>;
  entries: ListDelta;
  verified?: ListDelta;
  whitelist?: Row[];
}

const LIST_KEYS = new Set(['entries', 'verified', 'whitelist']);

function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function rows(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Row =>
          !!item && typeof item === 'object' && typeof (item as Row).handle === 'string',
      )
    : [];
}

function diffList(base: Row[], target: Row[]): ListDelta {
  const before = new Map(base.map((row) => [row.handle, JSON.stringify(row)]));
  const after = new Set(target.map((row) => row.handle));
  return {
    upsert: target.filter((row) => before.get(row.handle) !== JSON.stringify(row)),
    remove: base.map((row) => row.handle).filter((handle) => !after.has(handle)),
  };
}

function applyList(base: Row[], delta: ListDelta): Row[] {
  const byHandle = new Map(base.map((row) => [row.handle, row]));
  for (const handle of delta.remove) byHandle.delete(handle);
  for (const row of delta.upsert) byHandle.set(row.handle, row);
  return [...byHandle.values()];
}

/** 服务端：从两版快照文本算增量。 */
export function buildSnapshotDelta(baseBody: string, targetBody: string): SnapshotDelta {
  const base = JSON.parse(baseBody) as Record<string, unknown>;
  const target = JSON.parse(targetBody) as Record<string, unknown>;
  const header: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(target)) {
    if (!LIST_KEYS.has(key)) header[key] = value;
  }
  return {
    delta_version: SNAPSHOT_DELTA_VERSION,
    from: String(base.snapshot_version),
    to: String(target.snapshot_version),
    key_order: Object.keys(target),
    header,
    entries: diffList(rows(base.entries), rows(target.entries)),
    ...(target.verified !== undefined
      ? { verified: diffList(rows(base.verified), rows(target.verified)) }
      : {}),
    ...(target.whitelist !== undefined ? { whitelist: rows(target.whitelist) } : {}),
  };
}

/**
 * 扩展端：把增量套到旧版快照文本上，返回新版快照的完整文本。
 * 形态不对返回 null；结果还要由调用方和签名 manifest 的 SHA-256 比对。
 */
export function applySnapshotDelta(baseBody: string, raw: unknown): string | null {
  try {
    const delta = raw as SnapshotDelta;
    if (
      !delta ||
      delta.delta_version !== SNAPSHOT_DELTA_VERSION ||
      !Array.isArray(delta.key_order) ||
      !delta.header ||
      typeof delta.header !== 'object' ||
      !delta.entries ||
      !Array.isArray(delta.entries.upsert) ||
      !Array.isArray(delta.entries.remove)
    ) {
      return null;
    }
    const base = JSON.parse(baseBody) as Record<string, unknown>;
    if (base.snapshot_version !== delta.from) return null;
    const entries = applyList(rows(base.entries), delta.entries).sort((a, b) =>
      byteCompare(a.handle, b.handle),
    );
    const verified = delta.verified
      ? applyList(rows(base.verified), delta.verified).sort((a, b) =>
          byteCompare(a.handle, b.handle),
        )
      : undefined;
    const out: Record<string, unknown> = {};
    for (const key of delta.key_order) {
      if (key === 'entries') out[key] = entries;
      else if (key === 'verified') {
        if (!verified) return null;
        out[key] = verified;
      } else if (key === 'whitelist') {
        if (!delta.whitelist) return null;
        out[key] = delta.whitelist;
      } else if (key in delta.header) out[key] = delta.header[key];
      else return null;
    }
    return `${JSON.stringify(out, null, 2)}\n`;
  } catch {
    return null;
  }
}
