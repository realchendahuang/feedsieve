import { useEffect, useState } from 'react';
import { getPendingBlocks, subscribePending } from '../../src/lib/pending-blocks';

export default function App() {
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  useEffect(() => {
    void getPendingBlocks().then((blocks) => setPendingCount(blocks.length));
    const unsubscribe = subscribePending((blocks) => setPendingCount(blocks.length));
    return unsubscribe;
  }, []);

  return (
    <main className="popup">
      <header className="popup-header">
        <h1>
          福滤娃 <span className="popup-sub">FeedSieve</span>
        </h1>
        <p className="tagline">X 赛博清洁工 · 看不到之前，先送走</p>
      </header>

      {/* 黄框 = 产品语言：待拉黑的垃圾账号 */}
      <section className="stat-card">
        <div className="stat-label">待拉黑列表</div>
        <div className="stat-value">
          {pendingCount === null ? '…' : `${pendingCount} 个账号`}
        </div>
        <div className="stat-hint">
          {pendingCount
            ? '在 Timeline 黄框里勾选的账号会累积到这里'
            : '去 Timeline 里勾选黄框标注的垃圾账号'}
        </div>
      </section>

      <button className="primary-action" disabled title="Phase 2/3 接入原生 Block 与批量队列执行">
        一键拉黑（开发中）
      </button>

      <footer className="popup-footer">标注永不隐藏内容 · 误伤可一键撤销</footer>
    </main>
  );
}
