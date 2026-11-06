/**
 * X 搜索框的高级搜索弹窗（内容脚本）。
 *
 * 入口是搜索胶囊右侧的小按钮；点开是一个完整的 X 高级搜索表单：
 * 搜索词、博主、时间、互动、筛选、位置都拆成独立字段，生成标准 X 运算符。
 * 每个分组和入口都有小问号，悬停说明这是福滤娃的功能、以及在哪关闭。
 *
 * 布局注意：X 的搜索框在一个 `position: fixed`、`align-items: center` 的容器里，
 * 往里面加普通文档流元素会把整条搜索栏顶出视口。入口按钮塞进胶囊内部让 input
 * 自然让位；弹窗挂在 body 上、居中显示，不参与 X 的布局。
 *
 * 约束：
 * - 只加 UI 和跳转，不自动翻页、不替用户发请求（和服务端/风控约束一致）。
 * - 默认开启；设置 › 主页 › 搜索框高级搜索 可关闭。
 * - X 会重渲染侧栏，由页面巡检（page-ticker）每秒检查入口并在丢失时补回。
 * - 所有文本走 textContent，不改 X 的 article，也不改搜索框自身的事件。
 */
import { createHovercard } from '../insight/hovercard';
import {
  buildAdvancedQuery,
  googleSearchUrl,
  handleFromLocation,
  xSearchUrl,
  type DistanceUnit,
  type RepliesMode,
  type SearchContent,
  type SearchSort,
} from '../search/advanced';
import type { UiLanguage } from '../platform/i18n';
import {
  DEFAULT_SEARCH_ASSIST_PREFS,
  getSearchAssistPrefs,
  setSearchAssistPrefs,
  type SearchAssistPrefs,
} from '../settings/search-assist';

export const SEARCH_ASSIST_TRIGGER_CLASS = 'fs-search-trigger';
export const SEARCH_ASSIST_BACKDROP_CLASS = 'fs-adv-backdrop';

const SEARCH_FORM_SELECTORS = [
  '[data-testid="sidebarColumn"] form[role="search"]',
  'form[role="search"]',
] as const;

const SEARCH_LABEL_SELECTOR = '[data-testid="SearchBox_Search_Input_label"]';

const SAVE_DEBOUNCE_MS = 600;

const LANGS: ReadonlyArray<readonly [string, string]> = [
  ['', '不限'],
  ['zh', '中文'],
  ['en', '英文'],
  ['ja', '日语'],
  ['ko', '韩语'],
  ['es', '西班牙语'],
  ['fr', '法语'],
  ['de', '德语'],
  ['pt', '葡萄牙语'],
  ['ru', '俄语'],
  ['ar', '阿拉伯语'],
  ['hi', '印地语'],
];

const LANGS_EN: ReadonlyArray<readonly [string, string]> = [
  ['', 'Any'],
  ['zh', 'Chinese'],
  ['en', 'English'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['pt', 'Portuguese'],
  ['ru', 'Russian'],
  ['ar', 'Arabic'],
  ['hi', 'Hindi'],
];

const COPY = {
  zh: {
    title: '高级搜索',
    trigger: '高级搜索',
    helpTitle: '福滤娃 · 高级搜索',
    toggleFooter: '福滤娃功能 · 可在 设置 › 主页 › 搜索框高级搜索 关闭',
    triggerHelp:
      '把 X 的搜索运算符做成表单：搜索词、博主、时间、互动、筛选、位置都能单独填，也可以写自定义运算符。',
    sections: {
      words: {
        title: '搜索词',
        help: '全部词用空格分隔；精确短语会自动加引号；任意词生成 (a OR b)；排除词每个前面加 -；标签自动补 #。',
      },
      people: {
        title: '博主',
        help: '对应 from:、to: 和 @提到。来自博主就是只看这个人发的；在个人主页打开时会自动带入当前博主，留空表示不限。',
      },
      dates: {
        title: '时间',
        help: '对应 since: 和 until:，只精确到日期。',
      },
      engagement: {
        title: '互动',
        help: '对应 min_replies:、min_retweets:、min_faves:；填 0 或不填表示不限。',
      },
      filters: {
        title: '筛选',
        help: '对应 filter: 系列：图片、视频、原生视频、媒体、链接、引用；还能排除回复、排除转推、只看认证账号。',
      },
      location: {
        title: '位置',
        help: '对应 near: 和 within:；地名带空格会自动加引号。',
      },
      more: {
        title: '更多',
        help: '没有做控件的运算符（如 list:、conversation_id:、url:）可以直接写在这里，原样拼进查询。',
      },
    },
    fields: {
      allWords: '包含全部词',
      exactPhrase: '精确短语',
      anyWords: '任意词',
      noneWords: '排除词',
      hashtags: '话题标签',
      language: '语言',
      from: '来自博主',
      to: '发给博主',
      mention: '提到博主',
      since: '起始日期',
      until: '结束日期',
      minReplies: '最低回复',
      minRetweets: '最低转发',
      minLikes: '最低点赞',
      content: '内容类型',
      replies: '回复',
      excludeRetweets: '排除转推',
      verifiedOnly: '只看认证账号',
      near: '地点',
      within: '距离',
      sort: '排序',
      raw: '自定义条件',
    },
    placeholders: {
      allWords: '空格分隔多个词',
      exactPhrase: '必须完整出现的一段话',
      anyWords: '任意一个即可，空格或逗号分隔',
      noneWords: '包含这些词的不要',
      hashtags: '#话题，多个用空格分隔',
      from: '不带 @，例如 realchendahuang',
      to: '发给谁，不带 @',
      mention: '提到谁，不带 @',
      near: '城市或地名',
      within: '数字',
      raw: '例如 list:12345 lang:zh',
    },
    langs: LANGS,
    content: {
      any: '不限',
      images: '图片',
      videos: '视频',
      native_video: '原生视频',
      media: '媒体（图/视频）',
      links: '含链接',
      quote: '引用帖',
    },
    replies: { any: '全部', exclude: '排除回复', only: '只看回复' },
    sort: { top: '最热', live: '最新' },
    units: { km: '公里', mi: '英里' },
    reset: '重置',
    close: '关闭',
    google: '在 Google 搜',
    search: '在 X 搜',
  },
  en: {
    title: 'Advanced search',
    trigger: 'Advanced search',
    helpTitle: 'FeedSieve · Advanced search',
    toggleFooter:
      'A FeedSieve feature · turn it off in Settings › Profile › Advanced search under the search box',
    triggerHelp:
      'Turns X search operators into a form with separate fields for keywords, people, dates, engagement, filters and location, plus custom operators.',
    sections: {
      words: {
        title: 'Keywords',
        help: 'All words are separated by spaces; an exact phrase is quoted; any-of becomes (a OR b); each excluded word gets a leading -; hashtags get a #.',
      },
      people: {
        title: 'People',
        help: 'Maps to from:, to: and an @mention. "From" limits results to that author; on a profile page it is filled with that handle automatically, and leaving it empty means anyone.',
      },
      dates: {
        title: 'Dates',
        help: 'Maps to since: and until:, at day precision.',
      },
      engagement: {
        title: 'Engagement',
        help: 'Maps to min_replies:, min_retweets: and min_faves:. Empty or 0 means no minimum.',
      },
      filters: {
        title: 'Filters',
        help: 'Maps to the filter: family: images, videos, native video, media, links, quotes; also exclude replies, exclude reposts and verified-only.',
      },
      location: {
        title: 'Location',
        help: 'Maps to near: and within:. Place names with spaces are quoted automatically.',
      },
      more: {
        title: 'More',
        help: 'Operators without a dedicated field (list:, conversation_id:, url:) go here and are appended as written.',
      },
    },
    fields: {
      allWords: 'All of these words',
      exactPhrase: 'Exact phrase',
      anyWords: 'Any of these words',
      noneWords: 'None of these words',
      hashtags: 'Hashtags',
      language: 'Language',
      from: 'From these accounts',
      to: 'To these accounts',
      mention: 'Mentioning these accounts',
      since: 'Since',
      until: 'Until',
      minReplies: 'Minimum replies',
      minRetweets: 'Minimum reposts',
      minLikes: 'Minimum likes',
      content: 'Content type',
      replies: 'Replies',
      excludeRetweets: 'Exclude reposts',
      verifiedOnly: 'Verified accounts only',
      near: 'Near',
      within: 'Within',
      sort: 'Sort',
      raw: 'Custom operators',
    },
    placeholders: {
      allWords: 'Separate words with spaces',
      exactPhrase: 'A phrase that must appear exactly',
      anyWords: 'Any one is enough; spaces or commas',
      noneWords: 'Exclude posts containing these',
      hashtags: '#tags, separated by spaces',
      from: 'No @, e.g. realchendahuang',
      to: 'Recipient, no @',
      mention: 'Mentioned account, no @',
      near: 'City or place',
      within: 'Number',
      raw: 'e.g. list:12345 lang:zh',
    },
    langs: LANGS_EN,
    content: {
      any: 'Any',
      images: 'Images',
      videos: 'Videos',
      native_video: 'Native video',
      media: 'Media (images/videos)',
      links: 'With links',
      quote: 'Quote posts',
    },
    replies: { any: 'All', exclude: 'Exclude replies', only: 'Replies only' },
    sort: { top: 'Top', live: 'Latest' },
    units: { km: 'km', mi: 'mi' },
    reset: 'Reset',
    close: 'Close',
    google: 'Search on Google',
    search: 'Search on X',
  },
} as const;

interface SearchAssistDeps {
  getLanguage: () => UiLanguage;
  isEnabled: () => boolean;
  getPath?: () => string;
  getSearch?: () => string;
  openUrl?: (url: string) => void;
  openTab?: (url: string) => void;
  loadPrefs?: () => Promise<SearchAssistPrefs>;
  savePrefs?: (prefs: SearchAssistPrefs) => Promise<void>;
}

export interface SearchAssist {
  tick(): void;
  stop(): void;
  /** 测试用：入口是否还在页面上。 */
  mounted(): boolean;
  /** 测试用：弹窗是否打开。 */
  isOpen(): boolean;
}

function findSearchForm(): HTMLFormElement | null {
  for (const selector of SEARCH_FORM_SELECTORS) {
    for (const form of document.querySelectorAll<HTMLFormElement>(selector)) {
      if (form.querySelector('input')) return form;
    }
  }
  return null;
}

function slidersIcon(): SVGSVGElement {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M4 7h10', 'M18 7h2', 'M4 17h4', 'M12 17h8', 'M16 5v4', 'M10 15v4']) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

export function createSearchAssist(deps: SearchAssistDeps): SearchAssist {
  const getPath = deps.getPath ?? (() => location.pathname);
  const getSearch = deps.getSearch ?? (() => location.search);
  const openUrl = deps.openUrl ?? ((url: string) => location.assign(url));
  const openTab: (url: string) => void =
    deps.openTab ??
    ((url: string) => {
      window.open(url, '_blank', 'noopener');
    });
  const loadPrefs = deps.loadPrefs ?? getSearchAssistPrefs;
  const savePrefs = deps.savePrefs ?? setSearchAssistPrefs;

  let prefs: SearchAssistPrefs = { ...DEFAULT_SEARCH_ASSIST_PREFS };
  /** 「来自博主」不持久化：打开时用当前页面的博主做默认值，用户改过就听用户的。 */
  let author = '';
  let authorTouched = false;
  let handle: string | null = null;
  let trigger: HTMLButtonElement | null = null;
  let backdrop: HTMLElement | null = null;
  let previousOverflow = '';
  let scrollLocked = false;

  /** 弹窗自己的滚动锁：只在 body 原本没锁时接管，解锁时也只还回自己设的那份。 */
  function lockBodyScroll(): void {
    previousOverflow = document.body.style.overflow;
    if (previousOverflow === 'hidden') {
      // 页面已经有别的滚动锁（X 的图片查看器等）：不接管，免得关弹窗时把人家解开
      scrollLocked = false;
      return;
    }
    document.body.style.overflow = 'hidden';
    scrollLocked = true;
  }

  function unlockBodyScroll(): void {
    if (!scrollLocked) return;
    scrollLocked = false;
    // 期间 X 自己改过 overflow（打开查看器 / 菜单）就别覆盖别人的值
    if (document.body.style.overflow === 'hidden') {
      document.body.style.overflow = previousOverflow;
    }
  }
  let renderedLanguage: UiLanguage | null = null;
  let lastLocation = '';
  let saveTimer: number | undefined;

  const language = (): UiLanguage => deps.getLanguage();
  const copy = () => COPY[language()];

  const tips = createHovercard({
    resolve: (target) => {
      const el = target.closest<HTMLElement>('[data-fs-tip]');
      const note = el?.getAttribute('data-fs-tip');
      if (!el || !note) return null;
      return {
        anchor: el,
        content: {
          title: el.getAttribute('data-fs-tip-title') ?? copy().helpTitle,
          rows: [],
          notes: [note],
          footer: copy().toggleFooter,
        },
      };
    },
  });
  tips.listen();

  function setPref<Key extends keyof SearchAssistPrefs>(
    key: Key,
    value: SearchAssistPrefs[Key],
  ): void {
    prefs = { ...prefs, [key]: value };
    scheduleSave();
    syncDisabled();
  }

  function scheduleSave(): void {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      void savePrefs(prefs).catch(() => undefined);
    }, SAVE_DEBOUNCE_MS);
  }

  function buildQuery(): string {
    return buildAdvancedQuery({
      allWords: prefs.allWords,
      exactPhrase: prefs.exactPhrase,
      anyWords: prefs.anyWords,
      noneWords: prefs.noneWords,
      hashtags: prefs.hashtags,
      language: prefs.language,
      from: author,
      to: prefs.to,
      mention: prefs.mention,
      since: prefs.since,
      until: prefs.until,
      minReplies: prefs.minReplies,
      minRetweets: prefs.minRetweets,
      minLikes: prefs.minLikes,
      content: prefs.content,
      replies: prefs.replies,
      excludeRetweets: prefs.excludeRetweets,
      verifiedOnly: prefs.verifiedOnly,
      near: prefs.near,
      within: prefs.within,
      unit: prefs.unit,
      raw: prefs.raw,
    });
  }

  function hasWords(): boolean {
    return Boolean(
      prefs.allWords.trim() ||
        prefs.exactPhrase.trim() ||
        prefs.anyWords.trim() ||
        prefs.hashtags.trim(),
    );
  }

  function googleReady(): boolean {
    return Boolean(author.trim() || hasWords());
  }

  function syncDisabled(): void {
    const dialog = backdrop?.querySelector<HTMLElement>('.fs-adv-dialog');
    if (!dialog) return;
    const search = dialog.querySelector<HTMLButtonElement>('.fs-adv-go');
    if (search) search.disabled = !buildQuery().trim();
    const google = dialog.querySelector<HTMLButtonElement>('.fs-adv-google');
    if (google) google.disabled = !googleReady();
  }

  function closeDialog(): void {
    if (!backdrop) return;
    window.clearTimeout(saveTimer);
    void savePrefs(prefs).catch(() => undefined);
    backdrop.remove();
    backdrop = null;
    unlockBodyScroll();
    trigger?.setAttribute('aria-expanded', 'false');
    tips.hide();
  }

  function openDialog(): void {
    if (!deps.isEnabled()) return;
    if (backdrop) {
      backdrop.querySelector<HTMLInputElement>('.fs-adv-field input')?.focus();
      return;
    }
    tips.hide();
    if (!authorTouched && handle) author = handle;
    backdrop = buildDialog();
    lockBodyScroll();
    document.body.appendChild(backdrop);
    syncDisabled();
    trigger?.setAttribute('aria-expanded', 'true');
    backdrop.querySelector<HTMLInputElement>('.fs-adv-field input')?.focus();
  }

  function searchX(): void {
    const query = buildQuery();
    if (!query.trim()) return;
    closeDialog();
    openUrl(xSearchUrl(query, prefs.sort));
  }

  function searchGoogle(): void {
    if (!googleReady()) return;
    closeDialog();
    openTab(
      googleSearchUrl({
        from: author,
        allWords: prefs.allWords,
        exactPhrase: prefs.exactPhrase,
        anyWords: prefs.anyWords,
        noneWords: prefs.noneWords,
        hashtags: prefs.hashtags,
        since: prefs.since,
        until: prefs.until,
      }),
    );
  }

  function resetPrefs(): void {
    prefs = { ...DEFAULT_SEARCH_ASSIST_PREFS };
    author = '';
    authorTouched = true;
    closeDialog();
    openDialog();
  }

  function helpIcon(note: string): HTMLElement {
    const icon = document.createElement('span');
    icon.className = 'fs-adv-help';
    icon.textContent = '?';
    icon.setAttribute('role', 'img');
    icon.setAttribute('tabindex', '0');
    icon.setAttribute('aria-label', note);
    icon.setAttribute('data-fs-tip', note);
    icon.setAttribute('data-fs-tip-title', copy().helpTitle);
    return icon;
  }

  function textField(
    label: string,
    name: string,
    value: string,
    options: {
      placeholder?: string;
      wide?: boolean;
      type?: 'text' | 'date';
      inputMode?: 'numeric';
      onInput: (value: string) => void;
    },
  ): HTMLElement {
    const field = document.createElement('label');
    field.className = `fs-adv-field${options.wide ? ' fs-adv-field-wide' : ''}`;
    const caption = document.createElement('span');
    caption.className = 'fs-adv-label';
    caption.textContent = label;
    const input = document.createElement('input');
    input.type = options.type ?? 'text';
    input.name = name;
    if (options.inputMode) input.inputMode = options.inputMode;
    input.value = value;
    if (options.placeholder) input.placeholder = options.placeholder;
    input.addEventListener('input', () => options.onInput(input.value));
    field.append(caption, input);
    return field;
  }

  function selectField(
    label: string,
    name: string,
    value: string,
    options: ReadonlyArray<readonly [string, string]>,
    onChange: (value: string) => void,
    wide = false,
  ): HTMLElement {
    const field = document.createElement('label');
    field.className = `fs-adv-field${wide ? ' fs-adv-field-wide' : ''}`;
    const caption = document.createElement('span');
    caption.className = 'fs-adv-label';
    caption.textContent = label;
    const select = document.createElement('select');
    select.name = name;
    select.value = value;
    for (const [key, text] of options) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = text;
      select.appendChild(option);
    }
    select.value = value;
    select.addEventListener('change', () => onChange(select.value));
    field.append(caption, select);
    return field;
  }

  function checkField(
    label: string,
    name: string,
    checked: boolean,
    onChange: (value: boolean) => void,
  ): HTMLElement {
    const field = document.createElement('label');
    field.className = 'fs-adv-check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = name;
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    field.append(input, document.createTextNode(label));
    return field;
  }

  function section(
    title: string,
    help: string,
    children: HTMLElement[],
    columns: 2 | 3 = 2,
  ): HTMLElement {
    const block = document.createElement('section');
    block.className = 'fs-adv-section';
    const head = document.createElement('div');
    head.className = 'fs-adv-section-head';
    const heading = document.createElement('h3');
    heading.textContent = title;
    head.append(heading, helpIcon(help));
    const grid = document.createElement('div');
    grid.className = columns === 3 ? 'fs-adv-grid fs-adv-grid-3' : 'fs-adv-grid';
    grid.append(...children);
    block.append(head, grid);
    return block;
  }

  function withinField(): HTMLElement {
    const c = copy();
    const field = document.createElement('label');
    field.className = 'fs-adv-field';
    const caption = document.createElement('span');
    caption.className = 'fs-adv-label';
    caption.textContent = c.fields.within;
    const row = document.createElement('div');
    row.className = 'fs-adv-within';
    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'within';
    input.inputMode = 'numeric';
    input.value = prefs.within;
    input.placeholder = c.placeholders.within;
    input.addEventListener('input', () => setPref('within', input.value));
    const unit = document.createElement('select');
    unit.name = 'unit';
    for (const [key, text] of Object.entries(c.units)) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = text;
      unit.appendChild(option);
    }
    unit.value = prefs.unit;
    unit.addEventListener('change', () => setPref('unit', unit.value as DistanceUnit));
    row.append(input, unit);
    field.append(caption, row);
    return field;
  }

  function buildDialog(): HTMLElement {
    const c = copy();
    const root = document.createElement('div');
    root.className = SEARCH_ASSIST_BACKDROP_CLASS;
    root.addEventListener('click', (event) => {
      if (event.target === root) closeDialog();
    });

    const dialog = document.createElement('div');
    dialog.className = 'fs-adv-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'fs-adv-title');
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeDialog();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, [tabindex="0"]',
        ),
      ].filter((el) => !(el as HTMLButtonElement).disabled);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    });

    const header = document.createElement('header');
    header.className = 'fs-adv-head';
    const heading = document.createElement('h2');
    heading.id = 'fs-adv-title';
    heading.textContent = c.title;
    header.append(heading, helpIcon(c.triggerHelp));
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'fs-adv-close';
    close.setAttribute('aria-label', c.close);
    close.textContent = '×';
    close.addEventListener('click', closeDialog);
    header.appendChild(close);

    const body = document.createElement('div');
    body.className = 'fs-adv-body';

    const fields = c.fields;
    body.append(
      section(c.sections.words.title, c.sections.words.help, [
        textField(fields.allWords, 'allWords', prefs.allWords, {
          placeholder: c.placeholders.allWords,
          wide: true,
          onInput: (value) => setPref('allWords', value),
        }),
        textField(fields.exactPhrase, 'exactPhrase', prefs.exactPhrase, {
          placeholder: c.placeholders.exactPhrase,
          wide: true,
          onInput: (value) => setPref('exactPhrase', value),
        }),
        textField(fields.anyWords, 'anyWords', prefs.anyWords, {
          placeholder: c.placeholders.anyWords,
          onInput: (value) => setPref('anyWords', value),
        }),
        textField(fields.noneWords, 'noneWords', prefs.noneWords, {
          placeholder: c.placeholders.noneWords,
          onInput: (value) => setPref('noneWords', value),
        }),
        textField(fields.hashtags, 'hashtags', prefs.hashtags, {
          placeholder: c.placeholders.hashtags,
          onInput: (value) => setPref('hashtags', value),
        }),
        selectField(
          fields.language,
          'language',
          prefs.language,
          c.langs,
          (value) => setPref('language', value),
        ),
      ]),
      section(c.sections.people.title, c.sections.people.help, [
        textField(fields.from, 'from', author, {
          placeholder: c.placeholders.from,
          wide: true,
          onInput: (value) => {
            author = value;
            authorTouched = true;
            syncDisabled();
          },
        }),
        textField(fields.to, 'to', prefs.to, {
          placeholder: c.placeholders.to,
          onInput: (value) => setPref('to', value),
        }),
        textField(fields.mention, 'mention', prefs.mention, {
          placeholder: c.placeholders.mention,
          onInput: (value) => setPref('mention', value),
        }),
      ]),
      section(c.sections.dates.title, c.sections.dates.help, [
        textField(fields.since, 'since', prefs.since, {
          type: 'date',
          onInput: (value) => setPref('since', value),
        }),
        textField(fields.until, 'until', prefs.until, {
          type: 'date',
          onInput: (value) => setPref('until', value),
        }),
      ]),
      section(c.sections.engagement.title, c.sections.engagement.help, [
        textField(fields.minReplies, 'minReplies', prefs.minReplies, {
          inputMode: 'numeric',
          onInput: (value) => setPref('minReplies', value),
        }),
        textField(fields.minRetweets, 'minRetweets', prefs.minRetweets, {
          inputMode: 'numeric',
          onInput: (value) => setPref('minRetweets', value),
        }),
        textField(fields.minLikes, 'minLikes', prefs.minLikes, {
          inputMode: 'numeric',
          onInput: (value) => setPref('minLikes', value),
        }),
      ], 3),
      section(c.sections.filters.title, c.sections.filters.help, [
        selectField(
          fields.content,
          'content',
          prefs.content,
          [
            ['any', c.content.any],
            ['images', c.content.images],
            ['videos', c.content.videos],
            ['native_video', c.content.native_video],
            ['media', c.content.media],
            ['links', c.content.links],
            ['quote', c.content.quote],
          ],
          (value) => setPref('content', value as SearchContent),
        ),
        selectField(
          fields.replies,
          'replies',
          prefs.replies,
          [
            ['any', c.replies.any],
            ['exclude', c.replies.exclude],
            ['only', c.replies.only],
          ],
          (value) => setPref('replies', value as RepliesMode),
        ),
        selectField(
          fields.sort,
          'sort',
          prefs.sort,
          [
            ['top', c.sort.top],
            ['live', c.sort.live],
          ],
          (value) => setPref('sort', value as SearchSort),
        ),
        (() => {
          const checks = document.createElement('div');
          checks.className = 'fs-adv-check-row fs-adv-field-wide';
          checks.append(
            checkField(fields.excludeRetweets, 'excludeRetweets', prefs.excludeRetweets, (value) =>
              setPref('excludeRetweets', value),
            ),
            checkField(fields.verifiedOnly, 'verifiedOnly', prefs.verifiedOnly, (value) =>
              setPref('verifiedOnly', value),
            ),
          );
          return checks;
        })(),
      ], 3),
      section(c.sections.location.title, c.sections.location.help, [
        textField(fields.near, 'near', prefs.near, {
          placeholder: c.placeholders.near,
          onInput: (value) => setPref('near', value),
        }),
        withinField(),
      ]),
      section(c.sections.more.title, c.sections.more.help, [
        textField(fields.raw, 'raw', prefs.raw, {
          placeholder: c.placeholders.raw,
          wide: true,
          onInput: (value) => setPref('raw', value),
        }),
      ]),
    );

    const footer = document.createElement('footer');
    footer.className = 'fs-adv-foot';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'fs-adv-reset';
    reset.textContent = c.reset;
    reset.addEventListener('click', resetPrefs);
    const spacer = document.createElement('span');
    spacer.className = 'fs-adv-spacer';
    const google = document.createElement('button');
    google.type = 'button';
    google.className = 'fs-adv-google';
    google.textContent = c.google;
    google.addEventListener('click', searchGoogle);
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'fs-adv-go';
    go.textContent = c.search;
    go.addEventListener('click', searchX);
    footer.append(reset, spacer, google, go);

    dialog.append(header, body, footer);
    root.appendChild(dialog);
    return root;
  }

  function buildTrigger(): HTMLButtonElement {
    const c = copy();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = SEARCH_ASSIST_TRIGGER_CLASS;
    button.setAttribute('aria-label', c.trigger);
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('data-fs-tip', c.triggerHelp);
    button.setAttribute('data-fs-tip-title', c.helpTitle);
    button.appendChild(slidersIcon());
    // 胶囊整行有「点一下聚焦搜索框」的行为，mousedown 也要挡住，别让 X 的联想层先弹出来
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openDialog();
    });
    return button;
  }

  function ensureMounted(): void {
    if (!deps.isEnabled()) {
      closeDialog();
      trigger?.remove();
      trigger = null;
      renderedLanguage = null;
      return;
    }
    const form = findSearchForm();
    const label = form?.querySelector<HTMLElement>(SEARCH_LABEL_SELECTOR);
    if (!form || !label) {
      closeDialog();
      trigger?.remove();
      trigger = null;
      return;
    }
    if (!trigger) trigger = buildTrigger();
    if (trigger.parentElement !== label) label.appendChild(trigger);
    if (renderedLanguage !== language()) {
      const c = copy();
      trigger.setAttribute('aria-label', c.trigger);
      trigger.setAttribute('data-fs-tip', c.triggerHelp);
      trigger.setAttribute('data-fs-tip-title', c.helpTitle);
      renderedLanguage = language();
      if (backdrop) {
        closeDialog();
        openDialog();
      }
    }
  }

  function syncLocation(): void {
    const locationKey = `${getPath()}${getSearch()}`;
    if (locationKey !== lastLocation) {
      if (lastLocation) closeDialog();
      lastLocation = locationKey;
    }
    const next = handleFromLocation(getPath(), getSearch());
    if (next === handle) return;
    handle = next;
    author = '';
    authorTouched = false;
  }

  function syncBackdrop(): void {
    // 弹窗被外部移除（页面脚本 / 其它扩展）时把状态收回来，避免再也打不开
    if (!backdrop || backdrop.isConnected) return;
    backdrop = null;
    unlockBodyScroll();
    trigger?.setAttribute('aria-expanded', 'false');
  }

  function tick(): void {
    syncBackdrop();
    syncLocation();
    ensureMounted();
  }

  async function load(): Promise<void> {
    prefs = await loadPrefs().catch(() => ({ ...DEFAULT_SEARCH_ASSIST_PREFS }));
    if (backdrop) {
      closeDialog();
      openDialog();
    }
  }

  function stop(): void {
    window.clearTimeout(saveTimer);
    closeDialog();
    trigger?.remove();
    trigger = null;
    renderedLanguage = null;
  }

  tick();
  void load();

  return {
    tick,
    stop,
    mounted: () => Boolean(trigger?.isConnected),
    isOpen: () => Boolean(backdrop?.isConnected),
  };
}
