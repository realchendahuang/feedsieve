/**
 * 高级搜索表单弹窗（懒加载块：用户第一次点击搜索框旁的高级搜索按钮时加载）。
 */
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
import {
  SEARCH_ASSIST_BACKDROP_CLASS,
  SEARCH_ASSIST_SHARED_COPY,
} from './search-assist-shared';

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
    ...SEARCH_ASSIST_SHARED_COPY.zh,
    title: '高级搜索',
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
    ...SEARCH_ASSIST_SHARED_COPY.en,
    title: 'Advanced search',
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

export interface SearchAssistDialogDeps {
  getLanguage: () => UiLanguage;
  isEnabled: () => boolean;
  getPath: () => string;
  getSearch: () => string;
  openUrl: (url: string) => void;
  openTab: (url: string) => void;
  loadPrefs?: () => Promise<SearchAssistPrefs>;
  savePrefs?: (prefs: SearchAssistPrefs) => Promise<void>;
  onExpandedChange?: (expanded: boolean) => void;
  hideTips?: () => void;
}

export interface SearchAssistDialogController {
  ready(): Promise<void>;
  open(): void;
  close(): void;
  syncLocation(): void;
  syncBackdrop(): void;
  reopenForLanguage(): void;
  isOpen(): boolean;
  stop(): void;
}

export function createSearchAssistDialog(
  deps: SearchAssistDialogDeps,
): SearchAssistDialogController {
  const loadPrefs = deps.loadPrefs ?? getSearchAssistPrefs;
  const savePrefs = deps.savePrefs ?? setSearchAssistPrefs;

  let prefs: SearchAssistPrefs = { ...DEFAULT_SEARCH_ASSIST_PREFS };
  /** 「来自博主」不持久化：打开时用当前页面的博主做默认值，用户改过就听用户的。 */
  let author = '';
  let authorTouched = false;
  let handle: string | null = handleFromLocation(deps.getPath(), deps.getSearch());
  let backdrop: HTMLElement | null = null;
  let previousOverflow = '';
  let scrollLocked = false;
  let saveTimer: number | undefined;

  const copy = () => COPY[deps.getLanguage()];

  function lockBodyScroll(): void {
    previousOverflow = document.body.style.overflow;
    if (previousOverflow === 'hidden') {
      scrollLocked = false;
      return;
    }
    document.body.style.overflow = 'hidden';
    scrollLocked = true;
  }

  function unlockBodyScroll(): void {
    if (!scrollLocked) return;
    scrollLocked = false;
    if (document.body.style.overflow === 'hidden') {
      document.body.style.overflow = previousOverflow;
    }
  }

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

  function close(): void {
    if (!backdrop) return;
    window.clearTimeout(saveTimer);
    void savePrefs(prefs).catch(() => undefined);
    backdrop.remove();
    backdrop = null;
    unlockBodyScroll();
    deps.onExpandedChange?.(false);
    deps.hideTips?.();
  }

  function open(): void {
    if (!deps.isEnabled()) return;
    if (backdrop) {
      backdrop.querySelector<HTMLInputElement>('.fs-adv-field input')?.focus();
      return;
    }
    deps.hideTips?.();
    if (!authorTouched && handle) author = handle;
    backdrop = buildDialog();
    lockBodyScroll();
    document.body.appendChild(backdrop);
    syncDisabled();
    deps.onExpandedChange?.(true);
    backdrop.querySelector<HTMLInputElement>('.fs-adv-field input')?.focus();
  }

  function searchX(): void {
    const query = buildQuery();
    if (!query.trim()) return;
    close();
    deps.openUrl(xSearchUrl(query, prefs.sort));
  }

  function searchGoogle(): void {
    if (!googleReady()) return;
    close();
    deps.openTab(
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
    close();
    open();
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
      if (event.target === root) close();
    });

    const dialog = document.createElement('div');
    dialog.className = 'fs-adv-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'fs-adv-title');
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = [
        ...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]'),
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
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'fs-adv-close';
    closeBtn.setAttribute('aria-label', c.close);
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', close);
    header.appendChild(closeBtn);

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
        selectField(fields.language, 'language', prefs.language, c.langs, (value) =>
          setPref('language', value),
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
      section(
        c.sections.engagement.title,
        c.sections.engagement.help,
        [
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
        ],
        3,
      ),
      section(
        c.sections.filters.title,
        c.sections.filters.help,
        [
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
              checkField(
                fields.excludeRetweets,
                'excludeRetweets',
                prefs.excludeRetweets,
                (value) => setPref('excludeRetweets', value),
              ),
              checkField(fields.verifiedOnly, 'verifiedOnly', prefs.verifiedOnly, (value) =>
                setPref('verifiedOnly', value),
              ),
            );
            return checks;
          })(),
        ],
        3,
      ),
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

  function syncLocation(): void {
    const next = handleFromLocation(deps.getPath(), deps.getSearch());
    if (next === handle) return;
    handle = next;
    author = '';
    authorTouched = false;
  }

  function syncBackdrop(): void {
    if (!backdrop || backdrop.isConnected) return;
    backdrop = null;
    unlockBodyScroll();
    deps.onExpandedChange?.(false);
  }

  function reopenForLanguage(): void {
    if (!backdrop) return;
    close();
    open();
  }

  const loaded = loadPrefs()
    .then((loadedPrefs) => {
      prefs = loadedPrefs;
      if (backdrop) {
        close();
        open();
      }
    })
    .catch(() => {
      prefs = { ...DEFAULT_SEARCH_ASSIST_PREFS };
    });

  function stop(): void {
    window.clearTimeout(saveTimer);
    close();
  }

  return {
    ready: () => loaded,
    open,
    close,
    syncLocation,
    syncBackdrop,
    reopenForLanguage,
    isOpen: () => Boolean(backdrop?.isConnected),
    stop,
  };
}
