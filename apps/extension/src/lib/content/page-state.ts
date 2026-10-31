/**
 * content script 的页面内显式状态对象（原 content.ts main() 闭包散状态的收敛）。
 *
 * - 检测材料缓存：bioCache（XHR 桥提供，DOM 拿不到简介）与 bio 变化待作废集合
 * - 保护/黑名单缓存：allowCache（一票否决）/ followingCache（关注保护）/
 *   blockedCache（已拉黑回显仍需标注）
 * - 页面黄框账本：pageMarked，会话内内存态：拉黑成功即移除，
 *   页面刷新后重新扫描重建（不需要跨页面持久化）
 * - 快照式设置：selfHandle / community / 检测开关 / 强度 / 语言 / 词库
 */

import type { MarkStrength } from '@feedsieve/community-lists';
import type { BlockEvidence } from '../detection/detection-pipeline';
import { BUNDLED_KEYWORD_PACK_CATALOG, type KeywordPackCatalog } from '../detection/keyword-packs';
import type { createKeywordHeuristics } from '../detection/keyword-rules';
import type { RuntimeCommunity } from '../community/community-store';
import type { UiLanguage } from '../platform/i18n';

/** 黄框标注在 DOM 上的锚点属性：cellInnerDiv 外层格子的标记 + CSS 选择器共用。 */
export const MARK_ATTRIBUTE = 'data-fs-marked';

/** 页面内一个黄框账号待处理时的标记数据（一键拉黑 = 页面全部黄框）。 */
export interface PageMarkedAccount {
  handle: string;
  xUserId?: string;
  category: string;
  /** 标注理由（popup 页面黄框清单展示用） */
  reason: string;
  /** 检测规则 ID：批量拉黑计票口径需要（communityVoteForDetection） */
  ruleId?: string;
  evidence: BlockEvidence;
  /** 推文原文本（供用户在清理面板快速浏览帖子正文、防误伤） */
  snippet?: string;
  /** 作者昵称 */
  displayName?: string;
}

/** bio 内存缓存上限（每页会话），防止超长会话无界增长。 */
const BIO_CACHE_MAX = 2000;

export interface ContentState {
  /** bio 变化待重新检测的 handle（XHR 桥每批收尾统一作废对应卡片） */
  dirtyHandles: Set<string>;
  /** 当前页面所有黄框账号（剔除已拉黑回显：它们已经在黑名单里） */
  pageMarked: Map<string, PageMarkedAccount>;
  /** handle -> bio（XHR 桥提供，检测用；DOM 拿不到简介） */
  bioCache: Map<string, string>;
  /** 白名单缓存：一票否决，最高优先级 */
  allowCache: Set<string>;
  /** 当前用户自己的关注保护：仅本地，永不上传社区。 */
  followingCache: Set<string>;
  /** 已拉黑名单缓存：X 偶尔仍会展示已拉黑账号（f=live 等），需要标注 */
  blockedCache: Set<string>;
  /** 当前登录用户自己的 handle（小写）：自己的帖子永不折叠也永不标注 */
  selfHandle: string | null;
  /** 社区最终名单运行时状态（快照同步后的索引） */
  community: RuntimeCommunity | null;
  /** 检测总开关；关闭后仍保留用户主动「拉黑」入口。 */
  detectionEnabled: boolean;
  /** 自动贡献总开关（决定「抢救」按钮是否出现） */
  autoContribute: boolean;
  strength: MarkStrength;
  uiLanguage: UiLanguage;
  /** 用户词与官方可配置词库：只给人工确认黄框，必须由用户点击才会拉黑。 */
  keywordHeuristics: ReturnType<typeof createKeywordHeuristics>;
  keywordCatalog: KeywordPackCatalog;
  /** 黄框集合变化后广播给扩展页；popup / 侧边栏开着时自动跟进，无需手动点刷新。 */
  notifyPageMarkedChanged(): void;
  /**
   * bio 写入缓存（含 BIO_CACHE_MAX 驱逐）；返回 true 表示相对缓存有变化，
   * 调用方需把该 handle 记入 dirtyHandles 作废对应卡片。
   */
  recordBio(handle: string, bio: string): boolean;
  /**
   * 对账清扫：凡是已进白名单（个人/关注保护）的账号，pageMarked 里不允许再留条目。
   * 兜底两类旧坑———
   * 1. 单账号 DOM 清理因「找不到该账号推文」（虚拟列表回收）空转后，条目再没人删；
   * 2. SPA 路由切换后 pageMarked 是会话级 Map，保护状态已变但旧条目无处被清。
   */
  pruneProtectedPageMarked(): void;
}

export function createContentState(): ContentState {
  /** pageMarked 变化通知的防抖句柄：一次批扫描只发一条消息。 */
  let notifyMarkedTimer: number | undefined;
  const pageMarked = new Map<string, PageMarkedAccount>();
  const bioCache = new Map<string, string>();
  const allowCache = new Set<string>();
  const followingCache = new Set<string>();
  /** 黄框集合变化后广播给扩展页；popup / 侧边栏开着时自动跟进，无需手动点刷新。 */
  const notifyPageMarkedChanged = (): void => {
    window.clearTimeout(notifyMarkedTimer);
    notifyMarkedTimer = window.setTimeout(() => {
      void browser.runtime
        .sendMessage({ type: 'feedsieve:page-marked-updated', count: pageMarked.size })
        .catch(() => {
          // 扩展页没开着是常态，静默
        });
    }, 100);
  };

  return {
    dirtyHandles: new Set<string>(),
    pageMarked,
    bioCache,
    allowCache,
    followingCache,
    blockedCache: new Set<string>(),
    selfHandle: null,
    community: null,
    detectionEnabled: true,
    autoContribute: true,
    strength: 'standard',
    uiLanguage: 'zh',
    keywordHeuristics: [],
    keywordCatalog: BUNDLED_KEYWORD_PACK_CATALOG,
    notifyPageMarkedChanged,
    recordBio(handle, bio) {
      if (bioCache.get(handle) === bio) return false;
      bioCache.set(handle, bio);
      if (bioCache.size > BIO_CACHE_MAX) {
        // 近似 LRU：Map 保插入序，挤掉最早入缓存的一条
        const oldest = bioCache.keys().next().value;
        if (oldest !== undefined) bioCache.delete(oldest);
      }
      return true;
    },
    pruneProtectedPageMarked() {
      let pruned = false;
      for (const handle of [...pageMarked.keys()]) {
        if (allowCache.has(handle) || followingCache.has(handle)) {
          pageMarked.delete(handle);
          pruned = true;
        }
      }
      if (pruned) notifyPageMarkedChanged();
    },
  };
}

/**
 * 原地替换 handle 缓存内容（保持 Set 引用不变），返回发生变化的 handle 集合
 * （新增 + 移除），供调用方只对变化账号做 DOM 对账。
 */
export function replaceHandleCache(
  cache: Set<string>,
  items: ReadonlyArray<{ handle: string }>,
): Set<string> {
  const next = new Set(items.map((item) => item.handle.toLowerCase()));
  const changed = new Set([...next].filter((handle) => !cache.has(handle)));
  for (const handle of cache) {
    if (!next.has(handle)) changed.add(handle);
  }
  cache.clear();
  for (const handle of next) cache.add(handle);
  return changed;
}
