import { useEffect, useState } from 'react';
import {
  getBlockedAccounts,
  subscribeBlocked,
  type BlockedAccount,
} from '../../src/lib/blocked-accounts';
import { getStats, subscribeStats, type LocalStats } from '../../src/lib/local-stats';
import {
  getDailyStats,
  subscribeDaily,
  type DailyStats,
} from '../../src/lib/daily-stats';
import { buildReportText, shareUrl, CATEGORY_LABELS } from '../../src/lib/share-card';
import { estimateTimeSaved } from '../../src/lib/time-saved';
import { getContributionStats, type ContributionStats } from '../../src/lib/contribute';
import { drawReportCard } from '../../src/lib/share-card-image';
import {
  getAllowlist,
  removeAllowed,
  subscribeAllowlist,
  type AllowlistItem,
} from '../../src/lib/allowlist';
import {
  getCommunitySettings,
  setCommunitySettings,
  getCommunitySnapshot,
  subscribeCommunity,
  type CommunitySettings,
} from '../../src/lib/community-store';
import {
  MARK_STRENGTHS,
  STRENGTH_LABELS,
  parseSnapshotBody,
  type MarkStrength,
} from '@feedsieve/community-lists';
/** 一键拉黑批量结果（content 脚本执行后回传）。 */
interface PageBlockResult {
  blocked: string[];
  failed: Array<{ handle: string; code: string }>;
}
import type { UnblockBatchResult } from '../../src/lib/run-unblock-batch';

/** 页面黄框账号（popup 从活动 x.com 标签实时查询）。 */
interface PageMarkedItem {
  handle: string;
  category: string;
  reason: string;
}

const FAILURE_LABELS: Record<string, string> = {
  'no-id': '无用户ID',
  auth_required: '登录已失效',
  rate_limited: '被限流',
  http_error: '接口异常',
  network_error: '网络失败',
  missing_csrf: '登录态缺失',
};

/** 强度档位悬停解释：与 community-lists 的 status 门槛一一对应 */
const STRENGTH_HINTS: Record<MarkStrength, string> = {
  refresh: '只标社区强证据账号',
  standard: '强证据 + 推荐账号',
  deep_clean: '全部候选都标（含指纹/域名）',
};

const BLOCK_MESSAGE = { type: 'feedsieve:run-page-block' } as const;
const PAGE_MARKED_MESSAGE = { type: 'feedsieve:page-marked-list' } as const;

const EMPTY_STATS: LocalStats = { detected: 0, blocked: 0, unblocked: 0 };

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatAgo(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export default function App() {
  const [pageMarked, setPageMarked] = useState<PageMarkedItem[] | null>(null);
  const [blocked, setBlocked] = useState<BlockedAccount[] | null>(null);
  const [stats, setStats] = useState<LocalStats>(EMPTY_STATS);
  const [daily, setDaily] = useState<DailyStats>({ days: {} });
  const [contribution, setContribution] = useState<ContributionStats | null>(null);
  const [cardUrl, setCardUrl] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [blockResult, setBlockResult] = useState<PageBlockResult | null>(null);
  const [unblockResult, setUnblockResult] = useState<UnblockBatchResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [community, setCommunity] = useState<CommunitySettings | null>(null);
  const [communityMeta, setCommunityMeta] = useState<{
    version: string;
    count: number;
    syncedAt: number;
  } | null>(null);
  const [allowlist, setAllowlist] = useState<AllowlistItem[] | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    void getBlockedAccounts().then(setBlocked);
    void getStats().then(setStats);
    void getDailyStats().then(setDaily);
    void getContributionStats().then(setContribution);
    void getAllowlist().then(setAllowlist);
    void getCommunitySettings().then(setCommunity);
    // 页面黄框清单只读查询走 .then 链（满足 set-state-in-effect 规则）
    void sendToXPage(PAGE_MARKED_MESSAGE)
      .then((result) => setPageMarked(result as PageMarkedItem[]))
      .catch(() => setPageMarked([]));
    void getCommunitySnapshot().then(async (snapshot) => {
      if (!snapshot) {
        return;
      }
      const parsed = parseSnapshotBody(snapshot.body);
      if (parsed.ok) {
        setCommunityMeta({
          version: snapshot.snapshot_version,
          count: parsed.value.entries.length,
          syncedAt: snapshot.synced_at,
        });
      }
    });
    const unsubs = [
      subscribeBlocked(setBlocked),
      subscribeStats(setStats),
      subscribeDaily(setDaily),
      subscribeAllowlist(setAllowlist),
      subscribeCommunity(() => {
        void getCommunitySettings().then(setCommunity);
      }),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  /**
   * 投递消息到任一可用的 x.com 标签：活动标签优先，其余依次兜底。
   * 重载扩展后旧标签的 content script 不响应（Receiving end does not exist），
   * 逐个尝试总能找到活着的会话（若有）。
   * 纯函数（不读 state），组件顶部申明保证 effect 依赖稳定。
   */
  async function sendToXPage(
    message: { type: string; handle?: string; force?: boolean },
  ): Promise<unknown> {
    const tabs = await browser.tabs.query({ url: 'https://x.com/*' });
    const ordered = [...tabs].sort(
      (a, b) => Number(b.active ?? false) - Number(a.active ?? false),
    );
    for (const tab of ordered) {
      if (!tab.id) {
        continue;
      }
      try {
        return await browser.tabs.sendMessage(tab.id, message);
      } catch {
        // 该标签没有接收方，试下一个
      }
    }
    throw new Error('no x.com receiver');
  }

  /** 从活动 x.com 标签实时拉取当前页面黄框账号清单。 */
  async function refreshPageMarked(): Promise<void> {
    try {
      const result = (await sendToXPage(PAGE_MARKED_MESSAGE)) as PageMarkedItem[];
      setPageMarked(result);
    } catch {
      setPageMarked([]); // 没有可用的 x.com 标签：空清单，按钮会给提示
    }
  }

  async function syncCommunityNow(): Promise<void> {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = (await browser.runtime.sendMessage({
        type: 'feedsieve:community-sync',
        force: true,
      })) as {
        outcome?: { status: string; version?: string; error?: string };
      };
      const outcome = res?.outcome;
      if (outcome?.status === 'updated') {
        setSyncMsg(`✅ 已更新 v${outcome.version}`);
      } else if (outcome?.status === 'unchanged') {
        setSyncMsg('✅ 已是最新');
      } else if (outcome?.status === 'error') {
        setSyncMsg(`⚠️ ${outcome.error ?? '同步失败'}`);
      } else {
        setSyncMsg('⚠️ 不可用');
      }
    } catch {
      setSyncMsg('⚠️ 后台未就绪');
    } finally {
      setSyncing(false);
    }
  }

  /** 一键拉黑：当前页面全部黄框账号（由活动 x.com 标签执行）。 */
  async function runBatch(): Promise<void> {
    setRunning(true);
    setNotice(null);
    setBlockResult(null);
    setUnblockResult(null);
    try {
      const result = (await sendToXPage(BLOCK_MESSAGE)) as PageBlockResult;
      setBlockResult(result);
      await refreshPageMarked();
    } catch {
      setNotice('请先打开或刷新 x.com');
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
      // 撤销后已拉黑记录变化；页面黄框可能重新出现（X 服务端行为），刷新一次
      await refreshPageMarked();
    } catch {
      setNotice('请先打开或刷新 x.com');
    } finally {
      setRunning(false);
    }
  }

  const pageCount = pageMarked?.length ?? null;
  const blockedCount = blocked?.length ?? null;
  const failedSummary = (result: { failed: Array<{ handle: string; code: string }> } | null) =>
    result?.failed.length
      ? result.failed
          .map((f) => `@${f.handle}（${FAILURE_LABELS[f.code] ?? f.code}）`)
          .join('、')
      : null;

  // v0.6 战报：今日数据（daily-stats 按日累计）
  const today = daily.days[new Date().toISOString().slice(0, 10)] ?? {
    blocked: 0,
    detected: 0,
    unblocked: 0,
    byCategory: {},
  };
  const reportText = buildReportText(today);
  const shareHref = shareUrl(reportText);
  const timeSaved = estimateTimeSaved(today.detected);

  /** 生成分享卡片图片（canvas -> dataURL，popup 预览 + 下载用）。 */
  function makeCard(): void {
    try {
      const canvas = drawReportCard(today);
      setCardUrl(canvas.toDataURL('image/png'));
    } catch {
      setCardUrl(null); // canvas 不可用（极老环境）时静默降级为纯文字分享
    }
  }
  // 分类占比条形图：按数量降序，最多显示 4 类（克制）
  const categoryBars = Object.entries(today.byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([key, count]) => ({
      key,
      label: CATEGORY_LABELS[key] ?? key,
      count,
      pct: today.blocked > 0 ? Math.round((count / today.blocked) * 100) : 0,
    }));

  return (
    <main className="popup">
      <header className="popup-header">
        <h1>
          福滤娃 <span className="popup-sub">FeedSieve</span>
        </h1>
      </header>

      {/* 今日战报：送走 N 个 + 分类明细 + 一键分享 */}
      <section className="report-card">
        <div className="report-head">
          <span className="stat-label">今日战报</span>
          <div className="report-actions">
            <button
              type="button"
              className="report-card-btn"
              title="生成分享卡片"
              onClick={makeCard}
            >
              卡片
            </button>
            <a
              className="report-share"
              href={shareHref}
              target="_blank"
              rel="noreferrer"
              title="分享到 X"
            >
              分享 ↗
            </a>
          </div>
        </div>
        {cardUrl ? (
          <div className="report-card-preview">
            <img src={cardUrl} alt="战报分享卡片" />
            <a
              className="report-card-download"
              href={cardUrl}
              download="feedsieve-report.png"
            >
              下载图片
            </a>
          </div>
        ) : null}
        <p className="report-text">{reportText}</p>
        {today.detected > 0 ? (
          <p className="report-sub">
            标注 {today.detected} 个 · 撤销 {today.unblocked} 个 · 省下 {timeSaved.label}
          </p>
        ) : null}
        {categoryBars.length > 0 ? (
          <div className="report-bars">
            {categoryBars.map((bar) => (
              <div key={bar.key} className="report-bar">
                <span className="report-bar-label">{bar.label}</span>
                <div className="report-bar-track">
                  <div
                    className="report-bar-fill"
                    style={{ width: `${Math.max(bar.pct, 4)}%` }}
                  />
                </div>
                <span className="report-bar-count">{bar.count}</span>
              </div>
            ))}
          </div>
        ) : null}
        {contribution && contribution.reports > 0 ? (
          <p className="report-sub">
            已为社区贡献 {contribution.reports} 条 · 被采纳 {contribution.adopted} 个
          </p>
        ) : null}
      </section>

      {/* 本地统计（动作只发生在本机） */}
      <section className="stats-bar">
        <span title="标注">🟡 {stats.detected}</span>
        <span title="拉黑">⛔ {stats.blocked}</span>
        <span title="撤销">↩️ {stats.unblocked}</span>
      </section>

      {/* 页面黄框：当前 X 页面的待拉黑账号清单（一键拉黑 = 全部） */}
      <section className="list-card">
        <div className="list-head">
          <span className="stat-label">页面黄框</span>
          <span className="list-count">{pageCount === null ? '…' : pageCount}</span>
        </div>

        {pageCount === null ? (
          <p className="list-empty">…</p>
        ) : pageCount === 0 ? (
          <p className="list-empty">
            {running ? '处理中…' : '当前页面没有黄框账号'}
          </p>
        ) : (
          <ul className="pending-list">
            {pageMarked!.map((item) => (
              <li key={item.handle} className="pending-item">
                <div className="pending-info">
                  <span className="pending-handle">@{item.handle}</span>
                  {item.reason ? (
                    <span className="pending-reason">{item.reason}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {blockResult ? (
          <p className="batch-summary">
            ✅ 已拉黑 {blockResult.blocked.length}
            {failedSummary(blockResult) ? (
              <>
                {' '}
                · ⚠️ {blockResult.failed.length}
                <span className="batch-fail">{failedSummary(blockResult)}</span>
              </>
            ) : null}
          </p>
        ) : null}
      </section>

      <div className="action-row">
        <button
          className="primary-action"
          disabled={!pageCount || running}
          onClick={() => void runBatch()}
        >
          {running ? '处理中…' : `一键拉黑${pageCount ? `（页面 ${pageCount} 个）` : ''}`}
        </button>
        <button
          className="icon-action"
          title="刷新页面黄框清单"
          disabled={running}
          onClick={() => void refreshPageMarked()}
        >
          ⟳
        </button>
      </div>

      {/* 已拉黑记录：撤销入口 */}
      <section className="list-card blocked-card">
        <div className="list-head">
          <span className="stat-label">已拉黑</span>
          <span className="list-count">
            {blockedCount === null ? '…' : blockedCount}
          </span>
        </div>

        {blockedCount !== null && blockedCount > 0 ? (
          <ul className="pending-list">
            {blocked!.map((account) => (
              <li key={account.handle} className="pending-item">
                <div className="pending-info">
                  <span className="pending-handle">@{account.handle}</span>
                  <span className="pending-reason">{formatDate(account.blockedAt)}</span>
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
        ) : null}

        {unblockResult ? (
          <p className="batch-summary">
            ↩️ 已撤销 {unblockResult.unblocked.length}
            {failedSummary(unblockResult) ? (
              <>
                {' '}
                · ⚠️ {unblockResult.failed.length}
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

      {/* 社区名单：全局设置（无逐条弹窗；自动贡献默认开，关一次永远安静） */}
      <section className="list-card">
        <div className="list-head">
          <span className="stat-label">社区名单</span>
          <span className="list-count">
            {communityMeta
              ? `v${communityMeta.version} · ${communityMeta.count} 个 · ${formatAgo(communityMeta.syncedAt)}`
              : '…'}
          </span>
          <button
            type="button"
            className="icon-action"
            title="立即同步"
            disabled={syncing}
            onClick={() => void syncCommunityNow()}
          >
            ⟳
          </button>
        </div>
        {syncMsg ? <p className="sync-msg">{syncMsg}</p> : null}
        {community ? (
          <div className="settings-rows">
            <label className="settings-row">
              <span>启用</span>
              <input
                type="checkbox"
                checked={community.enabled}
                onChange={(e) =>
                  void setCommunitySettings({ enabled: e.target.checked })
                }
              />
            </label>
            <div className="settings-row">
              <span>强度</span>
              <div className="seg">
                {MARK_STRENGTHS.map((s: MarkStrength) => (
                  <button
                    key={s}
                    type="button"
                    className={community.strength === s ? 'seg-on' : ''}
                    title={STRENGTH_HINTS[s]}
                    onClick={() => void setCommunitySettings({ strength: s })}
                  >
                    {STRENGTH_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
            <label className="settings-row">
              <span>自动贡献</span>
              <input
                type="checkbox"
                checked={community.autoContribute}
                onChange={(e) =>
                  void setCommunitySettings({
                    autoContribute: e.target.checked,
                  })
                }
              />
            </label>
            <p className="settings-note">仅匿名上报：你拉黑的账号 + 分类</p>
          </div>
        ) : (
          <p className="list-empty">…</p>
        )}
      </section>

      {/* 个人白名单：误标治理 */}
      <section className="list-card">
        <div className="list-head">
          <span className="stat-label">白名单</span>
          <span className="list-count">
            {allowlist === null ? '…' : allowlist.length}
          </span>
        </div>
        {allowlist !== null && allowlist.length > 0 ? (
          <ul className="pending-list">
            {allowlist.map((item) => (
              <li key={item.handle} className="pending-item">
                <div className="pending-info">
                  <span className="pending-handle">@{item.handle}</span>
                  <span className="pending-reason">{formatDate(item.addedAt)}</span>
                </div>
                <button
                  type="button"
                  className="remove-btn"
                  title="移出白名单（恢复标注）"
                  onClick={() => void removeAllowed(item.handle)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="list-empty">点黄框「误标？」加入</p>
        )}
      </section>

      {notice ? <p className="notice-error">{notice}</p> : null}
      <footer className="popup-footer">标注永不隐藏 · 误伤可撤销</footer>
    </main>
  );
}