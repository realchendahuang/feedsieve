/**
 * Selector Registry（TECHNICAL_SPEC.md §5.2）。
 *
 * 原则：selector 只准出现在这里，禁止散落在业务代码里；
 * 多级策略：稳定 data-testid / role -> DOM 结构 + href 语义 -> aria label -> locale text；
 * 禁止仅依赖易变 CSS class。
 *
 * selector 改动必须配合 fixtures/x 脱敏样本验证。
 */

export const tweetSelectors = {
  /** 旧版 testid；新版用语义动作标记确认 article 是推文，避免扫描普通文章或长文阅读容器。 */
  article:
    'article:not([data-testid="twitterArticleReadView"]):is([data-testid="tweet"], :has([data-engagement-action="like"], [data-engagement-action="unlike"]))',
  /** 时间线格子（article 的外层 cell）。标注边框打在这层，绝不进 article 内部破坏其 grid 布局。 */
  timelineCell: 'div[data-testid="cellInnerDiv"]',
  /** 作者头像容器（旧版 testid；新版由 reader 按本帖作者链接定位）。 */
  avatarContainer: '[data-testid="Tweet-User-Avatar"]',
  /** 作者信息区（含 displayName 与 @handle 链接；新版由 reader 校验固定链接或作者对偶关系）。 */
  authorNameArea: ':is([data-testid="User-Name"], .x-middot-group)',
  /** 作者行里指向 /handle 的链接（displayName 同样包在一个用户链接里）。 */
  authorLink: '[data-testid="User-Name"] a[href^="/"]',
  /** 蓝标认证图标（旧版 testid + 新版中英文无障碍标签）。 */
  verifiedBadge:
    ':is([data-testid="icon-verified"], [aria-label="认证账号"], [aria-label="Verified account"])',
  /** 正文文本区。 */
  // 新版正文无语义属性：reader 还会验证它与已确认的作者头部共享父容器，
  // 不仅凭排版类读取任意节点（2026-11-16 fixtures/x/timeline/redesign.ts）。
  text: ':is([data-testid="tweetText"], div.whitespace-pre-wrap.wrap-anywhere)',
  /**
   * 推文底部动作栏锁定锨。X 会调整按钮数量，因此不靠 CSS class：
   * 找 like/unlike 按钮后再 closest([role=group])。
   */
  actionAnchor:
    ':is([data-testid="like"], [data-testid="unlike"], [data-engagement-action="like"], [data-engagement-action="unlike"])',
  actionGroup: '[role="group"]',
  engagementAction: '[data-engagement-action]',
  statusLink: 'a[href*="/status/"]',
  profileLink: 'a[href^="/"]',
  legacyNameArea: '[data-testid="User-Name"]',
  legacyText: '[data-testid="tweetText"]',
} as const;

export const menuSelectors = {
  /** 推文右上的 ... 操作菜单触发按钮。 */
  caretButton:
    ':is([data-testid="caret"], button[data-slot="xds-menu-trigger"]:not([role="group"] *))',
  /** X 的弹出菜单容器（旧版 Dropdown + 新版 XDS menu content / 语义 menu）。 */
  dropdown:
    ':is([data-testid="Dropdown"], [data-slot="xds-menu-content"], [role="menu"]:has([role="menuitem"]))',
  menuItem: '[role="menuitem"]',
} as const;

/**
 * 动作栏里有 data-testid 的固定按钮。分享按钮没有 data-testid，
 * 只能按「动作栏里不属于这些的按钮」识别（2026-10-30 真机确认）。
 */
export const KNOWN_ACTION_TEST_IDS = [
  'reply',
  'retweet',
  'unretweet',
  'like',
  'unlike',
  'bookmark',
  'removeBookmark',
] as const;

/** 引用帖卡片：X 用可点击的 div[role=link] 包住被引用的推文。 */
export const QUOTE_CARD_SELECTOR = 'div[role="link"]';

/**
 * 个人主页资料卡。洞察行插在资料卡信息行（地点 / 加入时间那一行）后面；
 * 找不到时依次退回到简介、名字区域之后（未抓包确认，X 改版时按这里的顺序降级）。
 */
export const profileSelectors = {
  headerAnchors: [
    '[data-testid="UserProfileHeader_Items"]',
    '[data-testid="UserDescription"]',
    '[data-testid="UserName"]',
  ],
} as const;
