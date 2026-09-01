import {
  contentFingerprint,
  createRepetitionTracker,
  detect,
  toHandleSet,
} from '@feedsieve/detector';
import {
  contextFromPath,
  extractFeedItem,
  resolveUserIdByHandle,
  runNativeAction,
  tweetSelectors,
  type ParsedApiData,
} from '@feedsieve/x-adapter';
import { getBlockedAccounts, markBlocked, subscribeBlocked } from '../src/lib/blocked-accounts';
import { bumpStat } from '../src/lib/local-stats';
import { bumpDaily } from '../src/lib/daily-stats';
import { collectCellsByHandle, removeCellsSoon } from '../src/lib/remove-tweets';
import { runUnblockBatch } from '../src/lib/run-unblock-batch';
import { getUserId, saveUserIds } from '../src/lib/user-ids';
import {
  buildRuntimeCommunity,
  subscribeCommunity,
  type RuntimeCommunity,
} from '../src/lib/community-store';
import { addAllowlist, getAllowlist, subscribeAllowlist } from '../src/lib/allowlist';
import {
  categoryFromDetection,
  collectLinkDomains,
  contributeBlocks,
  rescueHandle,
  syncLocalLabels,
} from '../src/lib/contribute';
import { getCommunitySettings } from '../src/lib/community-store';
import builtinListJson from '../../../community/lists/recommended.json';

/**
 * 内置名单（构建期打包，entries 目前为空）：离线兜底。
 * 社区名单走运行时同步（background SW -> storage.local -> 这里建索引），
 * 服务器快照永远是权威来源。
 */
const BUILTIN_LIST = toHandleSet((builtinListJson as { entries: unknown }).entries as never[]);

const MARK_ATTRIBUTE = 'data-fs-marked';
const STYLE_ELEMENT_ID = 'feedsieve-mark-styles';

/** 标注时刻收集的内容证据（上报载荷，见 contribute.ts） */
interface BlockEvidence {
  contentFingerprint?: string;
  linkDomains?: string[];
}

/** 页面内一个黄框账号待处理时的标记数据（一键拉黑 = 页面全部黄框）。 */
interface PageMarkedAccount {
  handle: string;
  category: string;
  /** 标注理由（popup 页面黄框清单展示用） */
  reason: string;
  evidence: BlockEvidence;
}

/**
 * Phase 1 content script：黄框标注（带理由）。一键拉黑 = 当前页面全部黄框账号。
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
 * - 页面黄框集合 pageMarked 是会话内内存态：拉黑成功即移除，
 *   页面刷新后重新扫描重建（不需要跨页面持久化）。
 */
export default defineContentScript({
  matches: ['https://x.com/*'],
  main() {
    const seenArticles = new WeakSet<Element>();
    /** 当前页面所有黄框账号（剔除已拉黑回显：它们已经在黑名单里） */
    const pageMarked = new Map<string, PageMarkedAccount>();
    /** handle -> bio（XHR 桥提供，检测用；DOM 拿不到简介） */
    const bioCache = new Map<string, string>();
    /** 白名单缓存：一票否决，最高优先级 */
    const allowCache = new Set<string>();
    /** 已拉黑名单缓存：X 偶尔仍会展示已拉黑账号（f=live 等），需要标注 */
    const blockedCache = new Set<string>();
    /** 社区名单运行时状态（快照同步 + 强度过滤后的索引） */
    let community: RuntimeCommunity | null = null;
    /** 自动贡献总开关（决定「抢救」按钮是否出现） */
    let autoContribute = true;
    /**
     * 「大扫除」档开关：本地复读标注（v0.4）只在档案启用。
     * 社区指纹/域名的档位门槛收口在 buildRuntimeCommunity，这里无需重复判断。
     */
    let deepClean = false;
    /** 本地复读追踪（会话内存，不持久不上传）：同一模板文本 >=3 次 → 黄框 */
    const repetition = createRepetitionTracker();
    let scanTimer: number | undefined;

    ensureStyles();
    refreshAllowCache();
    refreshBlockedCache();
    void refreshCommunity();
    listenXhrBridge();
    // 请 background SW 同步快照（SW 侧 6h 节流；发消息顺便唤醒 SW）
    void browser.runtime.sendMessage({ type: 'feedsieve:community-sync' }).catch(() => {
      // SW 暂不可达（开发热重载等）：下次页面加载再试
    });

    /**
     * popup「一键拉黑 / 一键撤销」入口：这里执行需要页面会话的原生操作，
     * 返回 Promise 作为 sendMessage 的响应（批量汇总见 run-block/run-unblock-batch.ts）。
     */
    browser.runtime.onMessage.addListener((message: unknown) => {
      const type = (message as { type?: string } | null)?.type;
      // 一键拉黑 = 当前页面全部黄框账号（用户拍板的交互语义）
      if (type === 'feedsieve:run-page-block') {
        return runPageBlockBatch();
      }
      if (type === 'feedsieve:unblock') {
        return runUnblockBatch((message as { handle?: string }).handle).then((result) => {
          void syncLocalLabels();
          return result;
        });
      }
      return undefined;
    });

    /** popup「一键拉黑」需要的页面黄框快照（发往活动 tab 实时查询）。 */
    browser.runtime.onMessage.addListener((message: unknown) => {
      const type = (message as { type?: string } | null)?.type;
      if (type === 'feedsieve:page-marked-list') {
        // 必须 Promise：Chrome 原生 onMessage 只认 true / Promise 作为异步响应，
        // 同步返回数组会被忽略，popup 收到 undefined（v0.7.0 真机回归捕获）
        return Promise.resolve(
          [...pageMarked.values()].map((m) => ({
            handle: m.handle,
            category: m.category,
            reason: m.reason,
          })),
        );
      }
      return undefined;
    });

    /** 消费 MAIN world XHR 桥的数据：rest_id 入库（LRU 上限内），bio 进内存缓存。 */
    function listenXhrBridge(): void {
      // 注意：桥 dispatch 在共享的 document 上；window 是各 world 独立的，监听 window 收不到
      document.addEventListener('feedsieve:xhr-items', (event) => {
        try {
          const parsed = JSON.parse((event as CustomEvent<string>).detail) as ParsedApiData;
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

    function refreshBlockedCache(): void {
      const apply = (items: Array<{ handle: string }>): void => {
        blockedCache.clear();
        for (const item of items) {
          blockedCache.add(item.handle);
        }
      };
      void getBlockedAccounts()
        .then(apply)
        .catch(() => {
          // storage 异常保持旧缓存
        });
      subscribeBlocked(apply);
    }

    // 快照/设置变化（同步、换强度档）实时生效到下一次扫描；只订阅一次
    subscribeCommunity(() => {
      void refreshCommunity().catch(() => {
        // 刷新失败保持旧索引
      });
    });

    function refreshAllowCache(): void {
      const apply = (items: Array<{ handle: string }>): void => {
        allowCache.clear();
        for (const item of items) {
          allowCache.add(item.handle);
        }
      };
      void getAllowlist()
        .then(apply)
        .catch(() => {
          // storage 异常保持旧缓存
        });
      // 初始订阅：后续白名单变化实时生效（订阅保持到页面卸载）
      subscribeAllowlist(apply);
    }

    async function refreshCommunity(): Promise<void> {
      community = await buildRuntimeCommunity();
      const settings = await getCommunitySettings();
      autoContribute = settings.autoContribute;
      // 复读标注跟随社区设置：总开关关掉时一并关闭
      deepClean = settings.enabled && settings.strength === 'deep_clean';
    }

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

        const input = {
          handle: item.author.handle,
          displayName: item.author.displayName,
          text: item.text,
          bio: bioCache.get(item.author.handle),
          links: item.links,
        };

        // v0.4 内容证据：指纹每条推文只 track 一次（复读判定），
        // 域名收集一次（上报载荷）。证据与是否标注无关，命中与否都带着走。
        const evidence: BlockEvidence = {};
        const fp = contentFingerprint(input);
        if (fp) {
          evidence.contentFingerprint = fp;
        }
        const linkDomains = collectLinkDomains(item.links);
        if (linkDomains) {
          evidence.linkDomains = linkDomains;
        }
        const isRepeat = fp ? repetition.track(fp, item.author.handle.toLowerCase()) : false;

        // 识别顺序：社区快照名单 -> 内置名单兜底 -> 启发式
        // 社区指纹/域名集合由 buildRuntimeCommunity 按强度档准备（大扫除档才有内容）
        const evidenceOptions = {
          ...(community?.fingerprintSet.size ? { fingerprints: community.fingerprintSet } : {}),
          ...(community?.domainSet.size ? { domains: community.domainSet } : {}),
        };
        let detection = community
          ? detect(input, {
              list: community.handleSet,
              listSource: 'community-list',
              // v0.5 指纹即 SimHash：simhashes 集合与 fingerprints 集合同源，
              // exact 命中优先，miss 后走汉明距离找「话术变体」
              ...(community.fingerprintSet.size ? { simhashes: community.fingerprintSet } : {}),
              ...evidenceOptions,
            })
          : null;
        if (!detection && BUILTIN_LIST.size > 0) {
          detection = detect(input, {
            list: BUILTIN_LIST,
            listSource: 'builtin-list',
            ...evidenceOptions,
          });
        }
        if (!detection) {
          detection = detect(input, evidenceOptions);
        }

        // 本地复读（大扫除档）：换号复读同一段模板、正则又没覆盖时仍能标注。
        // 纯会话内存，不持久、不上传。
        if (!detection && deepClean && isRepeat) {
          detection = {
            handle: item.author.handle.toLowerCase(),
            marked: true,
            source: 'fingerprint',
            reason: '模板复读 · 同一文本多次出现',
            ruleId: 'local-repeat',
          };
        }

        // 已拉黑账号仍出现（X 服务端行为，f=live 常见）：如实标注，交给用户处置
        if (!detection && blockedCache.has(item.author.handle.toLowerCase())) {
          detection = {
            handle: item.author.handle.toLowerCase(),
            marked: true,
            source: 'blocked',
            reason: '已拉黑账号 · X 仍展示',
            ruleId: 'blocked',
          };
        }
        if (!detection) {
          continue;
        }

        // 白名单一票否决（误杀治理）：命中即洗白，绝不标注
        if (allowCache.has(item.author.handle.toLowerCase())) {
          continue;
        }

        // 社区名单命中：徽章带分类与票数，可解释性优先
        let communityCategory: string | undefined;
        if (detection.source === 'community-list' && community) {
          const entry = community.index.lookup(item.author.handle);
          if (entry) {
            communityCategory = entry.category;
            const rescueSuffix = entry.rescue_count > 0 ? ` · ${entry.rescue_count} 抢救` : '';
            detection = {
              ...detection,
              reason: `社区名单：${entry.category} · ${entry.report_count} 举报${rescueSuffix}`,
            };
          }
        }

        // v0.5 Campaign：指纹命中（exact 或变体）时，
        // 反查所在簇的规模，徽章显示「同模板 N 个账号」（网络感，不只单点）
        if (detection.source === 'fingerprint' && community) {
          const campaignHandle = detection.matchedFingerprint
            ? community.campaignByFingerprint.get(detection.matchedFingerprint)
            : undefined;
          const campaign = campaignHandle ? community.campaignById.get(campaignHandle) : undefined;
          if (campaign) {
            detection = {
              ...detection,
              campaignEntryId: campaign.campaign_entry_id,
              reason: `${detection.reason} · 同模板 ${campaign.campaign_size} 个账号`,
            };
          }
        }

        // 标注打在外层时间线格子上（PureTwitter 同款目标层）；找不到才退回 article
        const cell = article.closest(tweetSelectors.timelineCell) ?? article;
        const category = categoryFromDetection(
          detection.source,
          detection.ruleId,
          communityCategory,
        );
        markCell(cell as HTMLElement, detection, category, evidence);
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
      category: string,
      evidence: BlockEvidence,
    ): void {
      cell.setAttribute(MARK_ATTRIBUTE, detection.source);
      attachBadge(cell, detection, category, evidence);
      // 页面黄框集合：一键拉黑的数据源。已拉黑回显不在黑名单动作范围，跳过。
      if (detection.source !== 'blocked') {
        pageMarked.set(detection.handle, {
          handle: detection.handle,
          category,
          reason: detection.reason,
          evidence,
        });
      }
      // 本地统计：每次新标注 +1（seenArticles 保证每个 cell 只标一次）；
      // 已拉黑回显不是新发现，不计数
      if (detection.source !== 'blocked') {
        void bumpStat('detected').catch(() => {
          // 统计写入失败不影响标注
        });
      }
    }

    function attachBadge(
      cell: HTMLElement,
      detection: NonNullable<ReturnType<typeof detect>>,
      category: string,
      evidence: BlockEvidence,
    ): void {
      if (cell.querySelector('.fs-badge')) {
        return;
      }

      const badge = document.createElement('div');
      badge.className = 'fs-badge';

      const label = document.createElement('span');
      label.className = 'fs-reason';
      label.textContent = detection.reason;
      label.title = `来源：${detection.source} · 规则：${detection.ruleId ?? '-'}`;

      // 已拉黑回显：账号已经在黑名单里，重复的拉黑按钮没有意义，
      // 给「移除推文」对齐 X 原生行为
      if (detection.source === 'blocked') {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'fs-block-now';
        removeBtn.type = 'button';
        removeBtn.textContent = '移除推文';
        removeBtn.addEventListener('click', () => {
          removeBtn.disabled = true;
          removeBtn.textContent = '移除中…';
          removeCellsSoon([cell]);
        });
        badge.append(label, removeBtn);
        cell.appendChild(badge);
        return;
      }

      // 主操作组：顺手拉黑（高频，视觉突出）。
      // 批量操作不再走勾选：popup「一键拉黑」= 页面全部黄框账号。
      const primaryGroup = document.createElement('span');
      primaryGroup.className = 'fs-actions';

      const blockBtn = document.createElement('button');
      blockBtn.className = 'fs-block-now';
      blockBtn.type = 'button';
      blockBtn.textContent = '顺手拉黑';
      blockBtn.addEventListener('click', () => {
        void runBlockNow(detection.handle, blockBtn, category, evidence);
      });
      primaryGroup.append(blockBtn);

      // 次操作组：抢救 / 误标？（低频治理，弱化样式）
      const secondaryGroup = document.createElement('span');
      secondaryGroup.className = 'fs-actions fs-actions-soft';

      const allowBtn = document.createElement('button');
      allowBtn.className = 'fs-allow';
      allowBtn.type = 'button';
      allowBtn.textContent = '误标？';
      allowBtn.title = '加入个人白名单，并提交这条规则的误标反馈';
      allowBtn.addEventListener('click', () => {
        void (async () => {
          const feedback = {
            detectionSource: detection.source,
            ...(detection.ruleId ? { ruleId: detection.ruleId } : {}),
            detectionReason: detection.reason,
          };
          const xUserId = (await getUserId(detection.handle)) ?? undefined;
          await addAllowlist(detection.handle, xUserId, feedback);
          cell.removeAttribute(MARK_ATTRIBUTE);
          badge.remove();
          // 本地白名单立即生效；同步器会补传失败记录和历史名单。
          void syncLocalLabels();
        })().catch(() => {
          // 白名单写入失败：标注保持原状
        });
      });

      // 抢救：只对社区名单命中的条目出现（显式投票，名单不是永久刑罚）
      const rescueBtn =
        detection.source === 'community-list' && autoContribute
          ? (() => {
              const btn = document.createElement('button');
              btn.className = 'fs-allow';
              btn.type = 'button';
              btn.textContent = '抢救';
              btn.title = '向社区投票：这个标注可能误伤了';
              btn.addEventListener('click', () => {
                void (async () => {
                  btn.disabled = true;
                  btn.textContent = '…';
                  const ok = await rescueHandle(
                    detection.handle,
                    {
                      detectionSource: detection.source,
                      ...(detection.ruleId ? { ruleId: detection.ruleId } : {}),
                      detectionReason: detection.reason,
                    },
                    (await getUserId(detection.handle)) ?? undefined,
                  );
                  if (ok) {
                    btn.textContent = '已抢救 ✓';
                    setTimeout(() => {
                      btn.remove();
                    }, 2000);
                  } else {
                    btn.textContent = '失败';
                    setTimeout(() => {
                      btn.disabled = false;
                      btn.textContent = '抢救';
                    }, 3000);
                  }
                })();
              });
              return btn;
            })()
          : null;

      secondaryGroup.append(...(rescueBtn ? [rescueBtn] : []), allowBtn);

      badge.append(label, primaryGroup, secondaryGroup);
      // cellInnerDiv 是普通块容器：徽章作为新块级子元素排在推文下方，
      // 处于文档流内但不进入 article 的 grid，不覆盖、不挤压任何 X 内容。
      cell.appendChild(badge);
    }

    /**
     * 一键拉黑（popup 入口）：当前页面全部黄框账号批量拉黑。
     * 逐个执行，成功即从 pageMarked 移除并把推文移除；失败如实保留，
     * 汇总回报 popup（与「顺手拉黑」共用 blockOne 原生产链路）。
     */
    async function runPageBlockBatch(): Promise<{
      blocked: string[];
      failed: Array<{ handle: string; code: string }>;
    }> {
      const targets = [...pageMarked.values()];
      const blocked: string[] = [];
      const failed: Array<{ handle: string; code: string }> = [];
      for (const item of targets) {
        const outcome = await blockOne(item);
        if (outcome.ok) {
          blocked.push(item.handle);
          pageMarked.delete(item.handle);
          // 对齐 X 原生拉黑行为：该账号页面上可见的推文一并移除
          removeCellsSoon(collectCellsByHandle(item.handle));
        } else {
          failed.push({ handle: item.handle, code: outcome.code });
        }
        await sleep(PACE_MS);
      }
      return { blocked, failed };
    }

    /**
     * 单账号完整拉黑链路（顺手拉黑 / 一键拉黑共用）。
     * 不抛异常，一切失败转成结构化结果；成功后记账 + 统计 + 贡献上报。
     */
    async function blockOne(
      item: PageMarkedAccount,
    ): Promise<{ ok: true } | { ok: false; code: string }> {
      let xUserId: string | undefined | null = await getUserId(item.handle);
      if (!xUserId) {
        xUserId = await resolveUserIdByHandle(item.handle);
        if (xUserId) {
          void saveUserIds([{ handle: item.handle, xUserId }]).catch(() => {
            // 回填失败不影响本次拉黑
          });
        }
      }
      if (!xUserId) {
        return { ok: false, code: 'no-id' };
      }

      const result = await runNativeAction('block', xUserId);
      if (!result.ok) {
        return { ok: false, code: result.code };
      }
      // 记账（撤销入口的数据源）+ 本地统计
      await markBlocked(item.handle, xUserId, {
        category: item.category,
        ...item.evidence,
      });
      await bumpStat('blocked');
      // v0.6 战报：今日拉黑 + 分类计数
      await bumpDaily('blocked', item.category);
      // 摩擦设计：拉黑成功即自动贡献社区（无弹窗；全局开关在 contributeBlocks 内判断）
      contributeBlocks([
        { handle: item.handle, xUserId, category: item.category, ...item.evidence },
      ]);
      return { ok: true };
    }

    /**
     * 顺手拉黑（Phase 2）：查缓存的 rest_id -> 调 X 网页端原拉黑端点。
     * 缓存 miss 不再让用户等刷新：按 UserByScreenName 当场解析（TBWL 同款），
     * 解析成功顺手回填缓存；只有解析也失败才如实提示。
     * 成功后：把该账号从 pageMarked 移除，并把页面上该账号的推文移除
     * （对齐 X 原生拉黑行为，见 src/lib/remove-tweets.ts）。
     * 按钮文字实时反映状态，绝不假装成功。
     */
    async function runBlockNow(
      handle: string,
      button: HTMLButtonElement,
      category: string,
      evidence: BlockEvidence,
    ): Promise<void> {
      const original = button.textContent;
      button.disabled = true;
      try {
        button.textContent = '拉黑中…';
        const outcome = await blockOne({
          handle,
          category,
          reason: '',
          evidence,
        });
        if (outcome.ok) {
          button.textContent = '已拉黑 ✓';
          pageMarked.delete(handle);
          removeCellsSoon(collectCellsByHandle(handle));
        } else {
          // 如实反馈失败原因（auth_required / rate_limited / network_error…）
          button.textContent = `失败 ${outcome.code}`;
          console.warn(`[FeedSieve] block @${handle} failed:`, outcome.code);
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

/** 相邻两次拉黑请求的间隔（毫秒），与批量执行一致。 */
const PACE_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  // 设计令牌与 popup.css 同名同值（isolated world 无法共享文件，改主题两处同步）
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
    /* 主操作组：勾选 + 顺手拉黑（高频，视觉突出） */
    .fs-actions { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
    /* 次操作组：抢救 / 误标？（低频治理，弱化） */
    .fs-actions-soft { gap: 4px; }
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
    .fs-allow {
      padding: 2px 8px;
      border: 1px solid #d9d9d9;
      border-radius: 999px;
      background: #fff;
      color: #999;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    }
    .fs-allow:hover { border-color: #b3b3b3; color: #666; }
  `;
  document.documentElement.appendChild(style);
}
