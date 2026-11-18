import type { UiLanguage } from '../platform/i18n';

export const SEARCH_ASSIST_TRIGGER_CLASS = 'fs-search-trigger';
export const SEARCH_ASSIST_BACKDROP_CLASS = 'fs-adv-backdrop';

export const SEARCH_ASSIST_SHARED_COPY = {
  zh: {
    trigger: '高级搜索',
    helpTitle: '福滤娃 · 高级搜索',
    toggleFooter: '福滤娃功能 · 可在 设置 › 主页 › 搜索框高级搜索 关闭',
    triggerHelp:
      '把 X 的搜索运算符做成表单：搜索词、博主、时间、互动、筛选、位置都能单独填，也可以写自定义运算符。',
  },
  en: {
    trigger: 'Advanced search',
    helpTitle: 'FeedSieve · Advanced search',
    toggleFooter:
      'A FeedSieve feature · turn it off in Settings › Profile › Advanced search under the search box',
    triggerHelp:
      'Turns X search operators into a form with separate fields for keywords, people, dates, engagement, filters and location, plus custom operators.',
  },
} as const satisfies Record<
  UiLanguage,
  { trigger: string; helpTitle: string; toggleFooter: string; triggerHelp: string }
>;
