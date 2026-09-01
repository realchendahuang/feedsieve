import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../entrypoints/popup/App';
import '../entrypoints/popup/popup.css';

const now = Date.now();
const today = new Date().toISOString().slice(0, 10);

const pageMarked = [
  {
    handle: 'crypto_gift88',
    category: 'scam_phishing',
    reason: '可疑推广链接 · gift-airdrop.example',
  },
  { handle: 'daily_alpha369', category: 'copy_paste', reason: '已知垃圾模板 · 社区名单匹配' },
  { handle: 'beauty_live520', category: 'adult_gray_traffic', reason: '色情引流话术' },
  { handle: 'auto_reply_bot', category: 'bot_spam', reason: '默认名称与随机数字' },
  { handle: 'hot_topic_ai', category: 'ai_slop', reason: '重复模板内容' },
];

const snapshotBody = JSON.stringify({
  schema_version: 1,
  snapshot_version: '2026.09.01.1',
  generated_at: new Date(now - 18 * 60_000).toISOString(),
  entries: Array.from({ length: 47 }, (_, index) => ({
    handle: `spam_demo_${String(index).padStart(2, '0')}`,
    x_user_id: null,
    category: index % 2 === 0 ? 'copy_paste' : 'adult_gray_traffic',
    status: index % 4 === 0 ? 'strong' : 'recommended',
    report_count: 3 + (index % 8),
    rescue_count: 0,
    first_seen_at: '2026-08-20T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    evidence_post_ids: [],
  })),
});

const storageData = {
  uiLanguage: new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh',
  installationId: 'preview-installation-id',
  communitySettings: {
    enabled: true,
    strength: 'standard',
    autoContribute: true,
  },
  communitySnapshot: {
    snapshot_version: '2026.09.01.1',
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
    query: async () => [{ id: 1, active: true }],
    sendMessage: async (_tabId: number, message: { type: string; handle?: string }) => {
      if (message.type === 'feedsieve:page-marked-list') return pageMarked;
      if (message.type === 'feedsieve:run-page-block') {
        return { blocked: pageMarked.map((item) => item.handle), failed: [] };
      }
      if (message.type === 'feedsieve:unblock') {
        return {
          unblocked: message.handle
            ? [message.handle]
            : storageData.blockedAccounts.map((item) => item.handle),
          failed: [],
        };
      }
      return null;
    },
  },
  runtime: {
    getManifest: () => ({ version: '0.7.1' }),
    sendMessage: async () => ({ outcome: { status: 'unchanged', version: '2026.09.01.1' } }),
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
