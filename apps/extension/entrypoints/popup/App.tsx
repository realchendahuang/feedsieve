export default function App() {
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
        <div className="stat-label">今日送走</div>
        <div className="stat-value">0 个垃圾账号</div>
        <div className="stat-hint">本地统计将在后续阶段接入</div>
      </section>

      <button className="primary-action" disabled title="Phase 3 接入 Block Queue 批量执行">
        一键批量拉黑（开发中）
      </button>

      <footer className="popup-footer">Phase 0 工程骨架 · 标注永不隐藏内容</footer>
    </main>
  );
}
