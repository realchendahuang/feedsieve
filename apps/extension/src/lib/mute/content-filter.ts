/**
 * 推文屏蔽词的页面折叠（隔离世界）。
 *
 * 命中后把时间线 cell 折叠成一条说明条，而不是直接删除节点：
 * - 不改变 X 虚拟列表的高度锚点，避免滚动跳；
 * - 用户能看到「按哪个词屏蔽」，点「显示」立即恢复；
 * - 详情页正在阅读的主帖不折叠，只折叠下面的回复；
 * - 引用帖正文不进 item.text，所以不会因为别人引用而误伤。
 */
import type { FeedItem } from '@feedsieve/x-adapter';
import { tweetSelectors } from '@feedsieve/x-adapter';
import { createHovercard } from '../insight/hovercard';
import type { UiLanguage } from '../platform/i18n';
import { compileMuteRules, matchMuteRules, type CompiledMuteRule } from './matcher';
import type { MuteSettings } from './mute-store';

export const MUTE_FOLD_ATTRIBUTE = 'data-fs-mute-fold';
const MUTE_RULE_ATTRIBUTE = 'data-fs-mute-rule';
const BAR_CLASS = 'fs-mute-foldbar';
const HELP_CLASS = 'fs-mute-help';
const HELP_TIP = 'data-fs-mute-tip';

const COPY = {
  zh: {
    title: '福滤娃 · 屏蔽关键词',
    blocked: (phrase: string) => `已屏蔽：包含「${phrase}」`,
    show: '显示',
    help: '这是福滤娃的推文屏蔽词：命中后只折叠这条推文，不会拉黑账号，也不会上传正文。可在「屏蔽」页关闭或删除这个词。',
    footer: '福滤娃功能 · 可在「屏蔽」页关闭',
  },
  en: {
    title: 'FeedSieve · Muted keywords',
    blocked: (phrase: string) => `Muted: contains “${phrase}”`,
    show: 'Show',
    help: 'This is a FeedSieve keyword mute: it folds the post in place, does not block the account, and uploads nothing. Turn it off or remove the word in the Mute tab.',
    footer: 'FeedSieve feature · turn it off in the Mute tab',
  },
} as const;

function focalPostId(): string | null {
  return location.pathname.match(/\/status\/(\d+)/)?.[1] ?? null;
}

export interface KeywordFilter {
  /** 扫描单条推文；命中则折叠，未命中则清掉旧折叠。 */
  apply(article: Element, item: FeedItem): boolean;
  /** 返回影响匹配的规则集是否变化；仅状态（同步中/已同步）变化时返回 false。 */
  setSettings(settings: MuteSettings): boolean;
  clearAll(): void;
}

export function createKeywordFilter(deps: {
  getLanguage: () => UiLanguage;
  getSelfHandle: () => string | null;
  /** 用户点「显示」后让扫描器重新处理这条，补上流速/黄框等装饰。 */
  onUnfold?: (cell: Element) => void;
}): KeywordFilter {
  let settings: MuteSettings = { enabled: false, nativeSync: false, rules: [] };
  let compiled: CompiledMuteRule[] = [];
  let ruleSignature = '';
  const unfolded = new Set<string>();
  const unfoldedArticles = new WeakSet<Element>();

  const copy = () => COPY[deps.getLanguage() === 'en' ? 'en' : 'zh'];

  const tips = createHovercard({
    resolve: (target) => {
      const anchor = target.closest<HTMLElement>(`[${HELP_TIP}]`);
      if (!anchor) return null;
      return {
        anchor,
        content: {
          title: copy().title,
          rows: [],
          notes: [copy().help],
          footer: copy().footer,
        },
      };
    },
  });
  tips.listen();

  function removeFold(cell: Element): void {
    cell.removeAttribute(MUTE_FOLD_ATTRIBUTE);
    cell.removeAttribute(MUTE_RULE_ATTRIBUTE);
    cell.querySelectorAll(`:scope > .${BAR_CLASS}`).forEach((bar) => bar.remove());
  }

  function buildBar(rule: CompiledMuteRule, cell: Element, item: FeedItem): HTMLElement {
    const bar = document.createElement('div');
    bar.className = BAR_CLASS;
    const text = document.createElement('span');
    text.className = 'fs-mute-fold-text';
    text.textContent = copy().blocked(rule.phrase);
    text.title = rule.phrase;
    const show = document.createElement('button');
    show.type = 'button';
    show.className = 'fs-mute-fold-show';
    show.textContent = copy().show;
    show.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (item.postId) unfolded.add(item.postId);
      else unfoldedArticles.add(cell);
      removeFold(cell);
      deps.onUnfold?.(cell);
    });
    const help = document.createElement('span');
    help.className = HELP_CLASS;
    help.textContent = '?';
    help.tabIndex = 0;
    help.setAttribute('role', 'img');
    help.setAttribute('aria-label', copy().help);
    help.setAttribute(HELP_TIP, '1');
    bar.append(text, show, help);
    return bar;
  }

  function apply(article: Element, item: FeedItem): boolean {
    const cell = article.closest(tweetSelectors.timelineCell) ?? article;
    const self = deps.getSelfHandle();
    if (
      !settings.enabled ||
      compiled.length === 0 ||
      !item.text ||
      item.postId === focalPostId() ||
      (self !== null && item.author.handle.toLowerCase() === self.toLowerCase()) ||
      (item.postId ? unfolded.has(item.postId) : unfoldedArticles.has(cell))
    ) {
      removeFold(cell);
      return false;
    }
    const match = matchMuteRules(compiled, item.text);
    if (!match) {
      removeFold(cell);
      return false;
    }
    if (
      cell.getAttribute(MUTE_FOLD_ATTRIBUTE) === '1' &&
      cell.getAttribute(MUTE_RULE_ATTRIBUTE) === match.id
    ) {
      return true;
    }
    removeFold(cell);
    cell.prepend(buildBar(match, cell, item));
    cell.setAttribute(MUTE_FOLD_ATTRIBUTE, '1');
    cell.setAttribute(MUTE_RULE_ATTRIBUTE, match.id);
    return true;
  }

  function setSettings(next: MuteSettings): boolean {
    settings = next;
    const signature = next.enabled
      ? next.rules
          .filter((rule) => rule.enabled)
          .map((rule) => `${rule.id}\u0000${rule.phrase}`)
          .join('\u0001')
      : '';
    if (signature === ruleSignature) return false;
    ruleSignature = signature;
    compiled = next.enabled ? compileMuteRules(next.rules) : [];
    unfolded.clear();
    return true;
  }

  function clearAll(): void {
    for (const cell of document.querySelectorAll(`[${MUTE_FOLD_ATTRIBUTE}]`)) {
      removeFold(cell);
    }
    for (const bar of document.querySelectorAll(`.${BAR_CLASS}`)) {
      bar.remove();
    }
  }

  return { apply, setSettings, clearAll };
}
