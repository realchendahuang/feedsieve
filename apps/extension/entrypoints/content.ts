import { detect, toHandleSet } from '@feedsieve/detector';
import {
  contextFromPath,
  extractFeedItem,
  resolveUserIdByHandle,
  runNativeAction,
  tweetSelectors,
  type ParsedApiData,
} from '@feedsieve/x-adapter';
import { isPending, removePendingBlock, setPendingBlock } from '../src/lib/pending-blocks';
import { collectCellsByHandle, removeCellsSoon } from '../src/lib/remove-tweets';
import { runPendingBlockBatch } from '../src/lib/run-block-batch';
import { getUserId, saveUserIds } from '../src/lib/user-ids';
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
 * - XHR 桥（xhr-bridge.content.ts，MAIN world）通过 CustomEvent 送来
 *   GraphQL 权威数据：在这里缓存 rest_id（拉黑 API 必需）与 bio（检测增强）。
 */
export default defineContentScript({
  matches: ['https://x.com/*'],
  main() {
    const seenArticles = new WeakSet<Element>();
    const pendingCache = new Set<string>();
    /** handle -> bio（XHR 桥提供，检测用；DOM 拿不到简介） */
    const bioCache = new Map<string, string>();
    let scanTimer: number | undefined;

    ensureStyles();
    refreshPendingCache();
    listenXhrBridge();

    /**
     * popup「一键拉黑」入口：这里执行需要页面会话的原生拉黑，
     * 返回 Promise 作为 sendMessage 的响应（批量汇总见 run-block-batch.ts）。
     */
    browser.runtime.onMessage.addListener((message: unknown) => {
      if ((message as { type?: string } | null)?.type === 'feedsieve:run-block-batch') {
        return runPendingBlockBatch();
      }
      return undefined;
    });

    /** 消费 MAIN world XHR 桥的数据：rest_id 入库（LRU 上限内），bio 进内存缓存。 */
    function listenXhrBridge(): void {
      // 注意：桥 dispatch 在共享的 document 上；window 是各 world 独立的，监听 window 收不到
      document.addEventListener('feedsieve:xhr-items', (event) => {
        try {
          const parsed = JSON.parse(
            (event as CustomEvent<string>).detail,
          ) as ParsedApiData;
          if (!parsed?.tweets && !parsed?.listMembers) {
            return;
          }
          const idEntries: Array<{ handle: string; xUserId: string }> = [];
          for (const tweet of parsed.tweets ?? []) {
            if (tweet.author.xUserId) {
              idEntries.push({ handle: tweet.author.handle, xUserId: tweet.author.xUserId });
            }
            if (tweet.author.bio) {
              bioCache.set(tweet.author.handle, tweet.author.bio);
            }
          }
          for (const member of parsed.listMembers ?? []) {
            idEntries.push({ handle: member.handle, xUserId: member.xUserId });
          }
          if (idEntries.length > 0) {
            void saveUserIds(idEntries).catch(() => {
              // 存储失败不阻塞浏览；下次同账号出现会重试
            });
          }
        } catch {
          // detail 非法 JSON：静默
        }
      });
    }

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
          bio: bioCache.get(item.author.handle),
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
        void (async () => {
          const xUserId = await getUserId(detection.handle);
          await setPendingBlock(detection.handle, input.checked, detection.reason, xUserId);
        })().catch(() => {
          input.checked = !input.checked; // 写入失败回滚勾选态
        });
      });
      checkbox.appendChild(input);
      checkbox.appendChild(document.createTextNode('待拉黑'));

      const blockBtn = document.createElement('button');
      blockBtn.className = 'fs-block-now';
      blockBtn.type = 'button';
      blockBtn.textContent = '顺手拉黑';
      blockBtn.addEventListener('click', () => {
        void runBlockNow(detection.handle, blockBtn);
      });

      badge.append(label, checkbox, blockBtn);
      // cellInnerDiv 是普通块容器：徽章作为新块级子元素排在推文下方，
      // 处于文档流内但不进入 article 的 grid，不覆盖、不挤压任何 X 内容。
      cell.appendChild(badge);

      // X 可能整棵重渲染节点；异步对齐一次勾选态，防 pendingCache 未及时刷新
      void isPending(detection.handle).then((isOn) => {
        input.checked = isOn;
      });
    }

    /**
     * 顺手拉黑（Phase 2）：查缓存的 rest_id -> 调 X 网页端原拉黑端点。
     * 缓存 miss 不再让用户等刷新：按 UserByScreenName 当场解析（TBWL 同款），
     * 解析成功顺手回填缓存；只有解析也失败才如实提示。
     * 成功后：从待拉黑列表移除该账号，并把页面上该账号的推文移除
     * （对齐 X 原生拉黑行为，见 src/lib/remove-tweets.ts）。
     * 按钮文字实时反映状态，绝不假装成功。
     */
    async function runBlockNow(
      handle: string,
      button: HTMLButtonElement,
    ): Promise<void> {
      const original = button.textContent;
      button.disabled = true;
      try {
        button.textContent = '拉黑中…';
        let xUserId: string | undefined | null = await getUserId(handle);
        if (!xUserId) {
          xUserId = await resolveUserIdByHandle(handle);
          if (xUserId) {
            void saveUserIds([{ handle, xUserId }]).catch(() => {
              // 回填失败不影响本次拉黑
            });
          }
        }
        if (!xUserId) {
          button.textContent = '失败 无ID';
          console.warn(`[FeedSieve] resolve rest_id for @${handle} failed`);
          setTimeout(() => {
            button.textContent = original;
            button.disabled = false;
          }, 3000);
          return;
        }

        const result = await runNativeAction('block', xUserId);
        if (result.ok) {
          button.textContent = '已拉黑 ✓';
          // 已拉黑就不该再留在待拉黑列表里，否则批量执行会重复拉黑
          await removePendingBlock(handle);
          // 对齐 X 原生拉黑行为：确认成功后把该账号页面上可见的推文一并移除，
          // 让「已拉黑」立刻有可见效果，而不是等刷新
          removeCellsSoon(collectCellsByHandle(handle));
        } else {
          // 如实反馈失败原因（auth_required / rate_limited / network_error…）
          button.textContent = `失败 ${result.code}`;
          console.warn(`[FeedSieve] block @${handle} failed:`, result.code, result.message);
          setTimeout(() => {
            button.textContent = original;
            button.disabled = false;
          }, 3000);
        }
      } catch (error) {
        button.textContent = '失败 未知';
        console.error(`[FeedSieve] block @${handle} threw:`, error);
        setTimeout(() => {
          button.textContent = original;
          button.disabled = false;
        }, 3000);
      }
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
    /* 纯黄环标注：outline 不占布局空间（区别于 border），不挤压格子内容；
       outline-offset 让环浮在格子外缘，相邻两条标注的环之间自然留出缝隙，不再上下重叠。 */
    [${MARK_ATTRIBUTE}] {
      outline: 3px solid #f2c94c !important;
      outline-offset: -3px;
      border-radius: 16px;
    }
    /* 相邻都是标注格子时，压缩格子间分隔产生的重叠观感 */
    [${MARK_ATTRIBUTE}] + [${MARK_ATTRIBUTE}] {
      outline-offset: -6px;
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
    .fs-block-now {
      padding: 2px 10px;
      border: 1px solid #d4a900;
      border-radius: 999px;
      background: #f2c94c;
      color: #3d3200;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }
    .fs-block-now:hover:not(:disabled) { background: #ffd950; }
    .fs-block-now:disabled { opacity: 0.6; cursor: wait; }
  `;
  document.documentElement.appendChild(style);
}
