/**
 * 最终黑名单快照协议 v2（与 apps/community-api 的产出一一对应）。
 * 该包是纯 TS 消费端：不依赖 chrome/browser，同步逻辑全部依赖注入，可完整单测。
 */

export interface SnapshotManifestFile {
  path: string;
  sha256: string;
  entries: number;
}

export interface SnapshotManifest {
  schema_version: number;
  snapshot_version: string;
  generated_at: string;
  files: SnapshotManifestFile[];
}

export type CommunitySource = 'community' | 'maintainer';

export interface CommunityEntry {
  handle: string;
  x_user_id: string | null;
  category: string;
  /** 为什么进入最终名单；社区共识、维护者明确加入，或两者兼有。 */
  sources: CommunitySource[];
  /** 维护者来源的公开说明；不存在维护者来源时省略。 */
  maintainer_note?: string;
  /** 可解释的社区证据分数 [0,1]；维护者单源条目为 0。 */
  community_score: number;
  report_count: number;
  rescue_count: number;
  /** report_count - rescue_count；仅用于公开解释，不由客户端再次判定入榜。 */
  net_votes: number;
  /** 换号别名：同 x_user_id 的历史 handle（可选） */
  aliases?: string[];
  /**
   * 已知垃圾模板指纹（v0.4，可选）：≥2 个独立安装上报同一归一化话术哈希才下发。
   * 间接证据 —— 扩展只在「大扫除」强度档用它标注（换号复用话术仍能认出）。
   * v0.5 起指纹即 SimHash 位向量：扩展按汉明距离 <= 2 判「话术变体」。
   */
  fingerprints?: string[];
  /** 垃圾外链域名（v0.4，可选）：门槛同指纹 */
  domains?: string[];
  /**
   * Campaign（v0.5，可选）：该账号所属垃圾网络的「代表条目」handle。
   * 聚类规则：同指纹簇（互相汉明距离 <= 2）内取 report_count 最高的条目为代表；
   * 只有簇内 >= 2 个账号才产生 campaign 语义（单账号无网络）。
   */
  campaign_entry_id?: string;
  /** Campaign 规模（v0.5，可选）：该簇内账号数，徽章显示「同模板 N 个账号」 */
  campaign_size?: number;
  first_seen_at: string;
  updated_at: string;
  evidence_post_ids: string[];
}

export interface SnapshotBody {
  schema_version: number;
  snapshot_version: string;
  generated_at: string;
  entries: CommunityEntry[];
}

/** 本地缓存的快照（last-known-good：只在全部校验通过后整体写入） */
export interface StoredSnapshot {
  snapshot_version: string;
  /** 序列化好的快照 JSON（原样保存，构建索引时再解析） */
  body: string;
  synced_at: number;
}

/** 启发式提示强度；不再筛选服务器已经确定的最终黑名单。 */
export type MarkStrength = 'refresh' | 'standard' | 'deep_clean';

export const MARK_STRENGTHS: readonly MarkStrength[] = [
  'refresh',
  'standard',
  'deep_clean',
] as const;

export const DEFAULT_MARK_STRENGTH: MarkStrength = 'standard';

export function isMarkStrength(value: unknown): value is MarkStrength {
  return typeof value === 'string' && (MARK_STRENGTHS as readonly string[]).includes(value);
}
