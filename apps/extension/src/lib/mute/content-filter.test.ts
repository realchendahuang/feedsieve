// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedItem } from '@feedsieve/x-adapter';
import { createKeywordFilter, MUTE_FOLD_ATTRIBUTE } from './content-filter';
import type { MuteSettings } from './mute-store';

function settings(phrase = '加微信', enabled = true): MuteSettings {
  return {
    enabled,
    nativeSync: false,
    rules: [
      {
        id: 'r1',
        phrase,
        enabled: true,
        origin: 'local',
        syncState: 'local',
        createdAt: 1,
      },
    ],
  };
}

function item(text: string, handle = 'someone'): FeedItem {
  return {
    postId: '123',
    author: { handle, displayName: handle },
    text,
    links: [],
  } as unknown as FeedItem;
}

function mount(): { article: HTMLElement; cell: HTMLElement } {
  document.body.innerHTML = `
    <div data-testid="cellInnerDiv">
      <article data-testid="tweet">
        <div data-testid="tweetText">加微信 领福利</div>
      </article>
    </div>`;
  const article = document.querySelector<HTMLElement>('article[data-testid="tweet"]')!;
  const cell = article.closest<HTMLElement>('div[data-testid="cellInnerDiv"]')!;
  return { article, cell };
}

describe('推文屏蔽词折叠', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
  });

  it('命中后折叠成一条说明，点显示恢复并通知重扫', () => {
    const { article, cell } = mount();
    const onUnfold = vi.fn();
    const filter = createKeywordFilter({
      getLanguage: () => 'zh',
      getSelfHandle: () => null,
      onUnfold,
    });
    filter.setSettings(settings());

    expect(filter.apply(article, item('加微信 领福利'))).toBe(true);
    expect(cell.getAttribute(MUTE_FOLD_ATTRIBUTE)).toBe('1');
    const bar = cell.querySelector('.fs-mute-foldbar')!;
    expect(bar.textContent).toContain('加微信');
    expect(bar.textContent).toContain('显示');

    (bar.querySelector('button') as HTMLButtonElement).click();
    expect(cell.hasAttribute(MUTE_FOLD_ATTRIBUTE)).toBe(false);
    expect(cell.querySelector('.fs-mute-foldbar')).toBeNull();
    expect(onUnfold).toHaveBeenCalledWith(cell);
    // 用户展开过的帖子在同一次会话里不再折叠
    expect(filter.apply(article, item('加微信 领福利'))).toBe(false);
  });

  it('不命中时清掉旧折叠；关闭开关也不折叠', () => {
    const { article, cell } = mount();
    const filter = createKeywordFilter({ getLanguage: () => 'zh', getSelfHandle: () => null });
    filter.setSettings(settings());
    expect(filter.apply(article, item('加微信'))).toBe(true);
    expect(filter.apply(article, item('今天天气不错'))).toBe(false);
    expect(cell.querySelector('.fs-mute-foldbar')).toBeNull();

    filter.setSettings(settings('加微信', false));
    expect(filter.apply(article, item('加微信'))).toBe(false);
  });

  it('自己的帖子和详情页主帖不折叠', () => {
    const { article } = mount();
    const filter = createKeywordFilter({ getLanguage: () => 'zh', getSelfHandle: () => 'me' });
    filter.setSettings(settings());
    expect(filter.apply(article, item('加微信', 'ME'))).toBe(false);
  });

  it('详情页主帖不折叠，下面的回复照常折叠', () => {
    const { article } = mount();
    window.history.pushState({}, '', '/someone/status/123');
    const filter = createKeywordFilter({ getLanguage: () => 'zh', getSelfHandle: () => null });
    filter.setSettings(settings());
    expect(filter.apply(article, item('加微信'))).toBe(false);
    expect(filter.apply(article, { ...item('加微信'), postId: '456' })).toBe(true);
  });

  it('多条规则命中时显示第一条', () => {
    const { article, cell } = mount();
    const filter = createKeywordFilter({ getLanguage: () => 'zh', getSelfHandle: () => null });
    filter.setSettings({
      enabled: true,
      nativeSync: false,
      rules: [
        { id: '1', phrase: '加微信', enabled: true, origin: 'local', syncState: 'local', createdAt: 1 },
        { id: '2', phrase: '领福利', enabled: true, origin: 'local', syncState: 'local', createdAt: 2 },
      ],
    });
    filter.apply(article, item('加微信 领福利'));
    expect(cell.querySelector('.fs-mute-fold-text')?.textContent).toContain('加微信');
  });

  it('clearAll 清掉页面上的所有折叠', () => {
    const { article, cell } = mount();
    const filter = createKeywordFilter({ getLanguage: () => 'zh', getSelfHandle: () => null });
    filter.setSettings(settings());
    filter.apply(article, item('加微信'));
    filter.clearAll();
    expect(cell.hasAttribute(MUTE_FOLD_ATTRIBUTE)).toBe(false);
    expect(cell.querySelector('.fs-mute-foldbar')).toBeNull();
  });
});
