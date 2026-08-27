import { useEffect, useState } from 'react';
import {
  clearPendingBlocks,
  getPendingBlocks,
  removePendingBlock,
  subscribePending,
  type PendingBlock,
} from '../../src/lib/pending-blocks';
import {
  getBlockedAccounts,
  subscribeBlocked,
  type BlockedAccount,
} from '../../src/lib/blocked-accounts';
import { getStats, subscribeStats, type LocalStats } from '../../src/lib/local-stats';
import type { BatchBlockResult } from '../../src/lib/run-block-batch';
import type { UnblockBatchResult } from '../../src/lib/run-unblock-batch';

const FAILURE_LABELS: Record<string, string> = {
  'no-id': '无用户ID',
  auth_required: '登录已失效',
  rate_limited: '被限流',
  http_error: '接口异常',
  network_error: '网络失败',
  missing_csrf: '登录态缺失',
};

const BLOCK_MESSAGE = { type: 'feedsieve:run-block-batch' } as const;

const EMPTY_STATS: LocalStats = { detected: 0, blocked: 0, unblocked: 0 };

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export default function App() {
  const [blocks, setBlocks] = useState<PendingBlock[] | null>(null);
  const [blocked, setBlocked] = useState<BlockedAccount[] | null>(null);
  const [stats, setStats] = useState<LocalStats>(EMPTY_STATS);
  const [running, setRunning] = useState(false);
  const [blockResult, setBlockResult] = useState<BatchBlockResult | null>(null);
  const [unblockResult, setUnblockResult] = useState<UnblockBatchResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void getPendingBlocks().then(setBlocks);
    void getBlockedAccounts().then(setBlocked);
    void getStats().then(setStats);
    const unsubs = [
      subscribePending(setBlocks),
      subscribeBlocked(setBlocked),
      subscribeStats(setStats),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  async function sendToXPage(
    message: { type: string; handle?: string },
  ): Promise<unknown> {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error('no active tab');
    }
    return browser.tabs.sendMessage(tab.id, message);
  }

  async function runBatch(): Promise<void> {
    setRunning(true);
    setNotice(null);
    setBlockResult(null);
    setUnblockResult(null);
    try {
      const result = (await sendToXPage(BLOCK_MESSAGE)) as BatchBlockResult;
      setBlockResult(result);
    } catch {
      setNotice('没找到 X 页面会话：先打开 x.com，再点一键拉黑');
    } finally {
      setRunning(false);
    }
  }

  /** handle 缺省时撤销全部已拉黑账号。 */
  async function runUnblock(handle?: string): Promise<void> {
    setRunning(true);
    setNotice(null);
    setBlockResult(null);
    setUnblockResult(null);
    try {
      const result = (await sendToXPage({
        type: 'feedsieve:unblock',
        ...(handle ? { handle } : {}),
      })) as UnblockBatchResult;
      setUnblockResult(result);
    } catch {
      setNotice('没找到 X 页面会话：先打开 x.com，再撤销');
    } finally {
      setRunning(false);
    }
  }

  async function removeOne(handle: string): Promise<void> {
    await removePendingBlock(handle);
  }

  async function clearAll(): Promise<void> {
    if (window.confirm('清空待拉黑列表？已经拉黑的不受影响。')) {
      await clearPendingBlocks();
    }
  }

  const count = blocks?.length ?? null;
  const blockedCount = blocked?.length ?? null;
  const failedSummary = (result: { failed: Array<{ handle: string; code: string }> } | null) =>
    result?.failed.length
      ? result.failed
          .map((f) => `@${f.handle}（${FAILURE_LABELS[f.code] ?? f.code}）`)
          .join('、')
      : null;

  return (
    <main className="popup">
      <header className="popup-header">
        <h1>
          福滤娃 <span className="popup-sub">FeedSieve</span>
        </h1>
        <p className="tagline">X 赛博清洁工 · 看不到之前，先送走</p>
      </header>

      {/* 本地统计：全部动作只发生在你自己这台机器上 */}
      <section className="stats-bar">
        <span title="黄框标注次数">标注 {stats.detected}</span>
        <span title="已拉黑账号数">拉黑 {stats.blocked}</span>
        <span title="已撤销账号数">撤销 {stats.unblocked}</span>
      </section>

      {/* 待拉黑列表：可单项移除、可清空；勾选在 Timeline 黄框里进行 */}
      <section className="list-card">
        <div className="list-head">
          <span className="stat-label">待拉黑列表</span>
          <span className="list-count">{count === null ? '…' : `${count} 个`}</span>
        </div>

        {count === null ? (
          <p className="list-empty">…</p>
        ) : count === 0 ? (
          <p className="list-empty">
            {running ? '正在拉黑…' : '在 Timeline 黄框里勾选垃圾账号，会累积到这里'}
          </p>
        ) : (
          <ul className="pending-list">
            {blocks!.map((block) => (
              <li key={block.handle} className="pending-item">
                <div className="pending-info">
                  <span className="pending-handle">@{block.handle}</span>
                  {block.markedReason ? (
                    <span className="pending-reason">{block.markedReason}</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="remove-btn"
                  title="移出列表"
                  disabled={running}
                  onClick={() => void removeOne(block.handle)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        {blockResult ? (
          <p className="batch-summary">
            ✅ 已拉黑 {blockResult.blocked.length} 个
            {failedSummary(blockResult) ? (
              <>
                {' '}
                · 失败 {blockResult.failed.length}：
                <span className="batch-fail">{failedSummary(blockResult)}</span>
              </>
            ) : null}
          </p>
        ) : null}
      </section>

      <button
        className="primary-action"
        disabled={!count || running}
        onClick={() => void runBatch()}
      >
        {running ? '处理中…' : `一键拉黑${count ? `（${count}）` : ''}`}
      </button>
      <button
        className="secondary-action"
        disabled={!count || running}
        onClick={() => void clearAll()}
      >
        清空列表
      </button>

      {/* 已拉黑记录：撤销入口（误伤恢复用） */}
      <section className="list-card blocked-card">
        <div className="list-head">
          <span className="stat-label">已拉黑（可撤销）</span>
          <span className="list-count">
            {blockedCount === null ? '…' : `${blockedCount} 个`}
          </span>
        </div>

        {blockedCount === null || blockedCount === 0 ? (
          <p className="list-empty">暂无已拉黑记录</p>
        ) : (
          <ul className="pending-list">
            {blocked!.map((account) => (
              <li key={account.handle} className="pending-item">
                <div className="pending-info">
                  <span className="pending-handle">@{account.handle}</span>
                  <span className="pending-reason">{formatDate(account.blockedAt)} 拉黑</span>
                </div>
                <button
                  type="button"
                  className="unblock-btn"
                  disabled={running}
                  onClick={() => void runUnblock(account.handle)}
                >
                  撤销
                </button>
              </li>
            ))}
          </ul>
        )}

        {unblockResult ? (
          <p className="batch-summary">
            ↩️ 已撤销 {unblockResult.unblocked.length} 个
            {failedSummary(unblockResult) ? (
              <>
                {' '}
                · 失败 {unblockResult.failed.length}：
                <span className="batch-fail">{failedSummary(unblockResult)}</span>
              </>
            ) : null}
          </p>
        ) : null}
      </section>

      <button
        className="secondary-action"
        disabled={!blockedCount || running}
        onClick={() => void runUnblock()}
      >
        全部撤销
      </button>

      {notice ? <p className="notice-error">{notice}</p> : null}
      <footer className="popup-footer">标注永不隐藏内容 · 误伤可一键撤销</footer>
    </main>
  );
}