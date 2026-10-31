import { describe, expect, it } from 'vitest';
import { formatLocalTime, threadToMarkdown, tweetToMarkdown } from './markdown';

const createdAt = new Date(2026, 9, 29, 23, 4).getTime();

describe('tweetToMarkdown', () => {
  it('formats author, local time, text and link', () => {
    expect(
      tweetToMarkdown(
        {
          handle: 'alice',
          displayName: 'Alice *A*',
          postId: '123',
          text: '第一行\n第二行\n',
          createdAt,
        },
        'zh',
      ),
    ).toBe(
      '**Alice \\*A\\*** (@alice) · 2026-10-29 23:04\n\n第一行\n第二行\n\n[原帖](https://x.com/alice/status/123)',
    );
  });

  it('omits missing pieces', () => {
    expect(tweetToMarkdown({ handle: 'bob', text: 'hi' }, 'en')).toBe('**@bob**\n\nhi');
  });
});

describe('threadToMarkdown', () => {
  it('appends replies as a flattened list', () => {
    const out = threadToMarkdown(
      { handle: 'alice', postId: '1', text: 'main' },
      [
        { handle: 'bob', displayName: 'Bob', postId: '2', text: 'nice\npost' },
        { handle: 'carl', text: 'ok' },
      ],
      'zh',
    );
    expect(out).toContain('## 评论（2）');
    expect(out).toContain('- **Bob** (@bob)：nice post [↗](https://x.com/bob/status/2)');
    expect(out).toContain('- **@carl**：ok');
  });

  it('returns just the tweet without replies', () => {
    expect(threadToMarkdown({ handle: 'a', text: 'x' }, [], 'en')).toBe('**@a**\n\nx');
  });
});

describe('formatLocalTime', () => {
  it('pads fields', () => {
    expect(formatLocalTime(new Date(2026, 0, 2, 3, 4).getTime())).toBe('2026-01-02 03:04');
  });
});
