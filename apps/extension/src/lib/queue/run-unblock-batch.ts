/**
 * 一键撤销执行器（popup 通过消息触发，在 content script 的 x.com 上下文执行）。
 *
 * 与批量拉黑对称：遍历已拉黑记录，逐个调 `1.1/blocks/destroy.json`，
 * 成功即移除记录并计入本地统计；无 handle 参数时撤销全部。
 */

import { resolveUserIdByHandle, runNativeAction } from '@feedsieve/x-adapter';
import { classifyFailure } from '@feedsieve/block-queue';
import { getBlockedAccounts, removeBlockedAccount } from '../community/blocked-accounts';
import { bumpStat } from '../stats/local-stats';
import { bumpDaily } from '../stats/daily-stats';
import { getUserId, saveUserIds } from '../community/user-ids';
import { currentAccountKey, recordSafetyEvent } from './block-safety';

export interface UnblockBatchResult {
  unblocked: string[];
  failed: Array<{ handle: string; code: string }>;
  /**
   * 批次中止时的失败码（会话失效 / 429 / 端点不支持）。
   * block 队列对这类失败整队 pause；撤销是一次性脚本级批次，走「立即停」，
   * 继续对失效会话定速硬磨是风暴级风控暴露面（2026-09-12 修复）。
   */
  abortedBy?: string;
}

/**
 * 相邻两次撤销请求的间隔（毫秒）。
 * 撤销成功已计入安全账本（recordSafetyEvent）；与批量拉黑共用 pace 的响应式
 * 预算改动留到新版后按生产数据再做（docs/BLOCK_SAFETY.md 撤销 PR2）。
 */
const PACE_MS = 400;

/** 触发批次立即中止的失败类：pause（含 429 风暴码）与 unsupported。 */
function isAbortClass(code: string): boolean {
  const failureClass = classifyFailure({ code });
  return (
    failureClass === 'pause' ||
    failureClass === 'unsupported' ||
    // 定速撤销遇到限流时不能 KO 明日再来：继续磨等于撞 429 风暴
    failureClass === 'transient'
  );
}

export async function runUnblockBatch(handle?: string): Promise<UnblockBatchResult> {
  const targets = (await getBlockedAccounts()).filter(
    (account) => !handle || account.handle === handle,
  );
  const unblocked: string[] = [];
  const failed: Array<{ handle: string; code: string }> = [];
  const result: UnblockBatchResult = { unblocked, failed };
  let abortedBy: string | undefined;

  for (const account of targets) {
    const outcome = await unblockOne(account.handle, account.xUserId);
    if (outcome.ok) {
      unblocked.push(account.handle);
      await removeBlockedAccount(account.handle);
      await bumpStat('unblocked');
      // v0.6 战报：今日撤销（无分类）
      await bumpDaily('unblocked');
      // 撤销与拉黑同占风控额度（BLOCK_SAFETY.md PR1 对齐）：成功即记账，
      // 拉黑+撤销混合当天也走同一本账
      await recordSafetyEvent(currentAccountKey());
    } else {
      failed.push({ handle: account.handle, code: outcome.code });
      if (isAbortClass(outcome.code)) {
        abortedBy = outcome.code;
        break;
      }
    }
    await sleep(PACE_MS);
  }

  if (abortedBy) {
    // 未处理的余量条目也如实呈现为该失败码
    for (const account of targets) {
      if (
        unblocked.includes(account.handle) ||
        failed.some((f) => f.handle === account.handle)
      ) {
        continue;
      }
      failed.push({ handle: account.handle, code: abortedBy });
    }
    result.abortedBy = abortedBy;
  }
  return result;
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