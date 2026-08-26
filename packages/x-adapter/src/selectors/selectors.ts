/**
 * Selector Registry（TECHNICAL_SPEC.md §5.2）。
 *
 * 原则：selector 只准出现在这里，禁止散落在业务代码里；
 * 多级策略：稳定 data-testid / role -> DOM 结构 + href 语义 -> aria label -> locale text；
 * 禁止仅依赖易变 CSS class。
 *
 * Phase 0 先立边界；真实 selector 将在 Phase 1 配合 fixtures/x 脱敏样本固化。
 */

export const tweetSelectors = {
  /** 单条推文容器：X 对 article + data-testid="tweet" 相当稳定。 */
  article: 'article[data-testid="tweet"]',
  /** 作者信息区（含 displayName 与 @handle 链接）。 */
  authorNameArea: '[data-testid="User-Name"]',
} as const;

export const menuSelectors = {
  /** 推文右上的 ... 操作菜单触发按钮。 */
  caretButton: '[data-testid="caret"]',
} as const;
