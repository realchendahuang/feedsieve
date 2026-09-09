/**
 * 存量拉黑票分类升级（只升不降）。
 *
 * 旧票分类定格在拉黑瞬间的窄映射上，大量带具体证据的拉黑被投成 'other'
 * （服务端还叠加了历史回声票，把多数分类钉死在 other）。这里只对 'other' 票
 * 用本地已存证据重算，且证据必须是社区快照已下发的达标证据（≥2 独立安装一致
 * 才会入快照）：
 * - 外链域名命中社区垃圾域名集 → scam_phishing
 * - 话术指纹命中社区模板指纹集 → copy_paste
 * 升级后 labelSignature 变化，下次同步自动重传，服务端 reason 原地更新。
 */
import { parseSnapshotBody } from '@feedsieve/community-lists';
import {
  getBlockedAccounts,
  mutateBlockedAccounts,
  type BlockedAccount,
} from './blocked-accounts';
import { getCommunitySnapshot } from './community-store';

export interface SpamEvidenceSets {
  fingerprints: ReadonlySet<string>;
  domains: ReadonlySet<string>;
}

/** 从已验签快照提取社区达标证据集（与检测管线的强度档无关，升级不受档位筛选）。 */
export async function loadSpamEvidenceSets(): Promise<SpamEvidenceSets> {
  const snapshot = await getCommunitySnapshot();
  const fingerprints = new Set<string>();
  const domains = new Set<string>();
  if (!snapshot) {
    return { fingerprints, domains };
  }
  const parsed = parseSnapshotBody(snapshot.body);
  if (parsed.ok) {
    for (const entry of parsed.value.entries) {
      for (const fp of entry.fingerprints ?? []) fingerprints.add(fp);
      for (const domain of entry.domains ?? []) domains.add(domain);
    }
  }
  return { fingerprints, domains };
}

/** 纯函数：'other' 票按证据升级；已有具体分类不动（不降级、不改判）。 */
export function recomputeBlockedCategory(
  item: Pick<BlockedAccount, 'category' | 'contentFingerprint' | 'linkDomains'>,
  evidence: SpamEvidenceSets,
): string {
  const current = item.category ?? 'other';
  if (current !== 'other') {
    return current;
  }
  if (item.linkDomains?.some((domain) => evidence.domains.has(domain))) {
    return 'scam_phishing';
  }
  if (item.contentFingerprint && evidence.fingerprints.has(item.contentFingerprint)) {
    return 'copy_paste';
  }
  return current;
}

/** 对存量本地黑名单做分类升级；无候选或快照无证据时零开销跳过。返回升级条数。 */
export async function upgradeBlockedCategories(): Promise<number> {
  const accounts = await getBlockedAccounts();
  const upgradable = accounts.some(
    (item) =>
      (item.category ?? 'other') === 'other' &&
      (Boolean(item.contentFingerprint) || (item.linkDomains?.length ?? 0) > 0),
  );
  if (!upgradable) {
    return 0;
  }
  const evidence = await loadSpamEvidenceSets();
  if (evidence.fingerprints.size === 0 && evidence.domains.size === 0) {
    return 0;
  }
  return mutateBlockedAccounts((all) => {
    let changed = 0;
    for (const item of all) {
      const next = recomputeBlockedCategory(item, evidence);
      if (next !== (item.category ?? 'other')) {
        item.category = next;
        changed++;
      }
    }
    return changed;
  });
}
