/**
 * 一键撤销执行器（popup 通过消息触发，在 content script 的 x.com 上下文执行）。
 *
 * 与批量拉黑对称：遍历已拉黑记录，逐个调 `1.1/blocks/destroy.json`，
 * 成功即移除记录并计入本地统计；无 handle 参数时撤销全部。
 */

import { resolveUserIdByHandle, runNativeAction } from '@feedsieve/x-adapter';
import { getBlockedAccounts, removeBlockedAccount } from './blocked-accounts';
import { bumpStat } from './local-stats';
import { bumpDaily } from './daily-stats';
import { getUserId } from './user-ids';

export interface UnblockBatchResult {
  unblocked: string[];
  failed: Array<{ handle: string; code: string }>;
}

/** 相邻两次撤销请求的间隔（毫秒），与批量拉黑一致。 */
const PACE_MS = 400;

export async function runUnblockBatch(handle?: string): Promise<UnblockBatchResult> {
  const targets = (await getBlockedAccounts()).filter(
    (account) => !handle || account.handle === handle,
  );
  const unblocked: string[] = [];
  const failed: Array<{ handle: string; code: string }> = [];

  for (const account of targets) {
    const outcome = await unblockOne(account.handle, account.xUserId);
    if (outcome.ok) {
      unblocked.push(account.handle);
      await removeBlockedAccount(account.handle);
      await bumpStat('unblocked');
      // v0.6 战报：今日撤销（无分类）
      await bumpDaily('unblocked');
    } else {
      failed.push({ handle: account.handle, code: outcome.code });
    }
    await sleep(PACE_MS);
  }

  return { unblocked, failed };
}

async function unblockOne(
  handle: string,
  cachedId?: string,
): Promise<{ ok: true } | { ok: false; code: string }> {
  let xUserId = cachedId ?? (await getUserId(handle));
  if (!xUserId) {
    xUserId = (await resolveUserIdByHandle(handle)) ?? undefined;
  }
  if (!xUserId) {
    return { ok: false, code: 'no-id' };
  }

  const result = await runNativeAction('unblock', xUserId);
  if (result.ok) {
    return { ok: true };
  }
  return { ok: false, code: result.code };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}