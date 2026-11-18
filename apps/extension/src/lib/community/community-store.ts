import { loadRuntimeData } from '../platform/runtime-data';
/**
 * 社区名单本地状态：快照缓存（last-known-good）与全量索引构建。
 * 纯设置、pause 门控与订阅已拆进 ./community-settings（内容脚本仅依赖该轻量子模块），
 * 这里只在后台 SW / 弹窗统计等需要解析完整快照的入口使用。
 */
import {
  buildIndex,
  parseSnapshotBody,
  workerSource,
  type CommunityEntry,
  type CommunityIndex,
  type StoredSnapshot,
  type SyncSource,
} from '@feedsieve/community-lists';
import {
  COMMUNITY_API_BASE,
  DEFAULT_COMMUNITY_SETTINGS,
  LEGACY_SNAPSHOT_KEY,
  SNAPSHOT_KEY,
  getCommunitySettings,
  requestOfficialPauseCheck,
  setCommunitySettings,
  subscribeCommunity,
  type CommunitySettings,
  type OfficialPauseState,
} from './community-settings';

export {
  COMMUNITY_API_BASE,
  DEFAULT_COMMUNITY_SETTINGS,
  getCommunitySettings,
  requestOfficialPauseCheck,
  setCommunitySettings,
  subscribeCommunity,
  type CommunitySettings,
  type OfficialPauseState,
};

/**
 * 快照来源：官方 Worker 单源（最小 host 权限：x.com + 官方 API）。
 * 仓库 community/lists/ 镜像仅为公开存档（scripts/mirror-community-lists.sh 维护），
 * 扩展不直接拉取第三方 CDN。
 */
export const COMMUNITY_SYNC_SOURCES: SyncSource[] = [workerSource(COMMUNITY_API_BASE)];

let legacySnapshotCleaned = false;
function cleanupLegacySnapshot(): void {
  if (legacySnapshotCleaned) return;
  legacySnapshotCleaned = true;
  void Promise.resolve(browser.storage.local.remove(LEGACY_SNAPSHOT_KEY)).catch(() => {
    // 清理失败不影响功能
  });
}
// 随包发布的最终名单不走 JS bundle：构建时由 wxt.config officialJsonPlugin 拷入
// public/community/lists/，由后台读取并缓存到 storage（无网络依赖）。
// 此前静态 import 让 background / content / popup 三个入口各抄一份，产物膨胀到 4 MB。
const BUNDLED_SNAPSHOT_URL = '/community/lists/official.json';
let bundledSnapshotCache: StoredSnapshot | null | undefined;
export async function getBundledSnapshot(): Promise<StoredSnapshot | null> {
  if (bundledSnapshotCache !== undefined) return bundledSnapshotCache;
  try {
    const raw = (await loadRuntimeData(BUNDLED_SNAPSHOT_URL)) as {
      snapshot_version: string;
      generated_at: string;
      entries: unknown;
    };
    const body = `${JSON.stringify(raw)}\n`;
    const parsed = parseSnapshotCached(body);
    if (!parsed.ok) throw new Error('Invalid bundled community snapshot');
    bundledSnapshotCache = {
      snapshot_version: raw.snapshot_version,
      body,
      synced_at: Date.parse(raw.generated_at),
    };
  } catch (error) {
    console.error('[FeedSieve] 随包名单加载失败，下次读取将重试:', error);
    return null;
  }
  return bundledSnapshotCache;
}

/** 随包名单的 entries（content script 离线兜底用），与 getBundledSnapshot 共享一次 fetch。 */
export async function getBundledEntries(): Promise<unknown> {
  const snap = await getBundledSnapshot();
  if (!snap) return [];
  // 与 getStoredCommunitySnapshot 共享解析缓存，不再重复 JSON.parse / 验签
  const parsed = parseSnapshotCached(snap.body);
  return parsed.ok ? (parsed.value.entries ?? []) : [];
}

/**
 * 快照 body 解析结果按 body 字符串缓存：body 几 MB 且内容不可变，
 * 但 SW 构建索引 / popup / pause 门控都会查它。单槽足够——新快照即新 body。
 */
type ParsedSnapshot = ReturnType<typeof parseSnapshotBody>;
let parsedSnapshotSlot: { body: string; parsed: ParsedSnapshot } | null = null;

function parseSnapshotCached(body: string): ParsedSnapshot {
  if (parsedSnapshotSlot?.body !== body) {
    parsedSnapshotSlot = { body, parsed: parseSnapshotBody(body) };
  }
  return parsedSnapshotSlot.parsed;
}

export function parseStoredSnapshot(body: string): ParsedSnapshot {
  return parseSnapshotCached(body);
}

async function getStoredCommunitySnapshot(): Promise<StoredSnapshot | null> {
  cleanupLegacySnapshot();
  const result = await browser.storage.local.get(SNAPSHOT_KEY);
  const value = result[SNAPSHOT_KEY] as StoredSnapshot | undefined;
  if (value && typeof value.snapshot_version === 'string' && typeof value.body === 'string') {
    const parsed = parseSnapshotCached(value.body);
    if (parsed.ok && parsed.value.snapshot_version === value.snapshot_version) {
      return value;
    }
  }
  return null;
}

export async function getCommunitySnapshot(): Promise<StoredSnapshot | null> {
  const stored = await getStoredCommunitySnapshot();
  if (stored) return stored;
  // 首装、开发环境无 API、旧 schema 缓存失效时仍能使用随扩展发布的最终名单。
  return getBundledSnapshot();
}

export async function setCommunitySnapshot(value: StoredSnapshot): Promise<void> {
  await browser.storage.local.set({ [SNAPSHOT_KEY]: value });
}

/** popup 用：读当前已验签快照里的官方暂停开关（无快照/未设置则为 undefined）。 */
export async function getCommunityKillSwitch(): Promise<
  { destructive_actions_disabled: true; reason?: string; disabled_since?: string } | undefined
> {
  const stored = await getStoredCommunitySnapshot();
  if (!stored) return undefined;
  const parsed = parseSnapshotCached(stored.body);
  return parsed.ok ? parsed.value.kill_switch : undefined;
}

/** 传给 community-lists 同步器的存储适配器 */
export const snapshotStore = {
  // 同步节流只能看真正写入 storage 的远端快照，不能把打包兜底误当成刚同步。
  get: getStoredCommunitySnapshot,
  set: setCommunitySnapshot,
};

export interface RuntimeCommunity {
  index: CommunityIndex;
  /** 服务端最终黑名单的 handle 集合（detect 的 list 入参用） */
  handleSet: Set<string>;
  /**
   * 社区白名单（verified）：被社区验证为「误标正常」的账号。
   * 入榜公式与黑名单镜像（rescue - report >= 3）；任何检测来源都不得标注它们
   * （与黑名单 entries 数学互斥，此集合主要用于防御性先查）。
   */
  verifiedSet: ReadonlySet<string>;
  /**
   * 推荐白名单（whitelist）：维护者在 GitHub 公开维护、随快照下发的账号。
   * 一票否决，优先级最高——任何检测来源（名单/指纹/域名/词库）都不得标注或拉黑。
   */
  whitelistSet: ReadonlySet<string>;
  /**
   * 已知垃圾模板指纹集合（v0.4）。间接证据：仅「大扫除」档聚合下发，
   * 其余强度档为空集合 —— 门槛收口在这里，调用方无需重复判断。
   * v0.5 起指纹即 SimHash 位向量：detect 按汉明距离做「话术变体」匹配。
   */
  fingerprintSet: ReadonlySet<string>;
  /** 垃圾外链域名集合（v0.4，门槛同指纹） */
  domainSet: ReadonlySet<string>;
  /**
   * Campaign（v0.5）：指纹/域名命中的「垃圾网络」条目索引 handle -> 条目。
   * 标注徽章查它拿 campaign_size / campaign_entry_id，显示「同模板 N 个账号」。
   */
  campaignById: ReadonlyMap<string, CommunityEntry>;
  /**
   * 指纹值 -> 所属 campaign 条目的 handle（v0.5）：detect 命中指纹后
   * 用它反查 campaign 元数据。指纹与条目一一对应（同值可能属于同一簇）。
   */
  campaignByFingerprint: ReadonlyMap<string, string>;
  version: string;
  /** 官方破坏性动作暂停开关（来自签名快照，随验签后的快照生效） */
  killSwitch?: { destructive_actions_disabled: true; reason?: string; disabled_since?: string };
  /** 静音规则（政策 v4，误伤率超线）：检测管线不再用它们标黄框 */
  mutedRules?: ReadonlySet<string>;
}

/** 内容脚本用：快照 + 设置 -> 可用索引；关闭或无快照返回 null */
export async function buildRuntimeCommunity(): Promise<RuntimeCommunity | null> {
  const [snapshot, settings] = await Promise.all([getCommunitySnapshot(), getCommunitySettings()]);
  if (!settings.enabled || !snapshot) {
    return null;
  }
  const parsed = parseSnapshotCached(snapshot.body);
  if (!parsed.ok) {
    return null;
  }
  const index = buildIndex(parsed.value);
  const handleSet = new Set(parsed.value.entries.map((entry) => entry.handle));
  // 社区白名单：与黑名单条目数学互斥（±3 净票无交集），仍独立成集合
  // 供检测管线在一切识别之前豁免（防御性先查，防服务端异常双发）。
  const verifiedSet = new Set((parsed.value.verified ?? []).map((entry) => entry.handle));
  // 推荐白名单（维护者 GitHub 维护）：优先级最高的一票豁免来源。
  const whitelistSet = new Set((parsed.value.whitelist ?? []).map((entry) => entry.handle));
  // 指纹/域名是比名单弱的间接证据（换号复用话术、垃圾域名），
  // 按用户拍板只在「大扫除」档启用；最终账号名单不受启发式强度筛选。
  const deepClean = settings.strength === 'deep_clean';
  const fingerprintSet = new Set<string>();
  const domainSet = new Set<string>();
  const campaignById = new Map<string, CommunityEntry>();
  const campaignByFingerprint = new Map<string, string>();
  if (deepClean) {
    for (const entry of parsed.value.entries) {
      for (const fp of entry.fingerprints ?? []) {
        fingerprintSet.add(fp);
        // v0.5：指纹属于谁的 campaign？（entry 自己的 campaign_entry_id 或自己就是代表）
        const campaignHandle = entry.campaign_entry_id ?? entry.handle;
        campaignByFingerprint.set(fp, campaignHandle);
      }
      for (const domain of entry.domains ?? []) {
        domainSet.add(domain);
      }
      // v0.5 Campaign：指纹命中的簇代表条目；handle 命中名单时
      // 「同模板 N 个账号」的语义由它的 campaign 元数据提供
      if (entry.campaign_entry_id && entry.campaign_size) {
        campaignById.set(entry.campaign_entry_id, entry);
      }
    }
  }
  return {
    index,
    handleSet,
    verifiedSet,
    whitelistSet,
    fingerprintSet,
    domainSet,
    campaignById,
    campaignByFingerprint,
    version: index.version,
    ...(parsed.value.kill_switch ? { killSwitch: parsed.value.kill_switch } : {}),
    mutedRules: new Set(parsed.value.muted_rules ?? []),
  };
}
