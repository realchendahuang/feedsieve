/**
 * 推文作者头部区域的公共定位辅助，供 AI 味徽标与量级胶囊共用。
 */

const PROMOTED_LABEL_RE = /^(?:推广|Promoted)$/i;

/** FeedSieve 注入到作者信息区里的节点，找 X 原生行容器时必须跳过。 */
export function isOwnHeaderDecoration(node: Element): boolean {
  return (
    node.classList.contains('fs-tier') ||
    node.classList.contains('fs-ai-mark') ||
    node.classList.contains('fs-ai-entry')
  );
}

/**
 * 找到承载 `@handle · 时间` 的行容器，用来追加 `.fs-tier` 与 `.fs-ai-mark`。
 *
 * 新版 `.x-middot-group` 在推广帖里把末尾子节点写成纯文本 `<span>推广</span>`：
 * 不能往该 span 内部塞子节点，否则会破坏 `clean-ui` 的 `childElementCount === 0` 广告判定，
 * 此时退回 `nameArea` 本身。
 */
export function findAuthorMetaRow(nameArea: Element): Element | null {
  const rows = [...nameArea.children].filter((child) => !isOwnHeaderDecoration(child));
  const last = rows[rows.length - 1];
  if (!last) return null;
  if (
    last.tagName === 'SPAN' &&
    last.childElementCount === 0 &&
    PROMOTED_LABEL_RE.test((last.textContent ?? '').trim())
  ) {
    return nameArea;
  }
  return last;
}
