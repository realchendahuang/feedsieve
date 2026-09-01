export type UiLanguage = 'zh' | 'en';

const LANGUAGE_KEY = 'uiLanguage';

export const UI_COPY = {
  zh: {
    brand: '福滤娃',
    home: '清理',
    lists: '名单',
    primaryNavigation: '主要导航',
    language: '语言',
    currentLanguage: '中文',
    switchLanguage: '切换为英文',
    languageSetting: '界面语言',
    listReady: (value: number) => `已同步 ${value} 个`,
    listLoading: '名单读取中',
    todaySummary: '今日概览',
    todayQuiet: '今天还没有处理记录',
    showDetails: '详情',
    hideDetails: '收起',
    blockedToday: '已拉黑',
    marked: '标注',
    blocked: '拉黑',
    restored: '撤销',
    saved: '省下',
    reportCard: '生成卡片',
    share: '分享到 X',
    downloadImage: '下载图片',
    reportImageAlt: '今日战报分享卡片',
    pageMarked: '当前页面',
    pageClean: '当前页面很干净',
    noPageMarked: '没有待处理账号',
    processing: '处理中…',
    blockPage: '全部拉黑',
    refreshPage: '刷新当前页面清单',
    manageBlocked: '拉黑记录',
    noBlocked: '还没有拉黑记录',
    falsePositiveList: '误标白名单',
    undo: '撤销',
    undoAll: '全部撤销',
    settings: '设置',
    communityList: '社区名单',
    syncNow: '立即同步',
    enabled: '启用检测',
    strength: '检测强度',
    autoContribute: '名单上传',
    contribution: (reports: number, rescues: number) => `黑名单 ${reports} · 白名单 ${rescues}`,
    copyInstallationId: '复制安装 ID',
    copyInstallationIdHint: '供名单维护者识别贡献权限',
    allowlistEmpty: '在黄框中点“误标”后会显示在这里',
    removeAllowlist: '移出白名单并恢复标注',
    openXNotice: '请先打开或刷新 x.com',
    copiedId: '已复制安装 ID',
    copyFailed: '复制失败',
    synced: (version?: string) => (version ? `已更新至 v${version}` : '已更新'),
    upToDate: '已是最新',
    syncFailed: '同步失败',
    unavailable: '暂不可用',
    backgroundUnavailable: '后台未就绪',
    updatedAgo: (value: string) => `${value}更新`,
    justNow: '刚刚',
    minutesAgo: (value: number) => `${value} 分钟前`,
    hoursAgo: (value: number) => `${value} 小时前`,
    daysAgo: (value: number) => `${value} 天前`,
    accountUnit: '个',
    blockedResult: (value: number) => `已拉黑 ${value} 个`,
    restoredResult: (value: number) => `已撤销 ${value} 个`,
    failedResult: (value: number) => `失败 ${value} 个`,
    sourceTitle: (source: string, rule: string) => `来源：${source} · 规则：${rule}`,
    removeTweet: '移除推文',
    removingTweet: '移除中…',
    blockNow: '拉黑',
    blocking: '拉黑中…',
    blockedDone: '已拉黑 ✓',
    falsePositive: '误标',
    falsePositiveHint: '加入本地白名单，以后不再标注该账号',
    rescue: '申诉',
    rescueHint: '向社区反馈这个标注可能有误',
    rescued: '已反馈 ✓',
    failed: '失败',
    unknown: '未知',
  },
  en: {
    brand: 'FeedSieve',
    home: 'Clean',
    lists: 'Lists',
    primaryNavigation: 'Primary navigation',
    language: 'Language',
    currentLanguage: 'English',
    switchLanguage: 'Switch to Chinese',
    languageSetting: 'Interface language',
    listReady: (value: number) => `${value} synced`,
    listLoading: 'Loading list',
    todaySummary: 'Today',
    todayQuiet: 'No activity yet today',
    showDetails: 'Details',
    hideDetails: 'Hide',
    blockedToday: 'blocked',
    marked: 'Marked',
    blocked: 'Blocked',
    restored: 'Restored',
    saved: 'Saved',
    reportCard: 'Create card',
    share: 'Share on X',
    downloadImage: 'Download image',
    reportImageAlt: 'Daily report share card',
    pageMarked: 'On this page',
    pageClean: 'This page looks clean',
    noPageMarked: 'No accounts to review',
    processing: 'Working…',
    blockPage: 'Block all',
    refreshPage: 'Refresh accounts on this page',
    manageBlocked: 'Block history',
    noBlocked: 'No blocked accounts yet',
    falsePositiveList: 'Not-spam list',
    undo: 'Restore',
    undoAll: 'Restore all',
    settings: 'Settings',
    communityList: 'Community list',
    syncNow: 'Sync now',
    enabled: 'Detection',
    strength: 'Detection level',
    autoContribute: 'List uploads',
    contribution: (reports: number, rescues: number) => `Blocked ${reports} · Allowed ${rescues}`,
    copyInstallationId: 'Copy installation ID',
    copyInstallationIdHint: 'For list maintainers to identify contributor access',
    allowlistEmpty: 'Accounts marked as false positives appear here',
    removeAllowlist: 'Remove from allowlist and resume marking',
    openXNotice: 'Open or refresh x.com first',
    copiedId: 'Installation ID copied',
    copyFailed: 'Could not copy',
    synced: (version?: string) => (version ? `Updated to v${version}` : 'Updated'),
    upToDate: 'Up to date',
    syncFailed: 'Sync failed',
    unavailable: 'Unavailable',
    backgroundUnavailable: 'Background service is not ready',
    updatedAgo: (value: string) => `Updated ${value}`,
    justNow: 'just now',
    minutesAgo: (value: number) => `${value}m ago`,
    hoursAgo: (value: number) => `${value}h ago`,
    daysAgo: (value: number) => `${value}d ago`,
    accountUnit: '',
    blockedResult: (value: number) => `${value} blocked`,
    restoredResult: (value: number) => `${value} restored`,
    failedResult: (value: number) => `${value} failed`,
    sourceTitle: (source: string, rule: string) => `Source: ${source} · Rule: ${rule}`,
    removeTweet: 'Remove post',
    removingTweet: 'Removing…',
    blockNow: 'Block',
    blocking: 'Blocking…',
    blockedDone: 'Blocked ✓',
    falsePositive: 'Not spam',
    falsePositiveHint: 'Add to your local allowlist and stop marking this account',
    rescue: 'Appeal',
    rescueHint: 'Tell the community this mark may be incorrect',
    rescued: 'Sent ✓',
    failed: 'Failed',
    unknown: 'Unknown',
  },
} as const;

export function defaultUiLanguage(): UiLanguage {
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export async function getUiLanguage(): Promise<UiLanguage> {
  const result = await browser.storage.local.get(LANGUAGE_KEY);
  const value = result[LANGUAGE_KEY];
  return value === 'zh' || value === 'en' ? value : defaultUiLanguage();
}

export async function setUiLanguage(language: UiLanguage): Promise<void> {
  await browser.storage.local.set({ [LANGUAGE_KEY]: language });
}

export function subscribeUiLanguage(onChange: (language: UiLanguage) => void): () => void {
  const listener = (changes: Record<string, unknown>, areaName: string) => {
    if (areaName !== 'local' || !changes[LANGUAGE_KEY]) {
      return;
    }
    const next = (changes[LANGUAGE_KEY] as { newValue?: unknown }).newValue;
    if (next === 'zh' || next === 'en') {
      onChange(next);
    }
  };
  browser.storage.onChanged.addListener(
    listener as Parameters<typeof browser.storage.onChanged.addListener>[0],
  );
  return () =>
    browser.storage.onChanged.removeListener(
      listener as Parameters<typeof browser.storage.onChanged.removeListener>[0],
    );
}

const CATEGORY_LABELS: Record<UiLanguage, Record<string, string>> = {
  zh: {
    bot_spam: '机器人',
    copy_paste: '复读机',
    ai_slop: 'AI 垃圾',
    advertising: '广告号',
    adult_gray_traffic: '色情引流',
    scam_phishing: '诈骗',
    engagement_bait: '互动钓鱼',
    other: '其他',
  },
  en: {
    bot_spam: 'Bots',
    copy_paste: 'Copy-paste',
    ai_slop: 'AI spam',
    advertising: 'Ads',
    adult_gray_traffic: 'Adult bait',
    scam_phishing: 'Scams',
    engagement_bait: 'Engagement bait',
    other: 'Other',
  },
};

export function categoryLabel(category: string, language: UiLanguage): string {
  return CATEGORY_LABELS[language][category] ?? category;
}

export function localizedDetectionReason(
  language: UiLanguage,
  detection: { source: string; ruleId?: string | null; reason: string },
): string {
  if (language === 'zh') {
    return detection.reason;
  }
  const hostname = detection.reason.match(/[（(]([^()（）]+)[）)]/)?.[1];
  switch (detection.ruleId) {
    case 'blocked':
      return 'Blocked account still shown by X';
    case 'local-repeat':
      return 'Repeated template · Same text seen multiple times';
    case 'list':
      return 'Known spam account';
    case 'community-fingerprint':
      return 'Known spam template · Community match';
    case 'community-fingerprint-sim':
      return 'Known spam template · Similar wording';
    case 'community-domain':
      return hostname ? `Community-listed domain · ${hostname}` : 'Community-listed domain';
    case 'default-name-digits':
      return 'Default name and random digits';
    case 'spam-link-hint':
      return hostname ? `Suspicious promotion link · ${hostname}` : 'Suspicious promotion link';
    case 'templated-text':
      return 'Templated spam wording';
    case 'porn-bait-zh':
      return 'Adult-content bait wording';
    default:
      return 'Spam pattern detected';
  }
}
