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
  type CommunityIndex,
  type MarkStrength,
  type StoredSnapshot,
  type SyncSource,
} from '@feedsieve/community-lists';

export const COMMUNITY_API_BASE = 'https://feedsieve-api.chendahuang.com';

/**
 * 快照双源：Worker 主源；jsDelivr 镜像兜底（Worker 不可达时）。
 * 镜像内容 = 仓库 community/lists/ 最近一次提交（scripts/mirror-community-lists.sh 维护）。
 */
export const COMMUNITY_SYNC_SOURCES: SyncSource[] = [
  workerSource(COMMUNITY_API_BASE),
  {
    manifestUrl:
      'https://cdn.jsdelivr.net/gh/realchendahuang/feedsieve@main/community/lists/manifest.json',
    fileUrl: (_version, path) =>
      `https://cdn.jsdelivr.net/gh/realchendahuang/feedsieve@main/community/lists/${path}`,
  },
];

const SNAPSHOT_KEY = 'communitySnapshot';
const SETTINGS_KEY = 'communitySettings';

export interface CommunitySettings {
  /** 社区名单总开关（关掉后只跑启发式 + 内置名单） */
  enabled: boolean;
  /** 标注强度：清爽 / 标准 / 大扫除 */
  strength: MarkStrength;
  /**
   * 拉黑后自动贡献给社区名单（默认开，全局开关，绝无逐条弹窗）。
   * 隐私承诺：只有用户主动拉黑才产生上报，上传内容仅限
   * handle / x_user_id / 分类，绝无浏览历史等被动数据。
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
  if (
    !value ||
    typeof value.snapshot_version !== 'string' ||
    typeof value.body !== 'string'
  ) {
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
    strength: isMarkStrength(value['strength'])
      ? value['strength']
      : DEFAULT_MARK_STRENGTH,
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

export function subscribeCommunity(
  onChange: () => void,
): () => void {
  const listener = (
    changes: Record<string, unknown>,
    areaName: string,
  ) => {
    if (
      areaName === 'local' &&
      (changes[SNAPSHOT_KEY] || changes[SETTINGS_KEY])
    ) {
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
  version: string;
}

/** 内容脚本用：快照 + 设置 -> 可用索引；关闭或无快照返回 null */
export async function buildRuntimeCommunity(): Promise<RuntimeCommunity | null> {
  const [snapshot, settings] = await Promise.all([
    getCommunitySnapshot(),
    getCommunitySettings(),
  ]);
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
  return { index, handleSet, version: index.version };
}
