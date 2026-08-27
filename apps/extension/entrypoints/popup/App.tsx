import { useEffect, useState } from 'react';
import {
  clearPendingBlocks,
  getPendingBlocks,
  removePendingBlock,
  subscribePending,
  type PendingBlock,
} from '../../src/lib/pending-blocks';
import type { BatchBlockResult } from '../../src/lib/run-block-batch';

const FAILURE_LABELS: Record<string, string> = {
  'no-id': '无用户ID',
  auth_required: '登录已失效',
  rate_limited: '被限流',
  http_error: '接口异常',
  network_error: '网络失败',
  missing_csrf: '登录态缺失',
};

const BATCH_MESSAGE = { type: 'feedsieve:run-block-batch' } as const;

export default function App() {
  const [blocks, setBlocks] = useState<PendingBlock[] | null>(null);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<BatchBlockResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void getPendingBlocks().then(setBlocks);
    return subscribePending(setBlocks);
  }, []);

  async function runBatch(): Promise<void> {
    setRunning(true);
    setNotice(null);
    setLastResult(null);
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        throw new Error('no active tab');
      }
      const result = (await browser.tabs.sendMessage(tab.id, BATCH_MESSAGE)) as BatchBlockResult;
      setLastResult(result);
    } catch {
      setNotice('没找到 X 页面会话：先打开 x.com，再点一键拉黑');
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
  const failedSummary = lastResult?.failed.length
    ? lastResult.failed
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

      {/* 待拉黑列表：可单项移除、可清空；勾选在 Timeline 黄框里进行 */}
      <section className="list-card">
        <div className="list-head">
          <span className="stat-label">待拉黑列表</span>
          <span className="list-count">{count === null ? '…' : `${count} 个`}</span>
        </div>

        {count === 0 ? (
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

        {lastResult ? (
          <p className="batch-summary">
            ✅ 已拉黑 {lastResult.blocked.length} 个
            {failedSummary ? (
              <>
                {' '}
                · 失败 {lastResult.failed.length}：<span className="batch-fail">{failedSummary}</span>
              </>
            ) : null}
          </p>
        ) : null}

        {notice ? <p className="notice-error">{notice}</p> : null}
      </section>

      <button
        className="primary-action"
        disabled={!count || running}
        onClick={() => void runBatch()}
      >
        {running ? '拉黑中…' : `一键拉黑${count ? `（${count}）` : ''}`}
      </button>
      <button
        className="secondary-action"
        disabled={!count || running}
        onClick={() => void clearAll()}
      >
        清空列表
      </button>

      <footer className="popup-footer">标注永不隐藏内容 · 误伤可一键撤销</footer>
    </main>
  );
}