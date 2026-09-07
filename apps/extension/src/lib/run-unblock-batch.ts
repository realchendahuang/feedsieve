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
import { getUserId, saveUserIds } from './user-ids';

export interface UnblockBatchResult {
  unblocked: string[];
  failed: Array<{ handle: string; code: string }>;
}

/**
 * 相邻两次撤销请求的间隔（毫秒）。
 * TODO(block-safety PR2, docs/BLOCK_SAFETY.md)：撤销仍 400ms 定速且不占安全账本；
 * 与批量拉黑共用同一 pace + 响应式预算的改动留到新版后按生产数据再做。
 */
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
    const resolved = await resolveUserIdByHandle(handle);
    if (resolved.ok) {
      xUserId = resolved.xUserId;
      void saveUserIds([{ handle, xUserId }]).catch(() => {
        // 回填失败不影响本次撤销
      });
    } else {
      // no_csrf 与 missing_csrf 同属会话失效，block-queue classifyFailure 统一判 pause
      return {
        ok: false,
        code: resolved.code,
      };
    }
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