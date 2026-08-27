import { detect, toHandleSet } from '@feedsieve/detector';
import {
  contextFromPath,
  extractFeedItem,
  tweetSelectors,
} from '@feedsieve/x-adapter';
import { isPending, setPendingBlock } from '../src/lib/pending-blocks';
import builtinListJson from '../../../community/lists/recommended.json';

/**
 * 内置社区名单（TECHNICAL_SPEC.md：YAML 公开源 -> 构建期直接引用 JSON 产物）。
 * 名单更新走 Phase 4 的 Snapshot Consumer，这里 v0.1 先随扩展打包。
 */
const BUILTIN_LIST = toHandleSet(
  (builtinListJson as { entries: unknown }).entries as never[],
);

const MARK_ATTRIBUTE = 'data-fs-marked';
const STYLE_ELEMENT_ID = 'feedsieve-mark-styles';

/**
 * Phase 1 content script：黄框标注（带理由）+ 勾选加入待拉黑列表。
 *
 * - ISOLATED world（冻结决策）
 * - 标注绝不改动页面内容显示，也不破坏 X 布局。
 *   借鉴成熟方案（PureTwitter / TBWL）：
 *   1. 黄圈打在 article 的外层 cellInnerDiv 上 —— 纯 border，无背景色；
 *      绝不往 article（CSS grid 容器）里塞元素。
 *   2. 理由徽章作为 cellInnerDiv 的块级子元素排在推文下方，不覆盖任何内容。
 * - MutationObserver 只发现候选节点，WeakSet 去重，debounce 批量扫描
 */
export default defineContentScript({
  matches: ['https://x.com/*'],
  main() {
    const seenArticles = new WeakSet<Element>();
    const pendingCache = new Set<string>();
    let scanTimer: number | undefined;

    ensureStyles();
    refreshPendingCache();

    function refreshPendingCache(): void {
      void browser.storage.local
        .get('pendingBlocks')
        .then((result) => {
          pendingCache.clear();
          for (const block of (result.pendingBlocks as Array<{ handle?: string }>) ?? []) {
            if (block.handle) {
              pendingCache.add(block.handle);
            }
          }
        })
        .catch(() => {
          // storage 异常时保持旧缓存；勾选状态可能滞后一拍，可接受
        });
    }

    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes['pendingBlocks']) {
        refreshPendingCache();
      }
    });

    function scan(): void {
      const context = contextFromPath(location.pathname);
      for (const article of document.querySelectorAll(tweetSelectors.article)) {
        if (seenArticles.has(article)) {
          continue;
        }
        seenArticles.add(article);

        const item = extractFeedItem(article, context);
        if (!item) {
          continue;
        }

        const detection = detect({
          handle: item.author.handle,
          displayName: item.author.displayName,
          text: item.text,
          links: item.links,
        }, { list: BUILTIN_LIST, listSource: 'builtin-list' });

        if (!detection) {
          continue;
        }

        // 标注打在外层时间线格子上（PureTwitter 同款目标层）；找不到才退回 article
        const cell = article.closest(tweetSelectors.timelineCell) ?? article;
        markCell(cell as HTMLElement, detection);
      }
    }

    function scheduleScan(): void {
      window.clearTimeout(scanTimer);
      scanTimer = window.setTimeout(scan, 300);
    }

    new MutationObserver(scheduleScan).observe(document.body, {
      childList: true,
      subtree: true,
    });

    // SPA 路由变化：X 不触发页面加载，靠 History API 探测以刷新 context
    window.addEventListener('popstate', scheduleScan);
    window.addEventListener('hashchange', scheduleScan);

    scheduleScan();

    // ---------- 标注 UI ----------

    function markCell(
      cell: HTMLElement,
      detection: NonNullable<ReturnType<typeof detect>>,
    ): void {
      cell.setAttribute(MARK_ATTRIBUTE, detection.source);
      attachBadge(cell, detection);
    }

    function attachBadge(
      cell: HTMLElement,
      detection: NonNullable<ReturnType<typeof detect>>,
    ): void {
      if (cell.querySelector('.fs-badge')) {
        return;
      }

      const badge = document.createElement('div');
      badge.className = 'fs-badge';

      const label = document.createElement('span');
      label.className = 'fs-reason';
      label.textContent = `🟡 ${detection.reason}`;
      label.title = `来源：${detection.source} · 规则：${detection.ruleId ?? '-'}`;

      const checkbox = document.createElement('label');
      checkbox.className = 'fs-pick';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.addEventListener('change', () => {
        void setPendingBlock(detection.handle, input.checked, detection.reason).catch(
          () => {
            input.checked = !input.checked; // 写入失败回滚勾选态
          },
        );
      });
      checkbox.appendChild(input);
      checkbox.appendChild(document.createTextNode('待拉黑'));

      badge.append(label, checkbox);
      // cellInnerDiv 是普通块容器：徽章作为新块级子元素排在推文下方，
      // 处于文档流内但不进入 article 的 grid，不覆盖、不挤压任何 X 内容。
      cell.appendChild(badge);

      // X 可能整棵重渲染节点；异步对齐一次勾选态，防 pendingCache 未及时刷新
      void isPending(detection.handle).then((isOn) => {
        input.checked = isOn;
      });
    }
  },
});

function ensureStyles(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
    /* PureTwitter 同款策略：只画一圈黄边框，无背景色、无 outline。
       border + box-sizing 让格子内容微缩而不破坏整体布局。 */
    [${MARK_ATTRIBUTE}] {
      border: 4px solid #f2c94c !important;
      border-radius: 16px;
      box-sizing: border-box !important;
      overflow: hidden !important;
    }
    .fs-badge {
      display: flex;
      gap: 10px;
      align-items: center;
      padding: 3px 10px;
      margin: 2px 12px 8px;
      width: fit-content;
      max-width: calc(100% - 24px);
      border: 1px solid #f2c94c;
      border-radius: 999px;
      background: #fffbe6;
      color: #5c4d00;
      font-size: 12px;
      line-height: 1.5;
    }
    .fs-reason { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fs-pick { display: flex; align-items: center; gap: 4px; white-space: nowrap; cursor: pointer; user-select: none; }
    .fs-pick input { accent-color: #d4a900; cursor: pointer; }
  `;
  document.documentElement.appendChild(style);
}
