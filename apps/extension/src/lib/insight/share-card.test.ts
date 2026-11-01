import { describe, expect, it } from 'vitest';
import type { CatalogPost } from './profile-catalog';
import { pickSharePosts, snippetText } from './share-card';

function post(postId: string, extra: Partial<CatalogPost> = {}): CatalogPost {
  return { postId, firstSeenAt: 0, updatedAt: 0, ...extra };
}

describe('pickSharePosts', () => {
  it('按发出时间倒序，只取前三条', () => {
    const posts = [
      post('1', { createdAt: 100, views: 10_000 }),
      post('2', { createdAt: 300, views: 10_000 }),
      post('3', { createdAt: 200, views: 10_000 }),
      post('4', { createdAt: 400, views: 10_000 }),
    ];
    expect(pickSharePosts(posts).map((item) => item.postId)).toEqual(['4', '2', '3']);
  });

  it('跳过回复、没有浏览数和零浏览的帖子', () => {
    const posts = [
      post('a', { createdAt: 100, views: 10_000 }),
      post('b', { createdAt: 200, views: 10_000, kind: 'reply' }),
      post('c', { createdAt: 300 }),
      post('d', { createdAt: 400, views: 0 }),
    ];
    expect(pickSharePosts(posts).map((item) => item.postId)).toEqual(['a']);
  });

  it('没有发出时间的帖子不进分享卡', () => {
    const posts = [post('a', { views: 10_000 })];
    expect(pickSharePosts(posts)).toEqual([]);
  });

  it('不足三条时有多少给多少', () => {
    const posts = [post('a', { createdAt: 100, views: 1 })];
    expect(pickSharePosts(posts)).toHaveLength(1);
  });

  it('不修改传入的数组', () => {
    const posts = [
      post('a', { createdAt: 100, views: 1 }),
      post('b', { createdAt: 200, views: 1 }),
    ];
    const snapshot = posts.map((item) => item.postId);
    pickSharePosts(posts);
    expect(posts.map((item) => item.postId)).toEqual(snapshot);
  });
});

describe('snippetText', () => {
  it('换行压成空格，去掉末尾的 t.co 链接', () => {
    expect(snippetText(post('a', { snippet: '第一行\n\n第二行 https://t.co/AbCd' }), 'zh')).toBe(
      '第一行 第二行',
    );
  });

  it('没有正文的图片帖给占位文案', () => {
    expect(snippetText(post('a', { media: 'photo' }), 'zh')).toBe('（图片）');
    expect(snippetText(post('a', { media: 'video' }), 'en')).toBe('(video)');
  });

  it('既没有正文也没有媒体时也不留空', () => {
    expect(snippetText(post('a'), 'zh')).toBe('（没有正文）');
  });
});
