import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../entrypoints/popup/App';
import '../entrypoints/popup/popup.css';

const now = Date.now();
const today = new Date().toISOString().slice(0, 10);

const pageMarked = [
  {
    handle: 'beauty_live520',
    displayName: '小甜甜 🌸 优质交友',
    category: 'adult_gray_traffic',
    reason: '6 人标记 · 色情引流',
    snippet: '哥哥看我主页置顶有惊喜哦 🔞 私信我发完整高清视频，同城可约～',
  },
  {
    handle: 'crypto_gift88',
    displayName: 'Binance Rewards Official',
    category: 'scam_phishing',
    reason: '5 人标记 · 诈骗',
    snippet: '🔥 5,000,000 USDT Airdrop is live! Connect your Web3 wallet now to claim: claim-binance-free.gift/airdrop',
  },
  {
    handle: 'daily_alpha369',
    displayName: '币圈每日早报',
    category: 'copy_paste',
    reason: '4 人标记 · 重复刷屏',
    snippet: '关注我并转发本条推文，今晚抽 10 位幸运粉丝平分 500U 红包！赶快行动起来！',
  },
  {
    handle: 'hot_topic_ai',
    displayName: 'AI 资讯速递',
    category: 'ai_slop',
    reason: '5 人标记 · AI 垃圾',
    snippet: '深度剖析：这 10 个 AI 工具将彻底颠覆你的工作流！第 7 个绝对让你惊掉下巴，速看收藏避免迷路！',
  },
  {
    handle: 'auto_reply_bot',
    displayName: 'Boost Growth Service',
    category: 'bot_spam',
    reason: '3 人标记 · 机器人',
    snippet: 'Awesome post! If you want to grow your followers and get real organic impressions fast, check my bio!',
  },
];

const snapshotBody = JSON.stringify({
  schema_version: 2,
  snapshot_version: '2026.09.02.1',
  generated_at: new Date(now - 18 * 60_000).toISOString(),
  entries: Array.from({ length: 47 }, (_, index) => ({
    handle: `spam_demo_${String(index).padStart(2, '0')}`,
    x_user_id: null,
    category: index % 2 === 0 ? 'copy_paste' : 'adult_gray_traffic',
    sources: index % 7 === 0 ? ['maintainer'] : ['community'],
    ...(index % 7 === 0 ? { maintainer_note: '维护者确认的垃圾账号' } : {}),
    community_score: index % 7 === 0 ? 0 : 0.5,
    report_count: index % 7 === 0 ? 0 : 3 + (index % 8),
    rescue_count: 0,
    net_votes: index % 7 === 0 ? 0 : 3 + (index % 8),
    first_seen_at: '2026-08-20T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    evidence_post_ids: [],
  })),
  // 推荐白名单预览：名单页折叠区 + 背书理由行
  whitelist: [
    {
      handle: 'goodactor',
      x_user_id: null,
      note: '知名科普博主，多次被模板误标，复核为正常账号',
      added_at: '2026-09-08T00:00:00.000Z',
    },
  ],
});

const hunterBoardRows = Array.from({ length: 14 }, (_, index) => ({
  id: `hunter_${index}`,
  name: `猎手#${(0xa0f98f + index * 0x12345).toString(16).toUpperCase().slice(0, 6)}`,
  bio: index % 4 === 0 ? '专注清理成人引流与诈骗链' : null,
  title: index % 3 === 0 ? '金标猎手' : null,
  tier: '滤福侠',
  x_handle: null,
  kills: 220 - index * 9,
  score: (220 - index * 9) * 3,
  accuracy: 0.94 - index * 0.02,
  rank: index + 1,
}));

const hunterBoardCache = {
  installationId: 'preview-installation-id',
  ts: now,
  data: {
    rows: hunterBoardRows,
    total: 42,
    me: { ...hunterBoardRows[4], isMe: true },
  },
};

const storageData = {
  uiLanguage: new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh',
  installationId: 'preview-installation-id',
  hunterBoardCache,
  communitySettings: {
    enabled: true,
    strength: 'standard',
    autoContribute: true,
  },
  communitySnapshot: {
    snapshot_version: '2026.09.02.1',
    body: snapshotBody,
    synced_at: now - 18 * 60_000,
  },
  dailyStats: {
    days: {
      [today]: {
        detected: 27,
        blocked: 18,
        unblocked: 3,
        byCategory: {
          copy_paste: 8,
          adult_gray_traffic: 5,
          scam_phishing: 3,
          bot_spam: 2,
        },
      },
    },
  },
  blockedAccounts: [
    { handle: 'spam_archive88', xUserId: '1001', blockedAt: now - 18 * 60_000 },
    { handle: 'copyfarm_daily', xUserId: '1002', blockedAt: now - 2 * 60 * 60_000 },
    { handle: 'bonus_click520', xUserId: '1003', blockedAt: now - 24 * 60 * 60_000 },
    { handle: 'auto_answer369', xUserId: '1004', blockedAt: now - 2 * 24 * 60 * 60_000 },
    { handle: 'gray_traffic_x', xUserId: '1005', blockedAt: now - 3 * 24 * 60 * 60_000 },
  ],
  followingAllowlistV1: Array.from({ length: 413 }, (_, index) => ({
    handle: `followed_${index}`,
    protectedAt: now - 10 * 60_000,
    source: 'full-sync',
  })),
  followingSyncStateV1: {
    status: 'complete',
    collected: 413,
    updatedAt: now - 10 * 60_000,
  },
  allowlist: [
    {
      handle: 'real_creator',
      addedAt: now - 36 * 60_000,
      detectionSource: 'heuristic',
      ruleId: 'default-name-digits',
      detectionReason: '默认名称与随机数字',
    },
    {
      handle: 'design_notes88',
      addedAt: now - 4 * 60 * 60_000,
      detectionSource: 'fingerprint',
      ruleId: 'local-repeat',
      detectionReason: '重复模板 · 相同文字出现多次',
    },
    {
      handle: 'shop_owner520',
      addedAt: now - 24 * 60 * 60_000,
      detectionSource: 'domain',
      ruleId: 'spam-link-hint',
      detectionReason: '可疑推广链接 · 实际为本人店铺',
    },
    {
      handle: 'news_digest',
      addedAt: now - 2 * 24 * 60 * 60_000,
      detectionSource: 'community',
      ruleId: 'list',
      detectionReason: '社区名单命中',
    },
  ],
};

const storageRecord: Record<string, unknown> = storageData;
type StorageListener = (changes: Record<string, { newValue?: unknown }>, areaName: string) => void;
const listeners = new Set<StorageListener>();

function readStorage(
  keys?: string | string[] | Record<string, unknown> | null,
): Record<string, unknown> {
  if (typeof keys === 'string') return { [keys]: storageRecord[keys] };
  if (Array.isArray(keys)) {
    return Object.fromEntries(keys.map((key) => [key, storageRecord[key]]));
  }
  if (keys && typeof keys === 'object') {
    return Object.fromEntries(
      Object.entries(keys).map(([key, fallback]) => [
        key,
        storageRecord[key] === undefined ? fallback : storageRecord[key],
      ]),
    );
  }
  return { ...storageRecord };
}

const previewBrowser = {
  storage: {
    local: {
      get: async (keys?: string | string[] | Record<string, unknown> | null) => readStorage(keys),
      set: async (patch: Record<string, unknown>) => {
        Object.assign(storageRecord, patch);
        const changes = Object.fromEntries(
          Object.entries(patch).map(([key, newValue]) => [key, { newValue }]),
        );
        listeners.forEach((listener) => listener(changes, 'local'));
      },
    },
    onChanged: {
      addListener: (listener: StorageListener) => listeners.add(listener),
      removeListener: (listener: StorageListener) => listeners.delete(listener),
    },
  },
  tabs: {
    query: async () => [{ id: 1, active: true, url: 'https://x.com/home' }],
    sendMessage: async (
      _tabId: number,
      message: { type: string; handle?: string; handles?: string[] },
    ) => {
      if (message.type === 'feedsieve:page-marked-list') return pageMarked;
      if (message.type === 'feedsieve:run-page-block') {
        const toBlock = Array.isArray(message.handles)
          ? message.handles
          : pageMarked.map((item) => item.handle);
        return { blocked: toBlock, failed: [] };
      }
      if (message.type === 'feedsieve:unblock') {
        return {
          unblocked: message.handle
            ? [message.handle]
            : storageData.blockedAccounts.map((item) => item.handle),
          failed: [],
        };
      }
      if (message.type === 'feedsieve:manual-spam-block') {
        return { ok: true, handle: message.handle };
      }
      if (message.type === 'feedsieve:following-sync-start') {
        return { status: 'waiting' };
      }
      if (message.type === 'feedsieve:community-block-start') {
        return { status: 'started', count: 12 };
      }
      return null;
    },
  },
  runtime: {
    getManifest: () => ({ version: '0.7.2' }),
    sendMessage: async () => ({ outcome: { status: 'unchanged', version: '2026.09.02.1' } }),
  },
};

Object.defineProperty(globalThis, 'browser', {
  configurable: true,
  value: previewBrowser,
});

const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  if (String(input).includes('/v1/contributions/stats')) {
    return new Response(JSON.stringify({ reports: 36, rescues: 11, adopted: 8 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return nativeFetch(input, init);
};

if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async () => undefined },
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
