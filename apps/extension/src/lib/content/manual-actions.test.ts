// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { createManualActions } from './manual-actions';
import { createContentState } from './page-state';
vi.mock('../community/contribute', () => ({ syncLocalLabels: vi.fn(async () => ({})) }));
vi.mock('../community/allowlist', () => ({ removeAllowed: vi.fn(async () => {}) }));
vi.mock('../community/following-allowlist', () => ({
  removeFollowingAccount: vi.fn(async () => {}),
}));
it('manual button uses latest evidence after X recycles or revises an article', async () => {
  const blockOne = vi.fn(async () => ({ ok: true as const }));
  const fold = { shouldFoldBlockedTweets: () => false } as unknown as Parameters<
    typeof createManualActions
  >[0]['fold'];
  const actions = createManualActions({ state: createContentState(), blockOne, fold });
  const article = document.createElement('article');
  article.innerHTML = '<div role="group"><button data-testid="like">Like</button></div>';
  actions.attachManualAction(article, 'old_user', { tweetText: 'old text' });
  actions.attachManualAction(article, 'new_user', { tweetText: 'new text', evidencePostId: '123' });
  expect(article.querySelectorAll('[data-fs-manual-action]')).toHaveLength(1);
  article.querySelector<HTMLButtonElement>('[data-fs-manual-action]')!.click();
  await vi.waitFor(() =>
    expect(blockOne).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: 'new_user',
        evidence: expect.objectContaining({
          tweetText: 'new text',
          evidencePostId: '123',
          detectionSource: 'manual',
        }),
      }),
      expect.anything(),
    ),
  );
});

it('icon button shows busy, done and failed states, then returns to idle', async () => {
  vi.useFakeTimers();
  try {
    const blockOne = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const })
      .mockResolvedValueOnce({ ok: false as const, code: 'rate_limited' });
    const fold = { shouldFoldBlockedTweets: () => false } as unknown as Parameters<
      typeof createManualActions
    >[0]['fold'];
    const actions = createManualActions({ state: createContentState(), blockOne, fold });
    const make = (handle: string) => {
      const article = document.createElement('article');
      article.innerHTML = '<div role="group"><button data-testid="like">Like</button></div>';
      actions.attachManualAction(article, handle, {});
      return article.querySelector<HTMLButtonElement>('[data-fs-manual-action]')!;
    };

    // 空闲：只有图标，没有汉字
    const ok = make('spam_one');
    expect(ok.getAttribute('data-fs-state')).toBe('idle');
    expect(ok.querySelector('svg')?.getAttribute('data-fs-icon')).toBe('userX');
    expect(ok.textContent).toBe('');
    ok.click();
    expect(ok.getAttribute('data-fs-state')).toBe('busy');
    await vi.waitFor(() => expect(ok.getAttribute('data-fs-state')).toBe('done'));
    expect(ok.querySelector('svg')?.getAttribute('data-fs-icon')).toBe('check');

    // 失败：短暂显示错误码，3 秒后回到可点的空闲态
    const failed = make('spam_two');
    failed.click();
    await vi.waitFor(() => expect(failed.getAttribute('data-fs-state')).toBe('failed'));
    expect(failed.textContent).toContain('rate_limited');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(failed.getAttribute('data-fs-state')).toBe('idle');
    expect(failed.disabled).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
