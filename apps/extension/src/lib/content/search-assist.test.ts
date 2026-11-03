// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SEARCH_ASSIST_PREFS } from '../settings/search-assist';
import {
  createSearchAssist,
  SEARCH_ASSIST_BACKDROP_CLASS,
  SEARCH_ASSIST_TRIGGER_CLASS,
  type SearchAssist,
} from './search-assist';

let assist: SearchAssist | null = null;

afterEach(() => {
  assist?.stop();
  assist = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function mountDom(): HTMLFormElement {
  document.body.innerHTML = `
    <div data-testid="sidebarColumn">
      <form role="search">
        <div data-testid="SearchBox_Search_Input_label">
          <input data-testid="SearchBox_Search_Input" type="search" aria-label="Search">
        </div>
      </form>
    </div>`;
  return document.querySelector<HTMLFormElement>('form[role="search"]')!;
}

function create(options: {
  enabled?: boolean;
  path?: string;
  opened: string[];
  tabs: string[];
  language?: 'zh' | 'en';
}): SearchAssist {
  assist = createSearchAssist({
    getLanguage: () => options.language ?? 'zh',
    isEnabled: () => options.enabled ?? true,
    getPath: () => options.path ?? '/kim',
    getSearch: () => '',
    openUrl: (url) => options.opened.push(url),
    openTab: (url) => options.tabs.push(url),
    loadPrefs: async () => ({ ...DEFAULT_SEARCH_ASSIST_PREFS }),
    savePrefs: async () => undefined,
  });
  assist.tick();
  return assist;
}

function trigger(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`.${SEARCH_ASSIST_TRIGGER_CLASS}`)!;
}

function dialog(): HTMLElement {
  return document.querySelector<HTMLElement>(`.${SEARCH_ASSIST_BACKDROP_CLASS}`)!;
}

function open(): void {
  trigger().click();
}

function field(name: string): HTMLInputElement {
  return dialog().querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
}

function select(name: string): HTMLSelectElement {
  return dialog().querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
}

function setInput(name: string, value: string): void {
  const input = field(name);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setSelect(name: string, value: string): void {
  const element = select(name);
  element.value = value;
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function setCheck(name: string, checked: boolean): void {
  const input = field(name);
  input.checked = checked;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('搜索框高级搜索弹窗', () => {
  it('入口在搜索胶囊里，点开是居中弹窗', () => {
    mountDom();
    const opened: string[] = [];
    const tabs: string[] = [];
    create({ opened, tabs });

    expect(trigger()).not.toBeNull();
    expect(trigger().parentElement?.getAttribute('data-testid')).toBe(
      'SearchBox_Search_Input_label',
    );
    expect(dialog()).toBeNull();

    open();
    expect(dialog()).not.toBeNull();
    expect(dialog().querySelector('.fs-adv-dialog')).not.toBeNull();
    expect(dialog().textContent).toContain('高级搜索');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('表单的每一项都拼成对应的 X 运算符', () => {
    mountDom();
    const opened: string[] = [];
    const tabs: string[] = [];
    create({ opened, tabs });
    open();

    setInput('allWords', 'AI Agent');
    setInput('exactPhrase', 'machine learning');
    setInput('anyWords', 'LLM GPT');
    setInput('noneWords', 'crypto');
    setInput('hashtags', '#AI');
    setSelect('language', 'zh');
    setInput('from', 'realchendahuang');
    setInput('to', 'someone');
    setInput('mention', 'other');
    setInput('since', '2025-01-01');
    setInput('until', '2025-12-31');
    setInput('minReplies', '100');
    setInput('minRetweets', '50');
    setInput('minLikes', '3,000');
    setSelect('content', 'images');
    setSelect('replies', 'exclude');
    setCheck('excludeRetweets', true);
    setCheck('verifiedOnly', true);
    setInput('near', 'New York');
    setInput('within', '10');
    setSelect('unit', 'mi');
    setInput('raw', 'list:123');
    setSelect('sort', 'live');

    dialog().querySelector<HTMLButtonElement>('.fs-adv-go')!.click();

    expect(opened).toHaveLength(1);
    const url = new URL(opened[0]!);
    expect(url.origin + url.pathname).toBe('https://x.com/search');
    expect(url.searchParams.get('q')).toBe(
      'AI Agent "machine learning" (LLM OR GPT) -crypto #AI lang:zh from:realchendahuang ' +
        'to:someone @other since:2025-01-01 until:2025-12-31 min_replies:100 min_retweets:50 ' +
        'min_faves:3000 filter:images -filter:replies -filter:retweets filter:verified ' +
        'near:"New York" within:10mi list:123',
    );
    expect(url.searchParams.get('f')).toBe('live');
    // 搜完自动收起
    expect(dialog()).toBeNull();
  });

  it('博主主页打开时「来自博主」自动带入当前账号', () => {
    mountDom();
    const opened: string[] = [];
    const tabs: string[] = [];
    create({ opened, tabs, path: '/kim' });
    open();
    expect(field('from').value).toBe('kim');
  });

  it('不在主页时「来自博主」留空', () => {
    mountDom();
    const opened: string[] = [];
    const tabs: string[] = [];
    create({ opened, tabs, path: '/home' });
    open();
    expect(field('from').value).toBe('');
  });

  it('Google 搜索只带关键词、博主和日期，剥掉 X 运算符', () => {
    mountDom();
    const opened: string[] = [];
    const tabs: string[] = [];
    create({ opened, tabs });
    open();

    setInput('allWords', 'AI');
    setInput('from', 'kim');
    setInput('minLikes', '3000');
    setInput('since', '2025-01-01');
    setInput('until', '2025-06-30');
    dialog().querySelector<HTMLButtonElement>('.fs-adv-google')!.click();

    expect(tabs).toHaveLength(1);
    const url = new URL(tabs[0]!);
    const query = url.searchParams.get('q') ?? '';
    expect(query).toContain('site:x.com/kim/status');
    expect(query).toContain('AI');
    expect(query).not.toContain('min_faves');
    expect(url.searchParams.get('tbs')).toBe('cdr:1,cd_min:1/1/2025,cd_max:6/30/2025');
  });

  it('重置会清空表单并重新打开弹窗', () => {
    mountDom();
    const opened: string[] = [];
    const tabs: string[] = [];
    create({ opened, tabs });
    open();
    setInput('allWords', 'AI');
    setInput('from', 'someone');

    dialog().querySelector<HTMLButtonElement>('.fs-adv-reset')!.click();

    expect(dialog()).not.toBeNull();
    expect(field('allWords').value).toBe('');
    expect(field('from').value).toBe('');
  });

  it('点背景、关闭按钮或 Esc 都会收起', () => {
    mountDom();
    const opened: string[] = [];
    const tabs: string[] = [];
    create({ opened, tabs });

    open();
    dialog().dispatchEvent(new Event('click', { bubbles: true }));
    expect(dialog()).toBeNull();

    open();
    dialog().querySelector<HTMLButtonElement>('.fs-adv-close')!.click();
    expect(dialog()).toBeNull();

    open();
    dialog()
      .querySelector('.fs-adv-dialog')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialog()).toBeNull();
  });

  it('每个分组和入口都有小问号，悬停能看到「福滤娃」和关闭位置', () => {
    vi.useFakeTimers();
    mountDom();
    const opened: string[] = [];
    const tabs: string[] = [];
    create({ opened, tabs });
    open();

    const tips = dialog().querySelectorAll('[data-fs-tip]');
    expect(tips.length).toBeGreaterThanOrEqual(7);
    expect(trigger().getAttribute('data-fs-tip-title') ?? '').toContain('福滤娃');

    tips[0]!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    vi.advanceTimersByTime(200);
    const card = document.querySelector('.fs-hovercard');
    expect(card?.textContent ?? '').toContain('福滤娃');
    expect(card?.textContent ?? '').toContain('设置 › 主页 › 搜索框高级搜索');
  });

  it('关掉开关后把入口撤掉并收起弹窗', () => {
    mountDom();
    const opened: string[] = [];
    const tabs: string[] = [];
    let enabled = true;
    assist = createSearchAssist({
      getLanguage: () => 'zh',
      isEnabled: () => enabled,
      getPath: () => '/kim',
      getSearch: () => '',
      openUrl: (url) => opened.push(url),
      openTab: (url) => tabs.push(url),
      loadPrefs: async () => ({ ...DEFAULT_SEARCH_ASSIST_PREFS }),
      savePrefs: async () => undefined,
    });
    open();
    expect(assist.isOpen()).toBe(true);

    enabled = false;
    assist.tick();
    expect(document.querySelector(`.${SEARCH_ASSIST_TRIGGER_CLASS}`)).toBeNull();
    expect(document.querySelector(`.${SEARCH_ASSIST_BACKDROP_CLASS}`)).toBeNull();
  });

  it('X 换掉侧栏节点后，下一次巡检把入口补回去', () => {
    mountDom();
    const opened: string[] = [];
    const tabs: string[] = [];
    create({ opened, tabs });
    expect(assist!.mounted()).toBe(true);

    document.body.innerHTML = `
      <div data-testid="sidebarColumn">
        <form role="search">
          <div data-testid="SearchBox_Search_Input_label">
            <input data-testid="SearchBox_Search_Input" type="search" aria-label="Search">
          </div>
        </form>
      </div>`;
    assist!.tick();

    expect(assist!.mounted()).toBe(true);
    expect(trigger().parentElement?.getAttribute('data-testid')).toBe(
      'SearchBox_Search_Input_label',
    );
  });
});
