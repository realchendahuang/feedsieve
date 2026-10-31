// 预览页的 browser.* 模拟层。必须作为 main.tsx 的第一个 import：
// 扩展里部分模块（keyword-packs / keyword-rules）在模块顶层就检查 browser.runtime，
// 模拟层若写在 main.tsx 正文里，会晚于这些模块执行，预览页因此白屏。
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
    snippet:
      '🔥 5,000,000 USDT Airdrop is live! Connect your Web3 wallet now to claim: claim-binance-free.gift/airdrop',
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
    snippet:
      '深度剖析：这 10 个 AI 工具将彻底颠覆你的工作流！第 7 个绝对让你惊掉下巴，速看收藏避免迷路！',
  },
  {
    handle: 'auto_reply_bot',
    displayName: 'Boost Growth Service',
    category: 'bot_spam',
    reason: '3 人标记 · 机器人',
    snippet:
      'Awesome post! If you want to grow your followers and get real organic impressions fast, check my bio!',
  },
];

// 本页热帖预览：覆盖 🚀/🔥/普通流速、高破圈、无正文、超长昵称等展示分支
/** 预览用的博主帖子库：40 条普通帖子 + 几条爆款 + 一条疑似投流 + 回复。 */
const previewProfile = (() => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const posts: Record<string, Record<string, unknown>> = {};
  const add = (i: number, views: number, extra: Record<string, unknown> = {}) => {
    const postId = `21158385954667${String(72000 + i)}`;
    posts[postId] = {
      postId,
      createdAt: now - (i * 0.7 + 1.2) * day - (i % 24) * 3_600_000,
      views,
      likes: Math.round(views / 90),
      retweets: Math.round(views / 900),
      replies: Math.round(views / 1_500),
      bookmarks: Math.round(views / 400),
      kind: 'original',
      media: i % 3 === 0 ? 'photo' : i % 5 === 0 ? 'video' : 'none',
      snippet: `第 ${i} 条：关于 AI 工具和独立开发的一些观察，配了一张截图。`,
      firstSeenAt: now,
      updatedAt: now,
      ...extra,
    };
  };
  for (let i = 0; i < 40; i += 1) add(i, 12_000 + ((i * 7919) % 9_000));
  add(41, 182_000, {
    snippet: '我用 Claude 写了一个浏览器插件，三天上架，第一周 2000 用户。复盘一下踩过的坑：',
    media: 'photo',
    mediaUrl: 'https://pbs.twimg.com/media/GZ2r0eqbcAAx2p_.jpg',
  });
  add(42, 96_000, {
    kind: 'quote',
    snippet: '这条说得对。补充一点：冷启动最重要的是找到第一批愿意反馈的人。',
  });
  add(43, 410_000, { likes: 40, replies: 1, bookmarks: 2, snippet: '限时优惠，点击了解 👇' });
  add(44, 3_000, { kind: 'reply', snippet: '@someone 谢谢！确实是这样。' });
  add(45, 9_000, { pinned: true, createdAt: now - 200 * day, snippet: '置顶：我是谁、在做什么。' });
  add(46, 30_000, { createdAt: now - 3 * 3_600_000, snippet: '刚发的：今天把主页洞察做出来了。' });
  return {
    account: {
      handle: 'zdetong',
      displayName: '赵德彤',
      avatarUrl: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg',
      verified: true,
      followers: 32_400,
      followingCount: 1_210,
      tweets: 8_200,
      createdAt: now - 6.4 * 365 * day,
    },
    posts,
    firstVisitAt: now - 9 * day,
    lastVisitAt: now,
  };
})();

const hotPosts = [
  {
    postId: '2115838595466772487',
    handle: 'zdetong',
    displayName: '周德通',
    snippet:
      '刚把自己的 Claude 工作流整理成一份清单，十个月踩过的坑都在里面。\n\n最重要的一条：先写验收标准，再让模型动手。\n\n1. 需求先写成可以检查的条目\n2. 每一步都让它先说计划\n3. 改完立刻跑测试，不要攒着\n\n清单放在评论区，自取 https://t.co/AbCdEf123',
    createdAt: now - 2 * 60 * 60_000,
    views: 182_000,
    likes: 3_210,
    retweets: 412,
    bookmarks: 2_980,
    projected: 2_400_000,
    followers: 925,
    replies: 46,
    velocity: 52_300,
    breakout: 196.8,
    tier: 1,
    viral: 82,
    opportunity: { hoursLeft: 22, remainingViews: 575_300, competition: 46, score: 8_717 },
  },
  {
    postId: '2115695701959336440',
    handle: 'berryxia',
    displayName: 'Berryxia.AI 一个名字特别长特别长的博主',
    snippet:
      '今天 OpenAI 发布会的 5 个重点，第 3 个对独立开发者影响最大。\n\n以前要自己搭的那一套，现在一个接口就够了。成本大概降到原来的五分之一。',
    createdAt: now - 3 * 60 * 60_000,
    views: 41_200,
    likes: 860,
    retweets: 120,
    bookmarks: 540,
    projected: 96_000,
    followers: 53_000,
    replies: 210,
    velocity: 3_983,
    breakout: 0.8,
    tier: 4,
    viral: 41,
    opportunity: { hoursLeft: 21, remainingViews: 41_822, competition: 210, score: 181 },
  },
  {
    postId: '2115810375686119566',
    handle: 'antiaivo',
    displayName: '纳米AI',
    snippet:
      '我觉得\n达到AGI阶段的电脑\n它的agent理想模式应该是：\n\n开机\n只有一个对话窗口\n人机交互只有文字或语音',
    createdAt: now - 25 * 60_000,
    views: 1_890,
    likes: 29,
    retweets: 2,
    projected: 9_800,
    followers: 29_000,
    replies: 2,
    velocity: 1_377,
    breakout: 0.1,
    tier: 3,
    viral: 12,
    opportunity: { hoursLeft: 23.6, remainingViews: 4_449, competition: 2, score: 202 },
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

const storageData = {
  uiLanguage: new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh',
  installationId: 'preview-installation-id',
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
    // 当前标签页在一个博主主页上：「主页」视图有数据可看
    query: async () => [{ id: 1, index: 0, active: true, url: 'https://x.com/zdetong' }],
    onActivated: { addListener: () => undefined, removeListener: () => undefined },
    onUpdated: { addListener: () => undefined, removeListener: () => undefined },
    create: async () => ({ id: 2 }),
    sendMessage: async (
      _tabId: number,
      message: { type: string; handle?: string; handles?: string[] },
    ) => {
      if (message.type === 'feedsieve:page-marked-list') return pageMarked;
      if (message.type === 'feedsieve:scroll-to-post') return { found: false };
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
    id: 'preview',
    getManifest: () => ({ version: '0.7.2' }),
    getURL: (path: string) => path,
    sendMessage: async (message: { type?: string; path?: string }) => {
      // 随包数据（词库 / 变体表 / 内置名单）：预览由 vite 从 public/ 直接提供
      // 热帖由后台汇总所有 X 标签页的数据（真实实现见 src/lib/insight/shared-insight.ts）
      if (message?.type === 'feedsieve:hot-posts') return hotPosts;
      // 主页洞察的本地帖子库（真实实现见 src/lib/insight/profile-catalog.ts）
      if (message?.type === 'feedsieve:profile-get') return previewProfile;
      if (message?.type === 'feedsieve:profile-count') return 3;
      if (message?.type === 'feedsieve:hot-brief') {
        return {
          seen: 86,
          authors: 41,
          hot: 7,
          medianVelocity: 312,
          topBreakout: { ratio: 196.8, handle: 'zdetong', postId: '2115838595466772487' },
          tiers: { 1: 9, 2: 16, 3: 10, 4: 4, 5: 1, 6: 1 },
        };
      }
      if (message?.type === 'feedsieve:runtime-data' && typeof message.path === 'string') {
        const response = await fetch(message.path);
        return response.ok
          ? { ok: true, data: await response.json() }
          : { ok: false, error: `HTTP ${response.status}` };
      }
      return { outcome: { status: 'unchanged', version: '2026.09.02.1' } };
    },
    onMessage: { addListener: () => undefined, removeListener: () => undefined },
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
