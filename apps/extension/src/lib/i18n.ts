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
    pageClean: '当前页面没有高置信待处理账号',
    noPageMarked: '没有高置信待处理账号',
    processing: '处理中…',
    blockPage: '全部拉黑',
    refreshPage: '刷新当前页面清单',
    manageBlocked: '拉黑记录',
    noBlocked: '还没有拉黑记录',
    falsePositiveList: '误标白名单',
    missedAccount: '漏网账号',
    missedAccountHint: '输入 @用户名或粘贴 X 个人主页链接',
    markSpamAndBlock: '标记垃圾并拉黑',
    invalidHandle: '请输入有效的 X 用户名或个人主页链接',
    manualBlocked: (handle: string) => `已标记并拉黑 @${handle}`,
    communityClean: '社区清理',
    communityCleanHint: '只处理高置信账号，自动排除关注、白名单和已拉黑账号',
    cloudEligible: '本次可清理',
    cloudProtected: '已排除',
    startCommunityClean: (count: number) => `一键开始清理 ${count} 个`,
    queueProgress: (done: number, total: number) => `清理进度 ${done} / ${total}`,
    pause: '暂停',
    resume: '继续',
    cancel: '取消',
    followingProtection: '关注保护',
    followingProtected: (count: number) => `已保护 ${count} 个关注账号`,
    syncFollowing: '同步关注列表',
    resyncFollowing: '重新同步关注列表',
    syncFollowingWorking: (count: number) => `正在同步，已读取 ${count} 个`,
    syncFollowingComplete: (count: number) => `关注保护已更新，共 ${count} 个`,
    syncFollowingInterrupted: '上次同步已中断，旧保护仍然有效',
    keywordRules: '关键词规则',
    keywordRulesHint:
      '先订阅要清理的类型；命中只标黄色，不会自动拉黑或加入一键清理；自定义词只保存在本机。',
    keywordPlaceholder: '添加你想标记的词或短语',
    addKeyword: '添加',
    myKeywords: '我的关键词',
    noCustomKeywords: '还没有自定义关键词',
    officialKeywords: '官方预置词库',
    subscribeKeywordPack: '订阅此词库',
    unsubscribeKeywordPack: '退订此词库',
    keywordPackNotSubscribed: '未订阅',
    syncKeywordPacks: '同步词库',
    keywordPacksSynced: (version?: string) => (version ? `词库已更新至 v${version}` : '词库已同步'),
    removeKeyword: '移除',
    restoreKeyword: '恢复',
    removeCategoryKeywords: '移除此类',
    restoreCategoryKeywords: '恢复此类',
    keywordAdded: '已添加关键词，X 页面会立即重新标注',
    keywordInvalid: '关键词不能为空且不能超过 80 个字符',
    keywordLimit: '最多可添加 80 个自定义关键词',
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
    pageClean: 'No high-confidence accounts to review on this page',
    noPageMarked: 'No high-confidence accounts to review',
    processing: 'Working…',
    blockPage: 'Block all',
    refreshPage: 'Refresh accounts on this page',
    manageBlocked: 'Block history',
    noBlocked: 'No blocked accounts yet',
    falsePositiveList: 'Not-spam list',
    missedAccount: 'Missed account',
    missedAccountHint: 'Enter an @handle or paste an X profile URL',
    markSpamAndBlock: 'Mark as spam & block',
    invalidHandle: 'Enter a valid X handle or profile URL',
    manualBlocked: (handle: string) => `Marked and blocked @${handle}`,
    communityClean: 'Community clean',
    communityCleanHint:
      'Only high-confidence accounts are included; followed, allowed and already-blocked accounts are excluded',
    cloudEligible: 'Ready to clean',
    cloudProtected: 'Excluded',
    startCommunityClean: (count: number) => `Start cleaning ${count}`,
    queueProgress: (done: number, total: number) => `Progress ${done} / ${total}`,
    pause: 'Pause',
    resume: 'Resume',
    cancel: 'Cancel',
    followingProtection: 'Following protection',
    followingProtected: (count: number) => `${count} followed accounts protected`,
    syncFollowing: 'Sync following list',
    resyncFollowing: 'Restart following sync',
    syncFollowingWorking: (count: number) => `Syncing · ${count} read`,
    syncFollowingComplete: (count: number) => `Following protection updated · ${count}`,
    syncFollowingInterrupted: 'The previous sync was interrupted; existing protection is intact',
    keywordRules: 'Keyword rules',
    keywordRulesHint:
      'Subscribe to the packs you want first. Matches are highlighted only: never auto-blocked or added to bulk clean. Custom rules stay on this device.',
    keywordPlaceholder: 'Add a word or phrase to highlight',
    addKeyword: 'Add',
    myKeywords: 'My keywords',
    noCustomKeywords: 'No custom keywords yet',
    officialKeywords: 'Official preset lists',
    subscribeKeywordPack: 'Subscribe to this pack',
    unsubscribeKeywordPack: 'Unsubscribe from this pack',
    keywordPackNotSubscribed: 'Not subscribed',
    syncKeywordPacks: 'Sync rule packs',
    keywordPacksSynced: (version?: string) =>
      version ? `Rule packs updated to v${version}` : 'Rule packs synced',
    removeKeyword: 'Remove',
    restoreKeyword: 'Restore',
    removeCategoryKeywords: 'Remove category',
    restoreCategoryKeywords: 'Restore category',
    keywordAdded: 'Keyword added; X will be rescanned now',
    keywordInvalid: 'Keywords must be 1–80 characters',
    keywordLimit: 'You can add up to 80 custom keywords',
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
    copy_paste: '重复刷屏',
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
  const hostname = detection.reason.match(/[（(]([^()（）]+)[）)]/)?.[1];
  if (detection.ruleId?.startsWith('keyword:')) {
    // “heuristic”只是 Detector 内部接口名；用户词库要显示人话，不能泄露 rule id。
    return detection.reason.replace(/^启发式：/, '');
  }
  if (language === 'zh') {
    switch (detection.ruleId) {
      case 'blocked':
        return 'X 仍在显示你已拉黑的账号';
      case 'local-repeat':
        return '多个账号发布了高度相似的内容';
      case 'list':
        return '社区名单中的垃圾账号';
      case 'community-fingerprint':
      case 'community-fingerprint-sim':
        return '与已确认垃圾账号发布的内容高度相似';
      case 'community-domain':
        return hostname ? `包含社区确认的可疑链接（${hostname}）` : '包含社区确认的可疑链接';
      case 'default-name-digits':
        return '账号资料疑似批量生成';
      case 'spam-link-hint':
        return hostname ? `包含可疑推广链接（${hostname}）` : '包含可疑推广链接';
      case 'templated-text':
        return '内容包含常见垃圾导流特征';
      case 'porn-bait-zh':
        return '内容包含成人引流特征';
      case 'adult-traffic-bait':
        return '内容包含成人引流话术';
      default:
        return '检测到可疑垃圾特征';
    }
  }
  switch (detection.ruleId) {
    case 'blocked':
      return 'Blocked account still shown by X';
    case 'local-repeat':
      return 'Highly similar content posted by multiple accounts';
    case 'list':
      return 'Known spam account';
    case 'community-fingerprint':
      return 'Very similar to content from confirmed spam accounts';
    case 'community-fingerprint-sim':
      return 'Similar to content from confirmed spam accounts';
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
    case 'adult-traffic-bait':
      return 'Adult-content traffic bait';
    default:
      return 'Spam pattern detected';
  }
}
