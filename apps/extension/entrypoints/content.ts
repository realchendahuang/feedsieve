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
 * - 标注绝不改动页面内容显示：只有黄色描边、微弱底色和自绘徽章
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

        markArticle(article as HTMLElement, detection);
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

    function markArticle(article: HTMLElement, detection: NonNullable<ReturnType<typeof detect>>): void {
      article.setAttribute(MARK_ATTRIBUTE, detection.source);
      attachBadge(article, detection);
    }

    function attachBadge(
      article: HTMLElement,
      detection: NonNullable<ReturnType<typeof detect>>,
    ): void {
      if (article.querySelector('.fs-badge')) {
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
      input.checked = pendingCache.has(detection.handle);
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
      article.appendChild(badge);

      // X 可能整棵替换 article（re-render）；补挂缓存可能未及时刷新，
      // 新节点重新扫描时会再次走到这里，checked 状态以上方 pendingCache 为准。
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
    [${MARK_ATTRIBUTE}] {
      outline: 3px solid #f2c94c !important;
      outline-offset: 2px;
      border-radius: 16px;
      background-color: rgba(242, 201, 76, 0.06) !important;
    }
    .fs-badge {
      display: flex;
      gap: 12px;
      align-items: center;
      padding: 4px 10px;
      margin: 6px 16px;
      width: fit-content;
      border: 1px solid #f2c94c;
      border-radius: 8px;
      background: #fffbe6;
      color: #5c4d00;
      font-size: 13px;
      line-height: 1.4;
      z-index: 9;
    }
    .fs-reason { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 360px; }
    .fs-pick { display: flex; align-items: center; gap: 4px; white-space: nowrap; cursor: pointer; user-select: none; }
    .fs-pick input { accent-color: #d4a900; cursor: pointer; }
  `;
  document.documentElement.appendChild(style);
}
