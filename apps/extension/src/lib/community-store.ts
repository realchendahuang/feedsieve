/**
 * 社区名单本地状态：快照缓存（last-known-good）+ 用户设置。
 * 快照的拉取/校验逻辑在 @feedsieve/community-lists（纯函数），
 * 这里只提供 browser.storage 适配与运行时索引构建。
 */
import {
  buildIndex,
  isMarkStrength,
  isStatusAllowed,
  parseSnapshotBody,
  workerSource,
  DEFAULT_MARK_STRENGTH,
  type CommunityEntry,
  type CommunityIndex,
  type MarkStrength,
  type StoredSnapshot,
  type SyncSource,
} from '@feedsieve/community-lists';

export const COMMUNITY_API_BASE = 'https://feedsieve-api.chendahuang.com';

/**
 * 快照来源：官方 Worker 单源（最小 host 权限：x.com + 官方 API）。
 * 仓库 community/lists/ 镜像仅为公开存档（scripts/mirror-community-lists.sh 维护），
 * 扩展不直接拉取第三方 CDN。
 */
export const COMMUNITY_SYNC_SOURCES: SyncSource[] = [workerSource(COMMUNITY_API_BASE)];

const SNAPSHOT_KEY = 'communitySnapshot';
const SETTINGS_KEY = 'communitySettings';

export interface CommunitySettings {
  /** 社区名单总开关（关掉后只跑启发式 + 内置名单） */
  enabled: boolean;
  /** 标注强度：清爽 / 标准 / 大扫除 */
  strength: MarkStrength;
  /**
   * 同步用户明确维护的本地黑名单/白名单（默认开，全局开关，绝无逐条弹窗）。
   * 黑名单上传 handle / 可选 x_user_id / 分类 / 话术指纹哈希 / 外链域名；
   * 白名单上传 handle / 可选 x_user_id / 当时的检测来源、规则与理由。
   * 不上传浏览历史、推文原文或任何被动页面记录。
   */
  autoContribute: boolean;
}

export const DEFAULT_COMMUNITY_SETTINGS: CommunitySettings = {
  enabled: true,
  strength: DEFAULT_MARK_STRENGTH,
  autoContribute: true,
};

export async function getCommunitySnapshot(): Promise<StoredSnapshot | null> {
  const result = await browser.storage.local.get(SNAPSHOT_KEY);
  const value = result[SNAPSHOT_KEY] as StoredSnapshot | undefined;
  if (!value || typeof value.snapshot_version !== 'string' || typeof value.body !== 'string') {
    return null;
  }
  return value;
}

export async function setCommunitySnapshot(value: StoredSnapshot): Promise<void> {
  await browser.storage.local.set({ [SNAPSHOT_KEY]: value });
}

/** 传给 community-lists 同步器的存储适配器 */
export const snapshotStore = {
  get: getCommunitySnapshot,
  set: setCommunitySnapshot,
};

export async function getCommunitySettings(): Promise<CommunitySettings> {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  const value = (result[SETTINGS_KEY] ?? {}) as Record<string, unknown>;
  return {
    enabled: value['enabled'] !== false,
    strength: isMarkStrength(value['strength']) ? value['strength'] : DEFAULT_MARK_STRENGTH,
    autoContribute: value['autoContribute'] !== false,
  };
}

export async function setCommunitySettings(
  patch: Partial<CommunitySettings>,
): Promise<CommunitySettings> {
  const next = { ...(await getCommunitySettings()), ...patch };
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export function subscribeCommunity(onChange: () => void): () => void {
  const listener = (changes: Record<string, unknown>, areaName: string) => {
    if (areaName === 'local' && (changes[SNAPSHOT_KEY] || changes[SETTINGS_KEY])) {
      onChange();
    }
  };
  browser.storage.onChanged.addListener(
    listener as Parameters<typeof browser.storage.onChanged.addListener>[0],
  );
  return () =>
    browser.storage.onChanged.removeListener(
      listener as Parameters<typeof browser.storage.onChanged.removeListener>[0],
    );
}

export interface RuntimeCommunity {
  index: CommunityIndex;
  /** 当前强度下可见的 handle 集合（detect 的 list 入参用） */
  handleSet: Set<string>;
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
}

/** 内容脚本用：快照 + 设置 -> 可用索引；关闭或无快照返回 null */
export async function buildRuntimeCommunity(): Promise<RuntimeCommunity | null> {
  const [snapshot, settings] = await Promise.all([getCommunitySnapshot(), getCommunitySettings()]);
  if (!settings.enabled || !snapshot) {
    return null;
  }
  const parsed = parseSnapshotBody(snapshot.body);
  if (!parsed.ok) {
    return null;
  }
  const index = buildIndex(parsed.value, settings.strength);
  const handleSet = new Set<string>();
  for (const entry of parsed.value.entries) {
    if (isStatusAllowed(entry.status, settings.strength)) {
      handleSet.add(entry.handle);
    }
  }
  // 指纹/域名是比名单弱的间接证据（换号复用话术、垃圾域名），
  // 按用户拍板只在「大扫除」档启用；快照条目本身已按强度过滤。
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
    fingerprintSet,
    domainSet,
    campaignById,
    campaignByFingerprint,
    version: index.version,
  };
}
