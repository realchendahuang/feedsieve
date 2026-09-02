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
} as const;
