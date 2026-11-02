// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { createManualActions } from './manual-actions';
import { createContentState } from './page-state';
import type { BlockEvidence } from '../detection/detection-pipeline';
vi.mock('../community/contribute', () => ({ syncLocalLabels: vi.fn(async () => ({})) }));
vi.mock('../community/allowlist', () => ({ removeAllowed: vi.fn(async () => {}) }));
vi.mock('../community/following-allowlist', () => ({
  removeFollowingAccount: vi.fn(async () => {}),
}));

beforeEach(() => {
  document.body.innerHTML = '';
});

function setup(blockOne: Parameters<typeof createManualActions>[0]['blockOne']) {
  const fold = { shouldFoldBlockedTweets: () => false } as unknown as Parameters<
    typeof createManualActions
  >[0]['fold'];
  return createManualActions({ state: createContentState(), blockOne, fold });
}

function makeArticle(
  actions: ReturnType<typeof createManualActions>,
  handle: string,
  evidence: BlockEvidence = {},
): HTMLButtonElement {
  const article = document.createElement('article');
  article.innerHTML = '<div role="group"><button data-testid="like">Like</button></div>';
  actions.attachManualAction(article, handle, evidence);
  document.body.appendChild(article);
  return article.querySelector<HTMLButtonElement>('[data-fs-manual-action]')!;
}

function pickReason(reason: string): void {
  document.querySelector<HTMLButtonElement>(`[data-fs-reason="${reason}"]`)!.click();
}

it('先选原因再拉黑；用最新的 evidence，而不是 X 回收前的旧值', async () => {
  const blockOne = vi.fn(async () => ({ ok: true as const }));
  const actions = setup(blockOne);
  const article = document.createElement('article');
  article.innerHTML = '<div role="group"><button data-testid="like">Like</button></div>';
  actions.attachManualAction(article, 'old_user', { tweetText: 'old text' });
  actions.attachManualAction(article, 'new_user', { tweetText: 'new text', evidencePostId: '123' });
  document.body.appendChild(article);
  expect(article.querySelectorAll('[data-fs-manual-action]')).toHaveLength(1);

  article.querySelector<HTMLButtonElement>('[data-fs-manual-action]')!.click();
  const menu = document.querySelector('.fs-reason-menu');
  expect(menu).not.toBeNull();
  expect(menu?.textContent).toContain('为什么拉黑？');
  pickReason('advertising');

  await vi.waitFor(() =>
    expect(blockOne).toHaveBeenCalledWith(
      expect.objectContaining({
        handle: 'new_user',
        category: 'advertising',
        evidence: expect.objectContaining({
          tweetText: 'new text',
          evidencePostId: '123',
          detectionSource: 'manual',
        }),
      }),
      expect.objectContaining({ origin: 'manual-spam', communityVote: true }),
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
    const actions = setup(blockOne);

    // 空闲：只有图标，没有汉字
    const ok = makeArticle(actions, 'spam_one');
    expect(ok.getAttribute('data-fs-state')).toBe('idle');
    expect(ok.querySelector('svg')?.getAttribute('data-fs-icon')).toBe('userX');
    expect(ok.textContent).toBe('');
    ok.click();
    pickReason('bot_spam');
    expect(ok.getAttribute('data-fs-state')).toBe('busy');
    await vi.waitFor(() => expect(ok.getAttribute('data-fs-state')).toBe('done'));
    expect(ok.querySelector('svg')?.getAttribute('data-fs-icon')).toBe('check');

    // 失败：短暂显示错误码，3 秒后回到可点的空闲态
    const failed = makeArticle(actions, 'spam_two');
    failed.click();
    pickReason('bot_spam');
    await vi.waitFor(() => expect(failed.getAttribute('data-fs-state')).toBe('failed'));
    expect(failed.textContent).toContain('rate_limited');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(failed.getAttribute('data-fs-state')).toBe('idle');
    expect(failed.disabled).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it('「仅拉黑」只拉黑，不参与社区计票', async () => {
  const blockOne = vi.fn(async () => ({ ok: true as const }));
  const actions = setup(blockOne);
  const button = makeArticle(actions, 'personal_target');
  button.click();
  document.querySelector<HTMLButtonElement>('.fs-reason-personal')!.click();

  await vi.waitFor(() =>
    expect(blockOne).toHaveBeenCalledWith(
      expect.objectContaining({ handle: 'personal_target', category: 'other' }),
      expect.objectContaining({ origin: 'manual-personal', communityVote: false }),
    ),
  );
});

it('再点一次同一颗按钮收起原因菜单', () => {
  const actions = setup(vi.fn(async () => ({ ok: true as const })));
  const button = makeArticle(actions, 'toggle_target');
  button.click();
  expect(document.querySelector('.fs-reason-menu')).not.toBeNull();
  button.click();
  expect(document.querySelector('.fs-reason-menu')).toBeNull();
});

it('按 Esc 关闭原因菜单，不执行拉黑', async () => {
  const blockOne = vi.fn(async () => ({ ok: true as const }));
  const actions = setup(blockOne);
  const button = makeArticle(actions, 'esc_target');
  button.click();
  // 监听器在打开后的下一个宏任务挂上，等一拍再派发 Esc
  await new Promise((resolve) => setTimeout(resolve, 0));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(document.querySelector('.fs-reason-menu')).toBeNull();
  expect(blockOne).not.toHaveBeenCalled();
});
