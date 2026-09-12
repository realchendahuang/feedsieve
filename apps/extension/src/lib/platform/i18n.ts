import { categoryLabel as sharedCategoryLabel } from '@feedsieve/shared';

export type UiLanguage = 'zh' | 'en';

// 分类标签唯一权威源在 @feedsieve/shared；此处保留 i18n 签名与回退语义（未知分类回退原始串）。
export function categoryLabel(category: string, language: UiLanguage): string {
  return sharedCategoryLabel(category, language);
}

const LANGUAGE_KEY = 'uiLanguage';

export const UI_COPY = {
  zh: {
    brand: '福滤娃',
    home: '清理',
    lists: '名单',
    keywords: '关键词',
    hunting: '打野',
    primaryNavigation: '主要导航',
    language: '语言',
    languageSetting: '界面语言',
    aboutLinks: '关于',
    githubLink: 'GitHub',
    officialSiteLink: '官网',
    siteBlacklist: '官网黑名单公示',
    siteWhitelist: '官网推荐白名单',
    siteKeywords: '官网词库',
    siteRescue: '官网抢救公示',
    marked: '标注',
    blocked: '拉黑',
    restored: '撤销',
    saved: '省下',
    share: '分享到 X',
    pageMarked: '当前页面',
    pageClean: '当前页面没有待处理账号',
    pageCleanHint: '未识别出待处理账号，通常是页面清单尚未刷新',
    processing: '处理中…',
    blockPage: '一键拉黑全部',
    batchBlockSelected: (count: number) => `一键拉黑选中的 ${count} 个`,
    selectedCount: (selected: number, total: number) => `待清理 ${selected} / ${total}`,
    excludeItem: '剔除',
    excludeItemHint: '本次清理不再出现该账号',
    selectAll: '全选',
    deselectAll: '全不选',
    allDismissed: '已全部剔除',
    openSidePanel: '切换侧边栏',
    sidePanelOpenFailed: '侧边栏打开失败',
    noPostContent: '未抓取到正文',
    refreshPage: '刷新当前页面清单',
    manageBlocked: '拉黑记录',
    noBlocked: '还没有拉黑记录',
    blockedTweet: '看推文',
    falsePositiveList: '白名单',
    missedAccount: '漏网账号',
    missedAccountHint: '输入 @用户名或粘贴 X 个人主页链接',
    markSpamAndBlock: '拉黑',
    invalidHandle: '请输入有效的 X 用户名或个人主页链接',
    manualBlocked: (handle: string) => `已拉黑 @${handle}`,
    communityClean: '社区',
    cloudProtected: '已排除',
    communitySourceMaintainer: '推荐白名单',
    votesUnit: '票',
    communityEmpty: '当前没有新增账号需要处理',
    communityEmptyDetail: '同步到新名单后会显示在这里',
    startCommunityClean: (count: number) => `一键开始清理 ${count} 个`,
    queueProgress: (done: number, total: number) => `清理进度 ${done} / ${total}`,
    manualBlockHint: '没识别到？可在帖子右下角点「拉黑」手动处理',
    sortVotes: '票数',
    sortAlpha: '字母',
    queueRunning: '进行中',
    queuePaused: '已暂停',
    queueCompleted: '已完成',
    queueCancelled: '已取消',
    safetyQuota: (used: number, limit: number) => `今日安全额度 ${used}/${limit}`,
    queuePausedQuota: (limit: number) =>
      `今日安全额度已到（${limit}/24h）。仍要继续可以，但被 X 临时限制的风险会变高。`,
    queuePausedRateLimit: '短时间请求过多，已暂停。等 15 分钟后再继续。',
    pause: '暂停',
    resume: '继续',
    resumeAnyway: '仍要继续',
    cancel: '取消',
    followingTab: '关注',
    syncFollowing: '同步关注列表',
    resyncFollowing: '重新同步关注列表',
    syncFollowingWorking: (count: number) => `正在同步，已读取 ${count} 个`,
    syncFollowingComplete: (count: number) => `关注保护已更新，共 ${count} 个`,
    syncFollowingInterrupted: '上次同步已中断，旧保护仍然有效',
    keywordRules: '关键词规则',
    keywordRulesHint: '命中会标黄，是否拉黑由你决定。',
    keywordPlaceholder: '添加你想标记的词或短语',
    addKeyword: '添加',
    myKeywords: '我的关键词',
    noCustomKeywords: '还没有自定义关键词',
    officialKeywords: '官方预置词库',
    subscribeKeywordPack: '订阅此词库',
    unsubscribeKeywordPack: '退订此词库',
    syncKeywordPacks: '同步词库',
    keywordPacksSynced: (version?: string) => (version ? `词库已更新至 v${version}` : '词库已同步'),
    removeKeyword: '移除',
    keywordAdded: '已添加关键词，X 页面会立即重新标注',
    keywordInvalid: '关键词不能为空且不能超过 80 个字符',
    keywordLimit: '最多可添加 80 个自定义关键词',
    contributeKeyword: '贡献给官方词库',
    keywordContributed: '已匿名提交，官方审阅后会纳入词库',
    personalConfig: '备份与迁移',
    personalConfigHint:
      '只备份个人关键词和显示偏好；不会上传，不包含账号、黑白名单、关注列表或 X 登录信息。',
    exportPersonalConfig: '导出个人配置',
    importPersonalConfig: '导入个人配置',
    personalConfigExported: '个人配置已下载',
    personalConfigExportFailed: '导出失败',
    personalConfigReadFailed: '无法读取这个配置文件',
    personalConfigInvalid: '这不是可导入的福滤娃个人配置',
    personalConfigUnsupportedVersion: '该配置文件版本暂不支持',
    personalConfigFileTooLarge: '配置文件不能超过 256 KB',
    personalConfigPreview: '导入预览',
    personalConfigCustomPreview: (
      backup: number,
      result: number,
      added: number,
      existing: number,
    ) => `自定义关键词：备份 ${backup} 条，导入后 ${result} 条（新增 ${added}，已有 ${existing}）`,
    personalConfigReplaceCustomPreview: (result: number, removed: number) =>
      `自定义关键词：保留备份中的 ${result} 条，移除本机独有 ${removed} 条`,
    personalConfigCategories: (count: number) => `词库分类设置将更新 ${count} 项`,
    personalConfigRules: (count: number) => `单条官方规则将更新 ${count} 项`,
    personalConfigPreferences: (count: number) => `显示偏好将更新 ${count} 项`,
    personalConfigIgnored: (categories: number, rules: number) =>
      `已忽略当前词库不存在的项目：分类 ${categories} 个，规则 ${rules} 条`,
    personalConfigNoChanges: '备份与当前设置相同',
    personalConfigOn: '开启',
    personalConfigOff: '关闭',
    personalConfigMore: (count: number) => `另 ${count} 项`,
    personalConfigMerge: '合并导入',
    personalConfigReplace: '替换导入',
    personalConfigCancel: '取消',
    personalConfigMergeLimit: (count: number) =>
      `合并后会有 ${count} 条关键词，超过 80 条上限；可改用替换导入。`,
    personalConfigImported: '个人配置已导入；仅本地设置已更新',
    personalConfigApplyFailed: '导入未完整完成，请检查本机设置后重试',
    undo: '撤销',
    undoAll: '全部撤销',
    settings: '设置',
    settingsSub: '我的',
    goBack: '返回',
    enabled: '页面标黄',
    strength: '检测强度',
    autoContribute: '名单上传',
    localOnly: '仅本地运行',
    localOnlyHint: '开启后只在本机识别和拉黑。关闭时，你确认拉黑的账号会上传账号名、判断依据与其公开发布的推文/简介，用于防垃圾与纠错。',
    allowlistEmpty: '还没有白名单账号',
    recommendListTitle: '推荐白名单',
    recommendListEmpty: '暂无',
    allowlistAddLabel: '添加白名单',
    allowlistPlaceholder: '输入 @用户名或粘贴 X 个人主页链接',
    allowlistAdd: '添加',
    allowlistAdded: (handle: string) => `已加入白名单 @${handle}`,
    removeAllowlist: '移出白名单并恢复标注',
    openXNotice: '请先打开或刷新 x.com',
    blockUnavailable: '拉黑接口暂不可用（X 变更或会话失效）；检测与标注不受影响',
    killSwitchActive: (reason?: string) =>
      reason ? `官方暂停了拉黑操作：${reason}` : '官方暂停了社区拉黑操作',
    copiedId: '已复制安装 ID',
    copyFailed: '复制失败',
    synced: (version?: string) => (version ? `已更新至 v${version}` : '已更新'),
    upToDate: '已是最新',
    manualSync: '手动刷新',
    dailyBudget: '每日预算',
    dailyBudgetHint:
      '批量拉黑是自动化行为，预算越高风控风险越高——被 X 临时锁定、要求验证甚至封号的后果由你自行承担。清空则恢复自适应，干净账号预算会自动逐日爬升。',
    budgetUpdated: (value: number) => `日预算已设为 ${value}`,
    budgetHighRisk: (value: number) =>
      `日预算已设为 ${value}。这个量级被 X 临时锁定、强制验证甚至封号的风险显著更高，由此造成的账号后果完全由你自己承担。`,
    budgetAdaptive: '已恢复自适应预算：预算随干净日逐日自动爬升，不再封顶',
    budgetInvalid: '日预算需为不小于 1 的数字',
    manualSyncHint: '立即重新拉取社区名单等远端数据；平时自动同步无需手动跑。',
    manualSyncAction: '立即刷新',
    syncFailed: '同步失败',
    unavailable: '暂不可用',
    backgroundUnavailable: '后台未就绪',
    blockedResult: (value: number) => `已拉黑 ${value} 个`,
    restoredResult: (value: number) => `已撤销 ${value} 个`,
    failedResult: (value: number) => `失败 ${value} 个`,
    falsePositive: '误标',
    falsePositiveHint: '加入本地白名单，以后不再标注该账号',
    rescue: '申诉',
    failed: '失败',
    unknown: '未知',
    // 打野排位赛
    statToday: '今日猎获',
    statBullets: '子弹余量',
    statWeek: '本周排名',
    statBeaten: '打败猎手',
    hunterKillsUnit: '只野',
    hunterUnrankedShort: '还没开火',
    hunterSection: '猎手',
    hunterEmailPlaceholder: '邮箱',
    hunterSendCode: '发送验证码',
    hunterCodeSent: (email: string) => `验证码已发到 ${email}`,
    hunterCodePlaceholder: '6 位验证码',
    hunterVerify: '验证',
    hunterDisplayName: '昵称',
    hunterBio: '一句话介绍',
    hunterSave: '保存',
    hunterProfileSaved: '已保存',
    hunterVerified: '已验证',
    hunterError: '操作失败，稍后再试',
    hunterTopBoard: '本周榜',
    hunterUnranked: '本周零杀，打野去',
    hunterOpenSite: '官网看完整榜单 · 规则与赛季',
    hunterLoading: '榜单加载中',
    hunterLoadFailed: '榜单加载失败',
    hunterRetry: '重试',
    hunterAccuracyHint: '共识击杀里被社区复核确认的比例',
    hunterXHandle: 'X 账号',
    hunterXHandleInvalid: 'X 账号格式不对（不带 @，1-15 位字母数字下划线）',
    hunterEmailHint:
      '绑定并验证邮箱后，昵称 / 简介 / X 账号才会展示到公开榜单；邮箱只用来收验证码，不公开、不入库（只存哈希）',
    hunterClose: '关闭',
    hunterProfileLabel: '个人资料',
    hunterNotClaimed: '未认领',
    hunterInvalidEmail: '邮箱格式不对',
    hunterRateLimited: '发码太频繁，1 小时后再试',
    hunterMailUnavailable: '邮件服务不可用，稍后再试',
    hunterTooManyAttempts: '错码太多，请重新发码',
    hunterCodeInvalid: '验证码不对或已过期',
    hunterChangeEmail: '换个邮箱',
    hunterBindEmail: '绑定邮箱',
  },
  en: {
    brand: 'FeedSieve',
    home: 'Clean',
    lists: 'Lists',
    keywords: 'Keywords',
    hunting: 'Hunting',
    primaryNavigation: 'Primary navigation',
    language: 'Language',
    languageSetting: 'Interface language',
    aboutLinks: 'About',
    githubLink: 'GitHub',
    officialSiteLink: 'Website',
    marked: 'Marked',
    blocked: 'Blocked',
    restored: 'Restored',
    saved: 'Saved',
    share: 'Share on X',
    pageMarked: 'On this page',
    pageClean: 'No accounts to review on this page',
    pageCleanHint: 'Nothing detected — the page list usually just needs a refresh',
    processing: 'Working…',
    blockPage: 'Block all marked',
    batchBlockSelected: (count: number) => `Block selected (${count})`,
    selectedCount: (selected: number, total: number) => `${selected} of ${total} selected`,
    excludeItem: 'Exclude',
    excludeItemHint: 'Dismiss from this cleanup',
    selectAll: 'Select all',
    deselectAll: 'Deselect all',
    allDismissed: 'All dismissed',
    openSidePanel: 'Side Panel',
    sidePanelOpenFailed: 'Failed to open side panel',
    noPostContent: 'No post content captured',
    refreshPage: 'Refresh accounts on this page',
    manageBlocked: 'Block history',
    noBlocked: 'No blocked accounts yet',
    blockedTweet: 'View tweet',
    falsePositiveList: 'Allowlist',
    missedAccount: 'Missed account',
    missedAccountHint: 'Enter an @handle or paste an X profile URL',
    markSpamAndBlock: 'Block',
    invalidHandle: 'Enter a valid X handle or profile URL',
    manualBlocked: (handle: string) => `Blocked @${handle}`,
    communityClean: 'Community',
    cloudProtected: 'Excluded',
    communitySourceMaintainer: 'Maintainer-verified',
    votesUnit: 'votes',
    communityEmpty: 'No new accounts to process',
    communityEmptyDetail: 'Newly synced entries will appear here',
    startCommunityClean: (count: number) => `Start cleaning ${count}`,
    queueProgress: (done: number, total: number) => `Progress ${done} / ${total}`,
    manualBlockHint: "Not detected? Use the Block button at a post's bottom-right",
    sortVotes: 'Votes',
    sortAlpha: 'A–Z',
    queueRunning: 'Running',
    queuePaused: 'Paused',
    queueCompleted: 'Completed',
    queueCancelled: 'Cancelled',
    safetyQuota: (used: number, limit: number) => `Daily safety quota ${used}/${limit}`,
    queuePausedQuota: (limit: number) =>
      `Daily safety quota reached (${limit}/24h). You can continue, but X may temporarily restrict the account.`,
    queuePausedRateLimit:
      'Too many requests in a short window. Paused — try again in about 15 minutes.',
    pause: 'Pause',
    resume: 'Resume',
    resumeAnyway: 'Continue anyway',
    cancel: 'Cancel',
    followingTab: 'Following',
    syncFollowing: 'Sync following list',
    resyncFollowing: 'Restart following sync',
    syncFollowingWorking: (count: number) => `Syncing · ${count} read`,
    syncFollowingComplete: (count: number) => `Following protection updated · ${count}`,
    syncFollowingInterrupted: 'The previous sync was interrupted; existing protection is intact',
    keywordRules: 'Keyword rules',
    keywordRulesHint: 'Matches are highlighted; you decide whether to block them.',
    keywordPlaceholder: 'Add a word or phrase to highlight',
    addKeyword: 'Add',
    myKeywords: 'My keywords',
    noCustomKeywords: 'No custom keywords yet',
    officialKeywords: 'Official preset lists',
    subscribeKeywordPack: 'Subscribe to this pack',
    unsubscribeKeywordPack: 'Unsubscribe from this pack',
    syncKeywordPacks: 'Sync rule packs',
    keywordPacksSynced: (version?: string) =>
      version ? `Rule packs updated to v${version}` : 'Rule packs synced',
    removeKeyword: 'Remove',
    keywordAdded: 'Keyword added; X will be rescanned now',
    keywordInvalid: 'Keywords must be 1–80 characters',
    keywordLimit: 'You can add up to 80 custom keywords',
    contributeKeyword: 'Contribute to official wordpacks',
    keywordContributed: 'Submitted anonymously; will be reviewed for official wordpacks',
    personalConfig: 'Backup & migration',
    personalConfigHint:
      'Back up only your keywords and display preferences. Nothing is uploaded; accounts, lists, following, and X sign-in data are excluded.',
    exportPersonalConfig: 'Export personal config',
    importPersonalConfig: 'Import personal config',
    personalConfigExported: 'Personal config downloaded',
    personalConfigExportFailed: 'Could not export config',
    personalConfigReadFailed: 'Could not read this config file',
    personalConfigInvalid: 'This is not a valid FeedSieve personal config',
    personalConfigUnsupportedVersion: 'This config version is not supported yet',
    personalConfigFileTooLarge: 'Config files must be 256 KB or smaller',
    personalConfigPreview: 'Import preview',
    personalConfigCustomPreview: (
      backup: number,
      result: number,
      added: number,
      existing: number,
    ) =>
      `Custom keywords: ${backup} in backup, ${result} after import (${added} added, ${existing} already here)`,
    personalConfigReplaceCustomPreview: (result: number, removed: number) =>
      `Custom keywords: keep ${result} from the backup and remove ${removed} local-only entries`,
    personalConfigCategories: (count: number) => `${count} category subscriptions will change`,
    personalConfigRules: (count: number) => `${count} official rules will change`,
    personalConfigPreferences: (count: number) => `${count} display preferences will change`,
    personalConfigIgnored: (categories: number, rules: number) =>
      `Unavailable items skipped: ${categories} categories and ${rules} rules`,
    personalConfigNoChanges: 'This backup matches the current settings',
    personalConfigOn: 'On',
    personalConfigOff: 'Off',
    personalConfigMore: (count: number) => `${count} more`,
    personalConfigMerge: 'Merge import',
    personalConfigReplace: 'Replace import',
    personalConfigCancel: 'Cancel',
    personalConfigMergeLimit: (count: number) =>
      `Merge would create ${count} keywords, above the 80-keyword limit. Use replace import instead.`,
    personalConfigImported: 'Personal config imported; only local settings changed',
    personalConfigApplyFailed: 'Import did not finish; check local settings before trying again',
    undo: 'Restore',
    undoAll: 'Restore all',
    settings: 'Settings',
    settingsSub: 'Me',
    goBack: 'Back',
    enabled: 'Highlight on page',
    strength: 'Detection level',
    autoContribute: 'List uploads',
    localOnly: 'Local-only mode',
    localOnlyHint:
      'Keep detection and blocking on this device without community uploads. When uploads are on, accounts you block send their handle, the evidence behind the call, and their publicly posted tweet/bio for spam analysis and correction.',
    allowlistEmpty: 'No allowlisted accounts yet',
    recommendListTitle: 'Recommended',
    recommendListEmpty: 'None yet',
    allowlistAddLabel: 'Add to allowlist',
    allowlistPlaceholder: 'Enter an @handle or paste an X profile URL',
    allowlistAdd: 'Add',
    allowlistAdded: (handle: string) => `Added to allowlist: @${handle}`,
    removeAllowlist: 'Remove from allowlist and resume marking',
    openXNotice: 'Open or refresh x.com first',
    blockUnavailable:
      'Block endpoint unavailable (X changed or session expired); detection unaffected',
    killSwitchActive: (reason?: string) =>
      reason ? `Blocking paused by maintainers: ${reason}` : 'Blocking paused by maintainers',
    copiedId: 'Installation ID copied',
    copyFailed: 'Could not copy',
    synced: (version?: string) => (version ? `Updated to v${version}` : 'Updated'),
    upToDate: 'Up to date',
    manualSync: 'Manual refresh',
    dailyBudget: 'Daily budget',
    dailyBudgetHint:
      'Bulk blocking is an automated behavior — a higher budget means higher risk of temporary lock, verification walls or suspension by X, on you. Clear the field to restore adaptive budget that grows daily without a cap.',
    budgetUpdated: (value: number) => `Daily budget set to ${value}`,
    budgetHighRisk: (value: number) =>
      `Daily budget set to ${value}. At this level the risk of temporary lock, forced verification or suspension by X rises significantly — any account consequences are entirely yours.`,
    budgetAdaptive: 'Adaptive budget restored: budget now grows daily via clean days with no cap',
    budgetInvalid: 'Daily budget must be a number of at least 1',
    manualSyncHint:
      'Re-fetch the community lists and other remote data now; auto-sync normally needs no manual run.',
    manualSyncAction: 'Refresh now',
    syncFailed: 'Sync failed',
    unavailable: 'Unavailable',
    backgroundUnavailable: 'Background service is not ready',
    blockedResult: (value: number) => `${value} blocked`,
    restoredResult: (value: number) => `${value} restored`,
    failedResult: (value: number) => `${value} failed`,
    falsePositive: 'Not spam',
    falsePositiveHint: 'Add to your local allowlist and stop marking this account',
    rescue: 'Appeal',
    failed: 'Failed',
    unknown: 'Unknown',
    siteBlacklist: 'Blacklist on the site',
    siteWhitelist: 'Whitelist on the site',
    siteKeywords: 'Keyword packs on the site',
    siteRescue: 'Rescue list on the site',
    // Hunting leaderboard
    statToday: 'Today kills',
    statBullets: 'Bullets left',
    statWeek: 'Week rank',
    statBeaten: 'Hunters beaten',
    hunterKillsUnit: '',
    hunterUnrankedShort: 'Not fired yet',
    hunterSection: 'Hunter',
    hunterEmailPlaceholder: 'Email',
    hunterSendCode: 'Send code',
    hunterCodeSent: (email: string) => `Code sent to ${email}`,
    hunterCodePlaceholder: '6-digit code',
    hunterVerify: 'Verify',
    hunterDisplayName: 'Name',
    hunterBio: 'Bio',
    hunterSave: 'Save',
    hunterProfileSaved: 'Saved',
    hunterVerified: 'Verified',
    hunterError: 'Something went wrong, try again later',
    hunterTopBoard: 'This week',
    hunterUnranked: 'No kills yet, go hunting',
    hunterOpenSite: 'Full board, rules and seasons on the site',
    hunterLoading: 'Loading board',
    hunterLoadFailed: 'Board failed to load',
    hunterRetry: 'Retry',
    hunterAccuracyHint: 'Share of consensus kills confirmed by community review',
    hunterXHandle: 'X handle',
    hunterXHandleInvalid: 'Invalid X handle (no @, 1-15 letters/digits/underscore)',
    hunterEmailHint:
      'Your name / bio / X handle show on the public board only after email verification; your email is just for the one-time code — never published, stored hashed',
    hunterClose: 'Close',
    hunterProfileLabel: 'Profile',
    hunterNotClaimed: 'Not claimed',
    hunterInvalidEmail: 'Invalid email',
    hunterRateLimited: 'Too many codes requested, try again in an hour',
    hunterMailUnavailable: 'Mail service unavailable, try later',
    hunterTooManyAttempts: 'Too many wrong codes, request a new one',
    hunterCodeInvalid: 'Code invalid or expired',
    hunterChangeEmail: 'Change email',
    hunterBindEmail: 'Bind email',
  },
} as const;

export function defaultUiLanguage(): UiLanguage {
  return 'zh';
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

// （分类标签已收敛到 @feedsieve/shared，见文件头部 categoryLabel 委托）

export function localizedDetectionReason(
  language: UiLanguage,
  detection: { source: string; ruleId?: string | null; reason: string },
): string {
  const hostname = detection.reason.match(/[（(]([^()（）]+)[）)]/)?.[1];
  if (detection.ruleId?.startsWith('keyword:')) {
    // “heuristic”只是 Detector 内部接口名；用户词库要显示人话，不能泄露 rule id。
    const raw = detection.reason.replace(/^启发式：/, '');
    if (language === 'zh') {
      return raw;
    }
    // 词库短语本身是中文（官方库 630 条成人话术），前缀与命中字段翻给英文用户，
    // 短语保留原样便于核对词包。
    const fieldValue = raw.match(/·\s*(昵称|账号|正文|简介)$/)?.[1];
    const fieldEn: Record<string, string> = {
      昵称: 'name',
      账号: 'handle',
      正文: 'post',
      简介: 'bio',
    };
    const stripped = raw.replace(/·\s*(昵称|账号|正文|简介)$/, '');
    const prefix = stripped.startsWith('命中你的关键词：')
      ? 'Custom keyword: '
      : 'Official rule: ';
    const body = stripped.replace(/^(?:命中你的关键词|命中官方规则)：/, '');
    return `${prefix}${body}${fieldValue ? ` · ${fieldEn[fieldValue]}` : ''}`;
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
      case 'weak-signal-combo':
        // 规则理由本身就是证据清单（「批量注册特征 + …」），直接透出
        return detection.reason;
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
    case 'weak-signal-combo':
      return 'Batch-registration account with suspicious content';
    default:
      return 'Spam pattern detected';
  }
}
