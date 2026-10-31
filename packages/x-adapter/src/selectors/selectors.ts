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
  /** 单条推文容器：X 对 article + data-testid="tweet" 相当稳定。 */
  article: 'article[data-testid="tweet"]',
  /** 时间线格子（article 的外层 cell）。标注边框打在这层，绝不进 article 内部破坏其 grid 布局。 */
  timelineCell: 'div[data-testid="cellInnerDiv"]',
  /** 作者信息区（含 displayName 与 @handle 链接）。 */
  authorNameArea: '[data-testid="User-Name"]',
  /** 作者行里指向 /handle 的链接（displayName 同样包在一个用户链接里）。 */
  authorLink: '[data-testid="User-Name"] a[href^="/"]',
  /** 正文文本区。 */
  text: '[data-testid="tweetText"]',
  /**
   * 推文底部动作栏锁定锨。X 会调整按钮数量，因此不靠 CSS class：
   * 找 like/unlike 按钮后再 closest([role=group])。
   */
  actionAnchor: '[data-testid="like"], [data-testid="unlike"]',
  actionGroup: '[role="group"]',
} as const;

export const menuSelectors = {
  /** 推文右上的 ... 操作菜单触发按钮。 */
  caretButton: '[data-testid="caret"]',
  /** X 的弹出菜单容器（分享菜单、... 菜单共用；2026-10-30 真机确认）。 */
  dropdown: '[data-testid="Dropdown"]',
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
