/**
 * 一键批量拉黑执行器（popup 通过消息触发，在 content script 的 x.com 上下文执行）。
 *
 * 与「顺手拉黑」共用同一套原生产链路：缓存/当场解析 rest_id -> blocks/create.json。
 * 策略：
 * - 逐个拉黑，成功即从待拉黑列表移除，并把页面上该账号的推文一并移除；
 * - 失败如实保留在列表（含无 ID、限流、认证过期），最终汇总回报 popup；
 * - 请求间小间隔节流，避免连击触发 X 风控。
 */

import { resolveUserIdByHandle, runNativeAction } from '@feedsieve/x-adapter';
import { markBlocked } from './blocked-accounts';
import { bumpStat } from './local-stats';
import { bumpDaily } from './daily-stats';
import { getPendingBlocks, removePendingBlock, type PendingBlock } from './pending-blocks';
import { getUserId } from './user-ids';
import { collectCellsByHandle, removeCellsSoon } from './remove-tweets';
import { contributeBlocks, type ContributionItem } from './contribute';

export interface BatchBlockResult {
  blocked: string[];
  failed: Array<{ handle: string; code: string }>;
}

/** 相邻两次拉黑请求的间隔（毫秒）。 */
const PACE_MS = 400;

export async function runPendingBlockBatch(): Promise<BatchBlockResult> {
  const pending = await getPendingBlocks();
  const blocked: string[] = [];
  const failed: Array<{ handle: string; code: string }> = [];
  const contributions: ContributionItem[] = [];

  for (const item of pending) {
    const outcome = await blockOne(item);
    if (outcome.ok) {
      blocked.push(item.handle);
      await removePendingBlock(item.handle);
      await markBlocked(item.handle, item.xUserId);
      await bumpStat('blocked');
      // v0.6 战报：今日拉黑 + 分类计数（贡献分类，见 contribute.ts）
      await bumpDaily('blocked', item.category ?? 'other');
      // 对齐「顺手拉黑」：该账号页面上可见的推文一并移除
      removeCellsSoon(collectCellsByHandle(item.handle));
      // 摩擦设计：拉黑成功即自动贡献社区（全局开关在 contributeBlocks 内部判断）
      contributions.push({
        handle: item.handle,
        ...(item.xUserId ? { xUserId: item.xUserId } : {}),
        category: item.category ?? 'other',
        ...(item.contentFingerprint
          ? { contentFingerprint: item.contentFingerprint }
          : {}),
        ...(item.linkDomains?.length
          ? { linkDomains: item.linkDomains }
          : {}),
      });
    } else {
      failed.push({ handle: item.handle, code: outcome.code });
    }
    await sleep(PACE_MS);
  }

  contributeBlocks(contributions);
  return { blocked, failed };
}

/** 单个账号的完整拉黑链路；不抛异常，一切失败都转成结构化结果。 */
async function blockOne(
  item: PendingBlock,
): Promise<{ ok: true } | { ok: false; code: string }> {
  // rest_id 三级兜底：列表快照 -> 缓存 -> 当场解析
  let xUserId = item.xUserId ?? (await getUserId(item.handle));
  if (!xUserId) {
    xUserId = (await resolveUserIdByHandle(item.handle)) ?? undefined;
  }
  if (!xUserId) {
    return { ok: false, code: 'no-id' };
  }

  const result = await runNativeAction('block', xUserId);
  if (result.ok) {
    return { ok: true };
  }
  return { ok: false, code: result.code };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}