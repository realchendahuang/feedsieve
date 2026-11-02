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
    brandHint: '中文 X 刷推副驾驶：评论区不骚了，好帖也不漏了。开源，MIT 协议。',
    newPosts: (n: number) => `有 ${n} 条新热帖`,
    langZhOnly: '仅中文',
    hideRead: '隐藏已读',
    allFiltered: '这一批都看过了，或者不是中文',
    replyNow: '去回复',
    scopeLabel: '范围',
    scopeMine: '我刷到的',
    scopeGlobal: '全站',
    globalUpdated: (ago: string) => `全站热榜 · 更新于 ${ago}前`,
    globalUpdatedNow: '全站热榜 · 刚刚更新',
    globalEmpty: '全站热榜还没有数据',
    globalEmptyHint:
      '同一条帖子被足够多的福滤娃用户（来自不同网络）刷到、而且正在火，才会进入全站热榜。榜单每 5 分钟更新。',
    globalRefresh: '刷新全站热榜',
    globalStale: '全站热榜暂时连不上，显示的是上次的数据',
    hotRankUp: (n: number) => `比半小时前上升 ${n} 名`,
    hotRankNew: '新上榜',
    hotRankNewShort: '新',
    globalUnavailable: '全站热榜暂时不可用',
    hitContribute: '上报规则命中',
    hitContributeHint:
      '本地规则给某个账号打了黄框时，匿名报一条「哪个账号、哪条规则、正文指纹」。命中不是投票，只用来统计每条规则的误伤率（误伤多的规则会自动停用）、给已有人工票的账号作佐证、推断分类。只报官方规则，个人自定义关键词不报；不带安装 ID、Cookie 和你的 X 账号，扩展也不会为此多请求 X。',
    hotContribute: '参与全站热榜',
    hotContributeHint:
      '只上报你刷到的、正在火的公开帖子（每小时 1000 次浏览以上），默认每 15 分钟最多一次：浏览、点赞等计数，正文前 280 字，作者公开资料，用来汇总全站热榜。不带你的 X 账号和安装 ID，只带每天更换的随机编号；私信、通知、书签等页面上看到的帖子、受保护账号和你自己的帖子都不上报。扩展不会为此多请求 X，上报直接发往福滤娃服务器。打开「仅本地运行」时也会停止。',
    verified: '已认证',
    statReplies: '回复',
    statReposts: '转发',
    statLikes: '喜欢',
    statViews: '浏览',
    statBookmarks: '收藏',
    hot: '热帖',
    profileNav: '主页',
    profileNotOnProfile: '打开一个博主的主页',
    profileNotOnProfileHint:
      '在 x.com 打开任意博主的主页，这里会显示他的爆款、规律和基线。数据来自你浏览时 X 已经加载的帖子，只存在本机，不上传。',
    profileEmpty: '往下滚动主页，帖子会自动收进来',
    profileEmptyHint:
      '只有你点「补全这个博主」时才会向下滚动，也不会额外请求 X：你看到的帖子才会收进来。点「在 X 搜高赞帖」可以一次收进他点赞最高的一批。',
    profileFill: '补全这个博主',
    profileFillHint:
      '一次翻到底，X 加载出下一批就继续；加载快时几乎不停，随时再点停止。同一博主 3 分钟内只补一次。',
    profileFillStop: '停止补全',
    profileFillRunning: '正在慢慢向下滚动补全…',
    profileFillDone: (n: number) => `补全了 ${n} 条`,
    profileFillEnd: '已经滚到底了',
    profileFillNone: '没有加载到更多帖子',
    profileFillCooldown: (minutes: number) => `刚补过，${minutes} 分钟后再试`,
    profileFillNotProfile: '补全只在这个博主的主页上生效',
    profileFillFailed: '补全失败，稍后再试',
    profileFollowers: '粉丝',
    profileFollowing: '关注',
    profileRatio: '关注比',
    profileJoined: (years: number) => (years < 1 ? '注册不满 1 年' : `注册 ${years} 年`),
    profilePostsCount: '发帖',
    profileMedian: '中位浏览',
    profileOutlierRate: '爆款率',
    profileCoverage: '已收',
    profileCoverageValue: (n: number) => `${n} 条`,
    profileCoverageUnit: '条',
    profileBaselineHint: (sample: number, since: string) =>
      `基线只算原创和引用、发出满 24 小时的帖子，共 ${sample} 条；不含回复、转推和推广帖。浏览是中位数 3 倍以上的算爆款，疑似投流的不计入。${since} 开始收集。`,
    profileSampleLow: (n: number) => `再收 ${n} 条原创帖子就能算倍数`,
    profileSort: '排序',
    profileSortOptions: {
      multiple: '倍数',
      views: '浏览',
      likes: '点赞',
      bookmarks: '收藏',
      saveRate: '收藏率',
      recent: '最新',
    },
    profileRange: '时间范围',
    profileRangeOptions: { '30': '30 天', '90': '90 天', '365': '1 年', all: '全部' },
    profileIncludeReplies: '含回复',
    profileKind: { quote: '引用', reply: '回复', pinned: '置顶' },
    profileBoosted: '疑似投流',
    profileBoostedHint:
      '浏览是中位数 5 倍以上，互动率却远低于他平时最低的水平，可能投了推广。不计入爆款率。',
    profileEstimated: '发出不满 24 小时，按预计 24 小时浏览估算',
    profileFormats: '内容形式',
    profileFormatsHint:
      '每种形式的帖子中位倍数（至少 5 条才显示）。高于 1× 说明这种形式比他平时表现好。',
    profileFormatNames: { text: '纯文字', photo: '图片', video: '视频', quote: '引用' },
    profileFormatCount: (n: number) => `${n} 条`,
    profileHeatmap: '发帖时段',
    profileHeatmapHint:
      '按你的本地时间，每格 4 小时。颜色越深，这个时段发的帖子表现越好（中位倍数）；一个格子至少 2 条才着色。',
    profileWeekdays: ['日', '一', '二', '三', '四', '五', '六'],
    profileHeatCell: (day: string, from: number, to: number, value: string, count: number) =>
      `周${day} ${from}–${to} 点 · ${value} · ${count} 条`,
    profilePatterns: '内容形式与发帖时段',
    profileSearchHighLikes: '在 X 搜高赞帖',
    profileGoogle: '用 Google 搜他的帖子',
    profileGoogleHint:
      'X 自带的搜索经常漏帖子。Google 收录了大部分公开帖子，可以按关键词和时间范围找。',
    profileGoogleKeyword: '关键词（可选）',
    profileGoogleRange: { any: '不限时间', y: '一年内', m: '一个月内', w: '一周内' },
    profileGoogleGo: '在 Google 搜',
    profileCopyAiHint:
      '把倍数最高的 20 条（不含回复和疑似投流）整理成 Markdown，附上分析要求，直接粘贴给 ChatGPT、Claude。',
    profileExportHint: '导出当前筛选下的全部帖子，含各项数字和倍数。',
    profileMultipleTip: (views: string, median: string, multiple: string) =>
      `浏览 ${views}，是他中位浏览 ${median} 的 ${multiple}`,
    profileMultipleOutlier: '3 倍以上算爆款',
    profileSearchHint: (query: string) =>
      `新开一个 X 搜索页：${query}。和你自己搜一样，搜到的帖子会自动收进来；扩展不会替你翻页。`,
    profileCopyAi: '复制 Top 20 给 AI',
    profileCopied: '已复制',
    profileShareImage: '分享洞察图',
    profileShareImageHint:
      '画一张 4:5 的主页洞察图（中位浏览、爆款率、最近三条帖子），复制到剪贴板，直接贴进聊天窗口或发 X。',
    profileImageCopied: '已复制图片',
    profileImageDownloaded: '已存为图片',
    profileExportCsv: '导出 CSV',
    profileExported: '已导出',
    profileActionFailed: '操作失败，请重试',
    profileOpenPost: '打开帖子',
    profileAiHeader: (handle: string) => `# @${handle} 的爆款帖（按相对他自己中位数的倍数排序）`,
    profileAiMeta: (median: string, sample: number, date: string) =>
      `中位浏览 ${median}，基线样本 ${sample} 条。数据来自 FeedSieve 在本机收集的帖子，截至 ${date}。`,
    profileAiAsk:
      '请分析这些帖子：开头的钩子怎么写、结构和节奏、选题有什么共性；最后总结 3–5 个可以直接套用的模板。',
    profileAiItem: (rank: number, multiple: string, views: string, likes: string, saves: string) =>
      `## ${rank}. ${multiple} · 浏览 ${views} · 点赞 ${likes} · 收藏 ${saves}`,
    profileClear: '清空主页数据',
    profileClearHint: '删除本机为博主主页收集的帖子（不影响热帖和名单）。',
    profileCleared: '已清空',
    profileClearAction: (n: number) => (n > 0 ? `清空（${n} 个博主）` : '清空'),
    profileClearConfirm: '再点一次确认',
    home: '清理',
    briefSeen: '帖子',
    briefHot: '在火',
    briefMedian: '中位流速',
    viewsCount: (n: string) => `${n} 浏览`,
    opportunityRemaining: (views: string) => `+${views} 浏览`,
    opportunityHoursLeft: (hours: number) => `剩 ${hours} 小时`,
    opportunityCompetition: (replies: number) => `${replies} 条回复`,
    pageMarked: '本页标黄',
    pageClean: '本页没有标黄的账号',
    selectForBlock: '加入本次拉黑',
    blockCount: (count: number) => `拉黑 ${count} 个`,
    excludeItem: '移除',
    excludeItemHint: '从本次清单移除，不拉黑也不加白名单',
    communityBlocklist: '社区黑名单',
    communityRemaining: (count: number) => `${count} 个未拉黑`,
    blockAll: '全部拉黑',
    confirmBlockAll: (count: number) => `再点一次：拉黑 ${count} 个`,
    queueProgress: (done: number, total: number) => `进度 ${done} / ${total}`,
    keywordSummary: (custom: number, packs: number) => `${custom} 个自定义 · ${packs} 组词库`,
    groupFilter: '过滤',
    groupDisplay: '显示',
    groupData: '数据与隐私',
    followingTab: '关注保护',
    followingProtected: '已保护的关注',
    followingProtectHint: '你关注的账号永远不会被标黄或拉黑。关注了新的人以后，重新同步一次。',
    followingLastSync: '上次同步',
    dailyBudget: '每日拉黑上限',
    manualSync: '社区数据',
    manualSyncAction: '立即同步',
    manageBlocked: '拉黑记录',
    falsePositiveList: '白名单',
    insightBadgesHint:
      '推文右上角显示当前流速（每小时浏览；绿色平稳，红色正在火）；作者名旁显示量级图标和粉丝数。悬停看档位、破圈倍数和详细解释。只用当前页面已加载的数据，不上传。',
    insight: '洞察',
    briefTitle: '最近刷到',
    briefEmpty: '刷一会儿 x.com，正在火的帖子会出现在这里',
    hotPosts: '热帖',
    hotPostsHint:
      '最近 2 小时你在所有 X 标签页刷到、流速达到每小时 1000 浏览的帖子，没那么热的不收；刷到的帖子普遍冷清时门槛自动调低，最低每小时 300。「热度」按流速、破圈和发布时间综合排序。数据只在浏览器内存里，关闭浏览器即清空，不上传；扩展也不会为此额外请求 X。键盘：j / k 上下切换，Enter 打开，r 回复，x 不看这条。',
    hotEmpty: '还没有热帖',
    hotEmptySeen: (n: number) => `刷到 ${n} 条，暂时没有在火的`,
    hotSeenAgo: (ago: string) => (ago === '刚刚' ? '刚刷到' : `${ago}前刷到`),
    hotPostedAgo: (ago: string) => (ago === '刚刚' ? '刚发布' : `发布于 ${ago}前`),
    hotToastLocated: '已在页面上定位',
    hotToastOpened: '已在后台打开',
    hotDismiss: '不看这条',
    hotRestore: '恢复',
    hotToastDismissed: '已隐藏这条',
    hotMuteAuthor: (handle: string) => `不看 @${handle}`,
    hotToastMuted: (handle: string) => `已不看 @${handle}`,
    hotUndo: '撤销',
    hotHiddenChip: '已隐藏',
    hotMoreFromAuthor: (n: number, handle: string) => `还有 ${n} 条 @${handle} 的热帖`,
    hotCollapseAuthor: '收起',
    hotNewArrived: (n: number) => `新增 ${n} 条热帖`,
    hotEmptyHint:
      '热帖来自你正常浏览 X 时页面已经加载的数据。打开 x.com 刷一会儿，这里会自动更新，不用手动刷新。',
    hotSort: '排序',
    hotSortOptions: {
      heat: '热度',
      day: '24 小时',
      opportunity: '回复机会',
      followers: '粉丝数',
      bookmarks: '收藏数',
      recent: '最近刷到',
    },
    hotRecentHint:
      '按帖子第一次出现在你屏幕上的时间排，刚滑到的在最上面；同样只收流速达到每小时 1000 浏览的帖子。X 预加载但你还没滑到的不算，滑过之后又翻回来看的也不会重新排到上面。',
    hotOpportunityHint:
      '帮你挑现在去回复最划算的帖子：按「热度窗口内预计还能新增的浏览 ÷ 已有回复数」排序。发帖超过 24 小时的不列入。估算值，仅供参考。',
    hotOpenPost: '打开帖子',
    hotSortRising: '飙升',
    hotRisingHint:
      '全站福滤娃用户最近刷到、正在火的帖子，按最近半小时到一小时的涨速、破圈倍数和发布时间排；发布超过 24 小时的不收。在榜满 6 小时开始降权，满 12 小时下榜；同一作者最多占 2 个名次。数字前的「↑」是比半小时前上升的名次。黄推话术、X 标记的敏感内容和社区黑名单作者不上榜。',
    hotDayHint:
      '24 小时内发布、最近 3 小时还有人刷到的帖子，按浏览数排；同一作者最多占 2 个名次。适合回看今天错过的大帖。',
    insightBadges: '流速与量级',
    keywords: '关键词',
    primaryNavigation: '主要导航',
    language: '语言',
    languageSetting: '界面语言',
    aboutLinks: '语言与关于',
    githubLink: 'GitHub',
    officialSiteLink: '官网',
    siteBlacklist: '官网黑名单公示',
    siteWhitelist: '官网推荐白名单',
    siteKeywords: '官网词库',
    blocked: '拉黑',
    share: '分享到 X',
    pageCleanHint: '未识别出待处理账号，通常是页面清单尚未刷新',
    processing: '处理中…',
    selectAll: '全选',
    deselectAll: '全不选',
    allDismissed: '已全部移除',
    openSidePanel: '切换侧边栏',
    sidePanelOpenFailed: '侧边栏打开失败',
    noPostContent: '未抓取到正文',
    refreshPage: '刷新当前页面清单',
    noBlocked: '还没有拉黑记录',
    blockedTweet: '看推文',
    missedAccount: '漏网账号',
    missedAccountHint: '输入 @用户名或粘贴 X 个人主页链接',
    markSpamAndBlock: '拉黑',
    invalidHandle: '请输入有效的 X 用户名或个人主页链接',
    manualBlocked: (handle: string) => `已拉黑 @${handle}`,
    manualBlockHint: '没识别到？可在帖子右下角点「拉黑」手动处理',
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
    syncFollowing: '同步关注列表',
    resyncFollowing: '重新同步关注列表',
    syncFollowingWorking: (count: number) => `正在同步，已读取 ${count} 个`,
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
    exportPersonalConfig: '导出',
    importPersonalConfig: '导入',
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
    goBack: '返回',
    enabled: '页面标黄',
    enabledHint: '在评论区、时间线和通知里给可疑账号标黄框，写清命中原因。',
    groupModules: '功能',
    moduleAi: 'AI 味标注',
    moduleAiHint:
      '评论区里的 AI 标签、折叠条，以及回复旁的检测按钮。关闭后 X 页面上不再出现；弹窗「AI 味」页仍可手动检测。',
    moduleClean: '界面净化',
    moduleCleanHint:
      '隐藏「为你推荐」、趋势、推荐关注、付费推广和 Grok，并把字体换成中文更清楚的系统字体。默认关闭，按需开启；只改外观，不动内容。',
    cleanUi: '总开关',
    cleanUiHint: '打开后下面的净化项才生效。',
    cleanForYou: '隐藏「为你推荐」',
    cleanForYouHint: '隐藏首页的「为你推荐」标签页，并停在「正在关注」。',
    cleanTrends: '隐藏趋势',
    cleanTrendsHint: '隐藏右侧栏的趋势、热门话题模块。',
    cleanWhoToFollow: '隐藏推荐关注',
    cleanWhoToFollowHint: '隐藏右侧栏的「推荐关注」模块。',
    cleanPromoted: '隐藏付费推广',
    cleanPromotedHint: '隐藏时间线里标着「推广」的帖子。',
    cleanGrok: '隐藏 Grok',
    cleanGrokHint: '隐藏左侧导航里的 Grok 入口。',
    cleanPremiumReplies: '淡化纯回复位蓝标',
    cleanPremiumRepliesHint:
      '评论区里蓝标作者、正文很短的回复降低不透明度，减少「只为回复位买蓝 V」的干扰。',
    cleanFont: '系统字体',
    cleanFontHint: 'X 的 Chirp 字体不含中文字形，开启后中文改用 PingFang SC 等系统字体。',
    moduleCompose: '发帖辅助',
    moduleComposeHint: '发帖框排期、发帖节奏和文章编辑增强。',
    cadence: '发帖节奏',
    cadenceHint: '集中在哪些天、哪些时段发，每小时最多几条，分钟随机与最多提前多久。',
    cadenceMeta: (n: number) => `${n} 个时段`,
    composeHelper: '发帖框排期按钮',
    composeHelperHint:
      '发帖框日历图标旁的「排下一条」按钮，以及 X 安排表顶上的快捷时间（+1 小时、明天此时、同上一条、±15 分钟）。',
    articleHelper: '文章编辑增强',
    articleHelperHint:
      '在 X 文章编辑器里粘贴 Markdown 自动排版（标题、列表、引用、加粗、链接、代码块），开头的 # 标题自动填进文章标题；右下角显示字数、阅读时长和大纲，可导入 .md 文件。⌘⇧V 粘贴原文。',
    moduleShare: '分享菜单',
    moduleShareHint: '在 X 的分享菜单里加「复制为 Markdown」「复制推文与评论」。',
    strength: '检测强度',
    autoContribute: '名单上传',
    localOnly: '仅本地运行',
    localOnlyHint:
      '开启后只在本机识别和拉黑。关闭时，你确认拉黑的账号会上传账号名、判断依据与其公开发布的推文/简介，用于防垃圾与纠错。',
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
    synced: (version?: string) => (version ? `已更新至 v${version}` : '已更新'),
    upToDate: '已是最新',
    dailyBudgetHint:
      '批量拉黑是自动化行为，预算越高风控风险越高——被 X 临时锁定、要求验证甚至封号的后果由你自行承担。清空则恢复自适应，干净账号预算会自动逐日爬升。',
    budgetUpdated: (value: number) => `日预算已设为 ${value}`,
    budgetHighRisk: (value: number) =>
      `日预算已设为 ${value}。这个量级被 X 临时锁定、强制验证甚至封号的风险显著更高，由此造成的账号后果完全由你自己承担。`,
    budgetAdaptive: '已恢复自适应预算：预算随干净日逐日自动爬升，不再封顶',
    budgetInvalid: '日预算需为不小于 1 的数字',
    manualSyncHint: '立即重新拉取社区名单等远端数据；平时自动同步无需手动跑。',
    syncFailed: '同步失败',
    unavailable: '暂不可用',
    backgroundUnavailable: '后台未就绪',
    blockedResult: (value: number) => `已拉黑 ${value} 个`,
    restoredResult: (value: number) => `已撤销 ${value} 个`,
    failedResult: (value: number) => `失败 ${value} 个`,
    falsePositive: '误标',
    falsePositiveHint: '加入本地白名单，以后不再标注该账号',
    failed: '失败',
    unknown: '未知',
  },
  en: {
    brand: 'FeedSieve',
    brandHint:
      'A browsing companion for X: cleaner replies, and no good post missed. Open source, MIT licensed.',
    newPosts: (n: number) => `${n} new hot posts`,
    langZhOnly: 'Chinese only',
    hideRead: 'Hide read',
    allFiltered: 'You have seen all of these, or none match the language filter',
    replyNow: 'Reply',
    scopeLabel: 'Scope',
    scopeMine: 'Mine',
    scopeGlobal: 'Global',
    globalUpdated: (ago: string) => `Global list · updated ${ago} ago`,
    globalUpdatedNow: 'Global list · updated just now',
    globalEmpty: 'No global hot posts yet',
    globalEmptyHint:
      'A post joins the global list once enough FeedSieve users on different networks have seen it while it is taking off. The list updates every 5 minutes.',
    globalRefresh: 'Refresh the global list',
    globalStale: 'Cannot reach the global list right now; showing the last copy',
    hotRankUp: (n: number) => `Up ${n} places in the last half hour`,
    hotRankNew: 'New on the list',
    hotRankNewShort: 'New',
    globalUnavailable: 'The global list is unavailable right now',
    hitContribute: 'Report rule hits',
    hitContributeHint:
      'When a built-in rule marks an account, send an anonymous note of the account, the rule and a text fingerprint. Rule hits are not votes: they measure how often each rule misfires (noisy rules are turned off automatically), back up accounts that already have votes, and help pick a category. Only official rules are reported, never your custom keywords; no install ID, cookies or X account, and no extra requests to X.',
    hotContribute: 'Join the global hot list',
    hotContributeHint:
      'Shares only posts you scroll past that are heating up (1,000+ views per hour), by default at most once every 15 minutes: view and like counts, the first 280 characters and the public author profile to build the global hot list. No X account or install ID is sent, only a random ID that changes every day. Posts seen in DMs, notifications or bookmarks, protected accounts and your own posts are never sent. The extension makes no extra requests to X; uploads go straight to the FeedSieve server. Local-only mode stops it too.',
    verified: 'Verified',
    statReplies: 'Replies',
    statReposts: 'Reposts',
    statLikes: 'Likes',
    statViews: 'Views',
    statBookmarks: 'Bookmarks',
    hot: 'Hot',
    profileNav: 'Profile',
    profileNotOnProfile: 'Open a creator’s profile',
    profileNotOnProfileHint:
      'Open any creator’s profile on x.com to see their outliers, patterns and baseline here. Built from posts X already loaded while you browse; stored only on this device, never uploaded.',
    profileEmpty: 'Scroll the profile and posts will be collected',
    profileEmptyHint:
      'It only scrolls when you hit “Complete this profile”, and makes no extra requests to X: only posts you see are collected. “Search top posts on X” collects their most-liked posts in one go.',
    profileFill: 'Complete this profile',
    profileFillHint:
      'Jumps to the bottom and continues as soon as X loads more; click again to stop. Once per creator every 3 minutes.',
    profileFillStop: 'Stop completing',
    profileFillRunning: 'Scrolling down slowly…',
    profileFillDone: (n: number) => `Completed with ${n} more posts`,
    profileFillEnd: 'Reached the end of this profile',
    profileFillNone: 'No more posts were loaded',
    profileFillCooldown: (minutes: number) => `Just completed, try again in ${minutes} min`,
    profileFillNotProfile: 'Completing only works on this creator’s profile page',
    profileFillFailed: 'Could not complete, try again later',
    profileFollowers: 'Followers',
    profileFollowing: 'Following',
    profileRatio: 'Ratio',
    profileJoined: (years: number) => (years < 1 ? 'Joined < 1 yr' : `Joined ${years} yr`),
    profilePostsCount: 'Posts',
    profileMedian: 'Median views',
    profileOutlierRate: 'Outlier rate',
    profileCoverage: 'Collected',
    profileCoverageValue: (n: number) => `${n}`,
    profileCoverageUnit: '',
    profileBaselineHint: (sample: number, since: string) =>
      `The baseline uses originals and quotes at least 24 hours old (${sample} posts); replies, reposts and promoted posts are excluded. Posts with 3× the median views count as outliers; likely boosted posts are left out. Collecting since ${since}.`,
    profileSampleLow: (n: number) => `${n} more original posts needed for multiples`,
    profileSort: 'Sort',
    profileSortOptions: {
      multiple: 'Multiple',
      views: 'Views',
      likes: 'Likes',
      bookmarks: 'Bookmarks',
      saveRate: 'Save rate',
      recent: 'Newest',
    },
    profileRange: 'Range',
    profileRangeOptions: { '30': '30 days', '90': '90 days', '365': '1 year', all: 'All' },
    profileIncludeReplies: 'Replies',
    profileKind: { quote: 'Quote', reply: 'Reply', pinned: 'Pinned' },
    profileBoosted: 'Likely boosted',
    profileBoostedHint:
      '5× the median views but engagement far below their usual low: probably promoted. Not counted in the outlier rate.',
    profileEstimated: 'Under 24h old: estimated from projected 24h views',
    profileFormats: 'Formats',
    profileFormatsHint:
      'Median multiple per format (shown with at least 5 posts). Above 1× means the format beats their usual post.',
    profileFormatNames: { text: 'Text', photo: 'Photo', video: 'Video', quote: 'Quote' },
    profileFormatCount: (n: number) => `${n} posts`,
    profileHeatmap: 'Posting times',
    profileHeatmapHint:
      'In your local time, 4 hours per cell. Darker means posts from that slot did better (median multiple); a cell needs at least 2 posts.',
    profileWeekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    profileHeatCell: (day: string, from: number, to: number, value: string, count: number) =>
      `${day} ${from}:00–${to}:00 · ${value} · ${count} posts`,
    profilePatterns: 'Formats and posting times',
    profileSearchHighLikes: 'Search top posts on X',
    profileGoogle: 'Search their posts on Google',
    profileGoogleHint:
      'X search often misses posts. Google indexes most public posts and can filter by keyword and date.',
    profileGoogleKeyword: 'Keywords (optional)',
    profileGoogleRange: { any: 'Any time', y: 'Past year', m: 'Past month', w: 'Past week' },
    profileGoogleGo: 'Search on Google',
    profileCopyAiHint:
      'Copies the 20 posts with the highest multiples (no replies or likely boosted posts) as Markdown with an analysis prompt, ready for ChatGPT or Claude.',
    profileExportHint: 'Exports every post in the current filter, with all counts and multiples.',
    profileMultipleTip: (views: string, median: string, multiple: string) =>
      `${views} views, ${multiple} their median of ${median}`,
    profileMultipleOutlier: '3× or more counts as an outlier',
    profileSearchHint: (query: string) =>
      `Opens an X search: ${query}. Same as searching yourself; results are collected automatically, and the extension never pages through them for you.`,
    profileCopyAi: 'Copy top 20 for AI',
    profileCopied: 'Copied',
    profileShareImage: 'Copy insight image',
    profileShareImageHint:
      'Draws a 4:5 profile insight card (median views, outlier rate, three recent posts) and copies it to the clipboard.',
    profileImageCopied: 'Image copied',
    profileImageDownloaded: 'Image saved',
    profileExportCsv: 'Export CSV',
    profileExported: 'Exported',
    profileActionFailed: 'Something went wrong, try again',
    profileOpenPost: 'Open post',
    profileAiHeader: (handle: string) =>
      `# @${handle}'s outlier posts (ranked by multiple of their own median)`,
    profileAiMeta: (median: string, sample: number, date: string) =>
      `Median views ${median}, baseline of ${sample} posts. Collected locally by FeedSieve, as of ${date}.`,
    profileAiAsk:
      'Analyse these posts: how the opening hooks are written, structure and pacing, and what the topics have in common. Finish with 3–5 templates I can reuse.',
    profileAiItem: (rank: number, multiple: string, views: string, likes: string, saves: string) =>
      `## ${rank}. ${multiple} · ${views} views · ${likes} likes · ${saves} bookmarks`,
    profileClear: 'Clear profile data',
    profileClearHint:
      'Deletes posts collected for creator profiles on this device (hot posts and lists are kept).',
    profileCleared: 'Cleared',
    profileClearAction: (n: number) => (n > 0 ? `Clear (${n} creators)` : 'Clear'),
    profileClearConfirm: 'Click again to confirm',
    home: 'Clean',
    briefSeen: 'Posts',
    briefHot: 'Heating up',
    briefMedian: 'Median velocity',
    viewsCount: (n: string) => `${n} views`,
    opportunityRemaining: (views: string) => `+${views} views`,
    opportunityHoursLeft: (hours: number) => `${hours}h left`,
    opportunityCompetition: (replies: number) => `${replies} replies`,
    pageMarked: 'Marked on this page',
    pageClean: 'Nothing marked on this page',
    selectForBlock: 'Include in this batch',
    blockCount: (count: number) => `Block ${count}`,
    excludeItem: 'Remove',
    excludeItemHint: 'Remove from this list without blocking or allowlisting',
    communityBlocklist: 'Community blocklist',
    communityRemaining: (count: number) => `${count} not blocked`,
    blockAll: 'Block all',
    confirmBlockAll: (count: number) => `Click again: block ${count}`,
    queueProgress: (done: number, total: number) => `${done} / ${total}`,
    keywordSummary: (custom: number, packs: number) => `${custom} custom · ${packs} packs`,
    groupFilter: 'Filtering',
    groupDisplay: 'Display',
    groupData: 'Data & privacy',
    followingTab: 'Follow protection',
    followingProtected: 'Protected follows',
    followingProtectHint:
      'Accounts you follow are never marked or blocked. Sync again after you follow new people.',
    followingLastSync: 'Last synced',
    dailyBudget: 'Daily block limit',
    manualSync: 'Community data',
    manualSyncAction: 'Sync now',
    manageBlocked: 'Block history',
    falsePositiveList: 'Allowlist',
    insightBadgesHint:
      'Shows current velocity (views per hour; green is steady, red is heating up) at the top right of posts, plus a tier icon with follower count next to names. Hover for the tier, reach and details. Uses only data already loaded on the page; nothing is uploaded.',
    insight: 'Insight',
    briefTitle: 'Recently seen',
    briefEmpty: 'Scroll x.com for a while and posts that are taking off will show up here',
    hotPosts: 'Hot posts',
    hotPostsHint:
      'Posts you saw in any X tab over the last 2 hours that are getting at least 1,000 views per hour; quieter posts are left out. When everything you see is quiet, the bar drops automatically, down to 300 per hour. Heat ranks by views per hour, reach beyond followers and age. The data stays in browser memory, is cleared when the browser closes, and is never uploaded; the extension makes no extra requests to X for it. Keys: j / k to move, Enter to open, r to reply, x to hide.',
    hotEmpty: 'No hot posts yet',
    hotEmptySeen: (n: number) => `Saw ${n} posts, none taking off yet`,
    hotSeenAgo: (ago: string) => (ago === 'now' ? 'just seen' : `seen ${ago} ago`),
    hotPostedAgo: (ago: string) => (ago === 'now' ? 'just posted' : `posted ${ago} ago`),
    hotToastLocated: 'Found it on the page',
    hotToastOpened: 'Opened in a background tab',
    hotDismiss: 'Hide this post',
    hotRestore: 'Show again',
    hotToastDismissed: 'Post hidden',
    hotMuteAuthor: (handle: string) => `Hide @${handle}`,
    hotToastMuted: (handle: string) => `Hiding posts from @${handle}`,
    hotUndo: 'Undo',
    hotHiddenChip: 'Hidden',
    hotMoreFromAuthor: (n: number, handle: string) => `${n} more from @${handle}`,
    hotCollapseAuthor: 'Show less',
    hotNewArrived: (n: number) => `${n} new hot posts`,
    hotEmptyHint:
      'Hot posts come from data X already loaded while you browse. Scroll x.com for a while and this list updates by itself.',
    hotSort: 'Sort',
    hotSortOptions: {
      heat: 'Heat',
      day: '24 hours',
      opportunity: 'Reply chance',
      followers: 'Followers',
      bookmarks: 'Bookmarks',
      recent: 'Just seen',
    },
    hotRecentHint:
      'Ranked by when each post first appeared on your screen, newest on top; only posts getting at least 1,000 views per hour. Posts X preloaded but you have not scrolled to are left out, and scrolling back to a post does not move it up again.',
    hotOpportunityHint:
      'Finds the posts most worth replying to right now: ranked by estimated views still to come in the hot window ÷ existing replies. Posts older than 24 hours are excluded. Estimates only.',
    hotOpenPost: 'Open post',
    hotSortRising: 'Rising',
    hotRisingHint:
      'Posts FeedSieve users saw recently that are taking off, ranked by how fast they grew over the last half hour to an hour, reach beyond followers and age; posts older than 24 hours are left out. After 6 hours on the list a post starts to drop, and it leaves after 12; one author takes at most 2 places. "↑" shows places gained in the last half hour. Porn bait, posts X marks as sensitive and community-blocklisted authors are kept off.',
    hotDayHint:
      'Posts from the last 24 hours that people still saw in the last 3 hours, ranked by views; one author takes at most 2 places. Good for catching up on today’s big posts.',
    insightBadges: 'Velocity & tier',
    keywords: 'Keywords',
    primaryNavigation: 'Primary navigation',
    language: 'Language',
    languageSetting: 'Interface language',
    aboutLinks: 'Language & about',
    githubLink: 'GitHub',
    officialSiteLink: 'Website',
    blocked: 'Blocked',
    share: 'Share on X',
    pageCleanHint: 'Nothing detected — the page list usually just needs a refresh',
    processing: 'Working…',
    selectAll: 'Select all',
    deselectAll: 'Deselect all',
    allDismissed: 'All dismissed',
    openSidePanel: 'Side Panel',
    sidePanelOpenFailed: 'Failed to open side panel',
    noPostContent: 'No post content captured',
    refreshPage: 'Refresh accounts on this page',
    noBlocked: 'No blocked accounts yet',
    blockedTweet: 'View tweet',
    missedAccount: 'Missed account',
    missedAccountHint: 'Enter an @handle or paste an X profile URL',
    markSpamAndBlock: 'Block',
    invalidHandle: 'Enter a valid X handle or profile URL',
    manualBlocked: (handle: string) => `Blocked @${handle}`,
    manualBlockHint: "Not detected? Use the Block button at a post's bottom-right",
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
    syncFollowing: 'Sync following list',
    resyncFollowing: 'Restart following sync',
    syncFollowingWorking: (count: number) => `Syncing · ${count} read`,
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
    exportPersonalConfig: 'Export',
    importPersonalConfig: 'Import',
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
    goBack: 'Back',
    enabled: 'Highlight on page',
    enabledHint:
      'Put a yellow box with the reason on suspicious accounts in replies, timelines and notifications.',
    groupModules: 'Features',
    moduleAi: 'AI labels',
    moduleAiHint:
      'AI pills, fold bars, and the check button next to replies on X. Turning this off removes them from the page; the AI tab in the popup still runs manual checks.',
    moduleClean: 'Cleaner UI',
    moduleCleanHint:
      'Hides For You, trends, who to follow, promoted posts and Grok, and switches to a system font that renders Chinese properly. Off by default; appearance only.',
    cleanUi: 'Master switch',
    cleanUiHint: 'The options below only take effect when this is on.',
    cleanForYou: 'Hide “For You”',
    cleanForYouHint: 'Hides the For You tab on home and stays on Following.',
    cleanTrends: 'Hide trends',
    cleanTrendsHint: 'Hides the trends and trending topics module in the right column.',
    cleanWhoToFollow: 'Hide who to follow',
    cleanWhoToFollowHint: 'Hides the “Who to follow” module in the right column.',
    cleanPromoted: 'Hide promoted posts',
    cleanPromotedHint: 'Hides posts marked as promoted in the timeline.',
    cleanGrok: 'Hide Grok',
    cleanGrokHint: 'Hides the Grok entry in the left navigation.',
    cleanPremiumReplies: 'Dim thin verified replies',
    cleanPremiumRepliesHint:
      'Reduces opacity of short replies by verified accounts, so “bought a blue check for the reply slot” accounts stand out less.',
    cleanFont: 'System font',
    cleanFontHint:
      'Chirp has no Chinese glyphs. Use PingFang SC and other system fonts for Chinese text.',
    moduleCompose: 'Composer helpers',
    moduleComposeHint: 'Composer scheduling, posting cadence, and the article editor.',
    cadence: 'Posting cadence',
    cadenceHint:
      'Which days and windows you post in, how many per hour at most, random minutes and how far ahead to schedule.',
    cadenceMeta: (n: number) => `${n} window${n === 1 ? '' : 's'}`,
    composeHelper: 'Composer schedule button',
    composeHelperHint:
      'The Schedule next button next to the calendar icon in the composer, and quick times at the top of X’s schedule dialog.',
    articleHelper: 'Article editor',
    articleHelperHint:
      'Paste Markdown into the X article editor to format it; a leading # heading becomes the title. A panel shows word count, reading time and outline, and imports .md files. ⌘⇧V pastes plain text.',
    moduleShare: 'Share menu',
    moduleShareHint: 'Adds “Copy as Markdown” and “Copy post and replies” to X’s share menu.',
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
    synced: (version?: string) => (version ? `Updated to v${version}` : 'Updated'),
    upToDate: 'Up to date',
    dailyBudgetHint:
      'Bulk blocking is an automated behavior — a higher budget means higher risk of temporary lock, verification walls or suspension by X, on you. Clear the field to restore adaptive budget that grows daily without a cap.',
    budgetUpdated: (value: number) => `Daily budget set to ${value}`,
    budgetHighRisk: (value: number) =>
      `Daily budget set to ${value}. At this level the risk of temporary lock, forced verification or suspension by X rises significantly — any account consequences are entirely yours.`,
    budgetAdaptive: 'Adaptive budget restored: budget now grows daily via clean days with no cap',
    budgetInvalid: 'Daily budget must be a number of at least 1',
    manualSyncHint:
      'Re-fetch the community lists and other remote data now; auto-sync normally needs no manual run.',
    syncFailed: 'Sync failed',
    unavailable: 'Unavailable',
    backgroundUnavailable: 'Background service is not ready',
    blockedResult: (value: number) => `${value} blocked`,
    restoredResult: (value: number) => `${value} restored`,
    failedResult: (value: number) => `${value} failed`,
    falsePositive: 'Not spam',
    falsePositiveHint: 'Add to your local allowlist and stop marking this account',
    failed: 'Failed',
    unknown: 'Unknown',
    siteBlacklist: 'Blacklist on the site',
    siteWhitelist: 'Whitelist on the site',
    siteKeywords: 'Keyword packs on the site',
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
    const prefix = stripped.startsWith('命中你的关键词：') ? 'Custom keyword: ' : 'Official rule: ';
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
      case 'fresh-account-combo':
        // 规则理由本身就是证据清单（「批量注册特征 + …」「新注册小号 + …」），直接透出
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
    case 'fresh-account-combo':
      return 'Newly registered account with suspicious content';
    default:
      return 'Spam pattern detected';
  }
}
