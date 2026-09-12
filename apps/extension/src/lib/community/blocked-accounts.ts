/**
 * 已拉黑账号记录（一键撤销 Unblock 的数据源）。
 *
 * 拉黑成功即记账（顺手拉黑 / 一键拉黑共用同一入口），popup 据此提供撤销入口。
 * chrome.storage.local 持久化。
 */

import { enqueueStorageWrite } from '../platform/storage-mutex';

export interface BlockedAccount {
  handle: string;
  xUserId?: string;
  blockedAt: number;
  /** 这次拉黑是怎么发生的；用于防止云端名单自我放大。 */
  origin?: BlockOrigin;
  /** false 表示只记本地 Block，不作为新的社区举报票。 */
  communityVote?: boolean;
  /** 云端/页面批次 ID，用于定向回滚。 */
  batchId?: string;
  /** 拉黑时的检测证据；旧记录没有这些字段，历史同步时按 other 处理。 */
  category?: string;
  contentFingerprint?: string;
  linkDomains?: string[];
  /** 这次判断的来源；手动标记 = manual，与检测器命中区分开（规则质量分析用）。 */
  detectionSource?: string;
  /** 击杀时刻探活（#2）：本次拉黑伴随的 UserByScreenName 现场解析结果；缓存命中或未解析时缺省。
   * 只表达观测，不做清理决策；官方名单失效口径在服务端 account_health。 */
  liveness?: 'alive' | 'dead';
  /** 拉黑目标当时那条推文的原文（判定材料，供用户回查误拉黑 + 随票上报后台分析）。
   * 判定材料随票上报是 2026-09-12 用户拍板（推文本就公开）；只进 reports 通道，不进其它链路。 */
  tweetSnippet?: string;
  /** 拉黑时刻的作者昵称（黄土判定材料）。 */
  displayName?: string;
  /** 拉黑时刻的作者简介原文（判定材料；bio 启发式命中的依据）。 */
  bio?: string;
}

export type BlockOrigin =
  'manual-spam' | 'manual-personal' | 'single-detection' | 'page-batch' | 'community-batch';

export interface BlockedAccountEvidence {
  /** 注意：不在这里带推文原文/简介/昵称 —— evidence 会被展开进多个通道，
   * 判定材料走 markBlocked 的独立 facts 参数统一收口。 */
  category: string;
  contentFingerprint?: string;
  linkDomains?: string[];
  detectionSource?: string;
  origin?: BlockOrigin;
  communityVote?: boolean;
  batchId?: string;
  liveness?: 'alive' | 'dead';
}

const STORAGE_KEY = 'blockedAccounts';

export async function getBlockedAccounts(): Promise<BlockedAccount[]> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const value = result[STORAGE_KEY];
  return Array.isArray(value) ? (value as BlockedAccount[]) : [];
}

/** 记账（幂等）：已存在则不动 blockedAt，保留首次拉黑时间。
 *
 * 整个读-改-写走 storage 写互斥：单条拉黑与队列拉黑可并发完成，无互斥时
 * 两个调用会读到同一数组，后写者覆盖前写者，丢撤销记录（review F2）。
 */
export interface BlockedAccountFacts {
  /** 判定材料（推文原文 / 昵称 / 简介）：本机留档 + 随票上报，用户拍板口径见字段注释。 */
  tweetSnippet?: string;
  displayName?: string;
  bio?: string;
}

export async function markBlocked(
  handle: string,
  xUserId?: string,
  evidence?: BlockedAccountEvidence,
  /** 判定材料快照；独立传参避免混进 evidence 展开链。 */
  facts?: BlockedAccountFacts,
): Promise<void> {
  return enqueueStorageWrite(async () => {
    const normalized = normalize(handle);
    if (!normalized) {
      return;
    }
    const accounts = await getBlockedAccounts();
    const existing = accounts.find((a) => a.handle === normalized);
    if (existing) {
      let changed = false;
      if (!existing.xUserId && xUserId) {
        existing.xUserId = xUserId;
        changed = true;
      }
      if (evidence) {
        existing.category = evidence.category;
        existing.contentFingerprint = evidence.contentFingerprint;
        existing.linkDomains = evidence.linkDomains;
        existing.detectionSource = evidence.detectionSource ?? existing.detectionSource;
        existing.origin = evidence.origin ?? existing.origin;
        existing.communityVote = evidence.communityVote ?? existing.communityVote;
        existing.batchId = evidence.batchId ?? existing.batchId;
        existing.liveness = evidence.liveness ?? existing.liveness;
        changed = true;
      }
      // 判定材料只补不覆盖：保留首次拉黑时的现场，撤销重拉也不替换
      if (facts?.tweetSnippet && !existing.tweetSnippet) {
        existing.tweetSnippet = truncateText(facts.tweetSnippet.trim(), TWEET_SNIPPET_MAX);
        changed = true;
      }
      if (facts?.displayName && !existing.displayName) {
        existing.displayName = truncateText(facts.displayName.trim(), DISPLAY_NAME_MAX);
        changed = true;
      }
      if (facts?.bio && !existing.bio) {
        existing.bio = truncateText(facts.bio.trim(), BIO_TEXT_MAX);
        changed = true;
      }
      if (changed) {
        await browser.storage.local.set({ [STORAGE_KEY]: accounts });
      }
      return;
    }
    accounts.push({
      handle: normalized,
      ...(xUserId ? { xUserId } : {}),
      ...(evidence?.category ? { category: evidence.category } : {}),
      ...(evidence?.contentFingerprint ? { contentFingerprint: evidence.contentFingerprint } : {}),
      ...(evidence?.linkDomains?.length ? { linkDomains: evidence.linkDomains } : {}),
      ...(evidence?.detectionSource ? { detectionSource: evidence.detectionSource } : {}),
      ...(evidence?.origin ? { origin: evidence.origin } : {}),
      ...(typeof evidence?.communityVote === 'boolean'
        ? { communityVote: evidence.communityVote }
        : {}),
      ...(evidence?.batchId ? { batchId: evidence.batchId } : {}),
      ...(evidence?.liveness ? { liveness: evidence.liveness } : {}),
      ...normalizeFacts(facts),
      blockedAt: Date.now(),
    });
    await browser.storage.local.set({ [STORAGE_KEY]: accounts });
  });
}

/** 撤销成功后移除记录。幂等。整个读-改-写走 storage 写互斥（同 markBlocked）。 */
export async function removeBlockedAccount(handle: string): Promise<void> {
  return enqueueStorageWrite(async () => {
    const normalized = normalize(handle);
    const remaining = (await getBlockedAccounts()).filter((a) => a.handle !== normalized);
    await browser.storage.local.set({ [STORAGE_KEY]: remaining });
  });
}

/** 批量原位更新（存量分类升级等治理用）；有变更才写盘，返回变更条数。整个读-改-写走 storage 写互斥。 */
export async function mutateBlockedAccounts(
  mutate: (accounts: BlockedAccount[]) => number,
): Promise<number> {
  return enqueueStorageWrite(async () => {
    const accounts = await getBlockedAccounts();
    const changed = mutate(accounts);
    if (changed > 0) {
      await browser.storage.local.set({ [STORAGE_KEY]: accounts });
    }
    return changed;
  });
}

/** 订阅变化（popup 实时刷新）。返回解绑函数。 */
export function subscribeBlocked(onChange: (accounts: BlockedAccount[]) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
    if (areaName === 'local' && changes[STORAGE_KEY]) {
      void getBlockedAccounts().then(onChange);
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

function normalize(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}

/** 判定材料上限：够回查与分析用，防 storage/上报无界膨胀。 */
const TWEET_SNIPPET_MAX = 500;
const DISPLAY_NAME_MAX = 100;
const BIO_TEXT_MAX = 500;

function truncateText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function normalizeFacts(
  facts?: BlockedAccountFacts,
): Partial<Pick<BlockedAccount, 'tweetSnippet' | 'displayName' | 'bio'>> {
  if (!facts) return {};
  const tweetSnippet = facts.tweetSnippet?.trim();
  const displayName = facts.displayName?.trim();
  const bio = facts.bio?.trim();
  return {
    ...(tweetSnippet ? { tweetSnippet: truncateText(tweetSnippet, TWEET_SNIPPET_MAX) } : {}),
    ...(displayName ? { displayName: truncateText(displayName, DISPLAY_NAME_MAX) } : {}),
    ...(bio ? { bio: truncateText(bio, BIO_TEXT_MAX) } : {}),
  };
}
