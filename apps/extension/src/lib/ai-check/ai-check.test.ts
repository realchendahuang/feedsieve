import { describe, expect, it } from 'vitest';
import {
  medianGap,
  MAX_REPLIES,
  ReplyCollector,
  replyGaps,
  rhythmOf,
  snowflakeMs,
  type PageTweet,
} from './evidence';
import { flavorOf } from '@feedsieve/shared';
import { formatGap } from './share-card';

const EPOCH = 1288834974657;
const idAt = (ms: number, seq = 0) => ((BigInt(ms - EPOCH) << 22n) + BigInt(seq)).toString();
const T0 = Date.UTC(2026, 9, 31, 8);

/** 回复页的顺序：原帖（别人）→ 主人的回复，一对一对排下来。 */
function page(owner: string, n: number, gapS = 300, from = 0): PageTweet[] {
  const out: PageTweet[] = [];
  for (let i = from; i < from + n; i++) {
    out.push({ postId: idAt(T0 - 3_600_000 - i * 1000), handle: `poster${i}`, text: `原帖 ${i}` });
    out.push({
      postId: idAt(T0 - i * gapS * 1000),
      handle: owner,
      text: `这个思路挺好，第 ${i} 条`,
    });
  }
  return out;
}

describe('ReplyCollector', () => {
  it('把主人帖子和前面紧挨的别人帖子配成一条回复', () => {
    const c = new ReplyCollector('Bot');
    expect(c.observe(page('bot', 3))).toBe(3);
    expect(c.list()[0]).toMatchObject({ parent: '原帖 0', text: '这个思路挺好，第 0 条' });
  });

  it('跳过主人自己的原创帖与自回复、空文本，同一原帖只取一条', () => {
    const c = new ReplyCollector('bot');
    const tweets: PageTweet[] = [
      { postId: '1', handle: 'bot', text: '置顶原创' },
      { postId: '2', handle: 'bot', text: '自己串自己' },
      { postId: '3', handle: 'alice', text: '原帖' },
      { postId: '4', handle: 'bot', text: '' },
      { postId: '3', handle: 'alice', text: '原帖' },
      { postId: '5', handle: 'bot', text: '第二次回复同一原帖' },
    ];
    // 空文本那条不算，也不占用原帖；后面对同一原帖的那条有文字的回复才算
    expect(c.observe(tweets)).toBe(1);
    expect(c.list()[0]?.id).toBe('5');
    expect(
      c.observe([
        { postId: '3', handle: 'alice', text: '原帖' },
        { postId: '6', handle: 'bot', text: '又回了一次' },
      ]),
    ).toBe(0);
  });

  it('同一个原帖作者最多取 2 条，统计回给了几个不同的人', () => {
    const c = new ReplyCollector('bot');
    const tweets: PageTweet[] = [];
    for (let i = 0; i < 6; i++) {
      tweets.push({ postId: `${100 + i}`, handle: 'alice', text: `原帖 ${i}` });
      tweets.push({ postId: `${200 + i}`, handle: 'bot', text: `回复 ${i}` });
    }
    expect(c.observe(tweets)).toBe(2);
    expect(c.authorCount()).toBe(1);
    expect(c.enough).toBe(false);
  });

  it('虚拟滚动跨多次扫描累积、去重，最多 15 条', () => {
    const c = new ReplyCollector('bot');
    c.observe(page('bot', 6));
    expect(c.observe(page('bot', 6))).toBe(0);
    c.observe(page('bot', 20, 300, 6));
    expect(c.size).toBe(MAX_REPLIES);
    expect(c.full).toBe(true);
  });
});

describe('ReplyCollector.observeApi（X 接口数据）', () => {
  it('按「回复给哪条」配对原帖，不靠页面顺序；回自己的不算；原帖作者最多 2 条', () => {
    const c = new ReplyCollector('bot');
    const api = [
      { postId: idAt(T0 - 9e6), handle: 'alice', text: '原帖 A1' },
      { postId: idAt(T0 - 8e6), handle: 'alice', text: '原帖 A2' },
      { postId: idAt(T0 - 7e6), handle: 'alice', text: '原帖 A3' },
      { postId: idAt(T0 - 6e6), handle: 'bob', text: '原帖 B1' },
      {
        postId: idAt(T0 - 3000),
        handle: 'bot',
        text: '@alice 回 A1',
        inReplyToId: idAt(T0 - 9e6),
        inReplyToHandle: 'alice',
      },
      {
        postId: idAt(T0 - 2000),
        handle: 'bot',
        text: '回 A2',
        inReplyToId: idAt(T0 - 8e6),
        inReplyToHandle: 'alice',
      },
      {
        postId: idAt(T0 - 1500),
        handle: 'bot',
        text: '回 A3',
        inReplyToId: idAt(T0 - 7e6),
        inReplyToHandle: 'alice',
      },
      {
        postId: idAt(T0 - 1000),
        handle: 'bot',
        text: '回 B1',
        inReplyToId: idAt(T0 - 6e6),
        inReplyToHandle: 'bob',
      },
      {
        postId: idAt(T0 - 500),
        handle: 'bot',
        text: '自己串自己',
        inReplyToId: idAt(T0 - 1000),
        inReplyToHandle: 'bot',
      },
    ];
    expect(c.observeApi(api)).toBe(3);
    const list = c.list();
    expect(list.map((r) => r.text)).toEqual(['回 B1', '回 A3', '回 A2']);
    expect(list[0]!.parent).toBe('原帖 B1');
    expect(c.authorCount()).toBe(2);
  });
});

describe('节奏', () => {
  it('从 snowflake ID 算发帖时间和回复间隔', () => {
    expect(snowflakeMs(idAt(T0))).toBe(T0);
    expect(snowflakeMs('abc')).toBeNull();
    const c = new ReplyCollector('bot');
    c.observe(page('bot', 5, 300));
    const gaps = replyGaps(c.list());
    expect(gaps).toEqual([300, 300, 300, 300]);
    expect(medianGap(gaps)).toBe(300);
    expect(rhythmOf(c.list(), gaps)).toMatchObject({ fast: 0, short: 0 });
  });
});

describe('flavorOf', () => {
  it('百分比按 5 取整，分档', () => {
    expect(flavorOf(0.97, 'ai', 'zh')).toMatchObject({
      percent: 95,
      tone: 'ai',
      level: 'AI 感爆棚',
    });
    expect(flavorOf(0.18, 'human', 'zh')).toMatchObject({
      percent: 20,
      tone: 'human',
      level: '活人感爆棚',
    });
    expect(flavorOf(0.6, 'suspect', 'zh').level).toBe('人机难辨');
  });
  it('服务端结论优先：节奏判出的 ai 站到 AI 一侧', () => {
    expect(flavorOf(0.55, 'ai', 'zh').tone).toBe('ai');
  });
  it('不再产出任何评语字段：锐评只来自模型 comment', () => {
    expect(flavorOf(0.97, 'ai', 'zh')).not.toHaveProperty('roast');
  });

  it('英文文案', () => {
    expect(flavorOf(0.05, 'human', 'en').level).toBe('Certified human');
  });
});

it('formatGap', () => {
  expect(formatGap(45, 'zh')).toBe('45 秒');
  expect(formatGap(600, 'zh')).toBe('10 分钟');
  expect(formatGap(7200, 'en')).toBe('2h');
  expect(formatGap(null, 'zh')).toBe('—');
});
