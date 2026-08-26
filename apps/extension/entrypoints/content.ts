import { detectByHandleList } from '@feedsieve/detector';
import { extractHandleFromPath, tweetSelectors } from '@feedsieve/x-adapter';

/**
 * Phase 0 冒烟名单：仅用于验证「DOM -> Reader -> Detector」管线连通。
 * Phase 1 将替换为内置的 community/lists/recommended.json 快照 + 启发式规则。
 */
const SMOKE_LIST = new Set(['feedsieve_smoke_spam']);

/**
 * Phase 0 content script：只观察、只打日志、零页面改动。
 *
 * - ISOLATED world 运行（冻结决策，见 TECHNICAL_SPEC.md §3.1）
 * - 黄框标注 UI 属于 Phase 1，这里先验证注入与识别管线
 * - MutationObserver 只发现候选节点，debounce 后批量扫描
 */
export default defineContentScript({
  matches: ['https://x.com/*'],
  main() {
    const seenArticles = new WeakSet<Element>();
    let scanTimer: number | undefined;

    function scan(): void {
      for (const article of document.querySelectorAll(tweetSelectors.article)) {
        if (seenArticles.has(article)) {
          continue;
        }
        seenArticles.add(article);

        const authorLink = article.querySelector<HTMLAnchorElement>(
          `${tweetSelectors.authorNameArea} a[href^="/"]`,
        );
        const handle = authorLink
          ? extractHandleFromPath(authorLink.pathname)
          : null;
        if (!handle) {
          continue;
        }

        const detection = detectByHandleList(handle, SMOKE_LIST);
        if (detection) {
          console.info(
            `[FeedSieve] marked @${detection.handle}: ${detection.reason} (${detection.source})`,
          );
        }
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

    scheduleScan();
    console.info('[FeedSieve] content script active');
  },
});
