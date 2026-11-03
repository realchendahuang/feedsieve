import { describe, expect, it } from 'vitest';
import {
  buildAdvancedQuery,
  buildXQuery,
  cleanHandle,
  dateDaysAgo,
  googleSearchUrl,
  handleFromLocation,
  normalizeSearchContent,
  normalizeSearchRange,
  normalizeSearchSort,
  parseMinLikes,
  stripXOperators,
  validDate,
  xSearchUrl,
} from './advanced';

const NOW = new Date(2026, 10, 3, 12, 0, 0).getTime(); // 2026-11-03 本地时间

describe('buildXQuery', () => {
  it('拼出 from + 关键词 + 最低赞 + 时间 + 内容 + 排除回复', () => {
    expect(
      buildXQuery({
        handle: 'realchendahuang',
        keyword: 'AI Agent',
        minLikes: '3,000',
        range: 'w',
        content: 'images',
        excludeReplies: true,
        now: NOW,
      }),
    ).toBe(
      'from:realchendahuang AI Agent min_faves:3000 since:2026-10-27 filter:images -filter:replies',
    );
  });

  it('没有博主上下文时不加 from:，空条件不留下多余空格', () => {
    expect(buildXQuery({ keyword: '  选题  ', now: NOW })).toBe('选题');
    expect(buildXQuery({ now: NOW })).toBe('');
  });

  it('取消「仅看这个博主」后即使有 handle 也不加 from:', () => {
    expect(buildXQuery({ handle: 'kim', onlyFrom: false, keyword: 'x', now: NOW })).toBe('x');
  });

  it('最低赞为 0 或非法值时不写 min_faves', () => {
    expect(buildXQuery({ minLikes: '0' })).toBe('');
    expect(buildXQuery({ minLikes: 'abc' })).toBe('');
  });

  it('关键词里的运算符原样保留，交给 X 自己解析', () => {
    expect(buildXQuery({ handle: 'kim', keyword: 'min_retweets:500 lang:zh', now: NOW })).toBe(
      'from:kim min_retweets:500 lang:zh',
    );
  });

  it('搜索框里已经写了的条件优先，不重复追加', () => {
    expect(
      buildXQuery({
        handle: 'kim',
        keyword: 'min_faves:500 选题',
        minLikes: '3000',
        range: 'w',
        content: 'images',
        excludeReplies: true,
        now: NOW,
      }),
    ).toBe('from:kim min_faves:500 选题 since:2026-10-27 filter:images -filter:replies');
    expect(buildXQuery({ keyword: 'from:someone else', handle: 'kim' })).toBe('from:someone else');
  });

  it('关键词里的 -filter:replies 不会挡住内容筛选', () => {
    expect(buildXQuery({ keyword: '-filter:replies 选题', content: 'images' })).toBe(
      '-filter:replies 选题 filter:images',
    );
  });

  it('非法的筛选值不会留下空片段', () => {
    expect(
      buildXQuery({
        keyword: 'x',
        range: 'bad' as never,
        content: 'bad' as never,
      }),
    ).toBe('x');
  });
});

describe('parseMinLikes', () => {
  it('接受数字、逗号和全角逗号', () => {
    expect(parseMinLikes('3,000')).toBe(3000);
    expect(parseMinLikes('3，000')).toBe(3000);
    expect(parseMinLikes(1200)).toBe(1200);
  });

  it('空值、0、负数、非数字都返回 null', () => {
    expect(parseMinLikes('')).toBeNull();
    expect(parseMinLikes('0')).toBeNull();
    expect(parseMinLikes('-5')).toBeNull();
    expect(parseMinLikes('1k')).toBeNull();
    expect(parseMinLikes(null)).toBeNull();
  });
});

describe('dateDaysAgo', () => {
  it('按本地日期往前推', () => {
    expect(dateDaysAgo(NOW, 7)).toBe('2026-10-27');
    expect(dateDaysAgo(NOW, 365)).toBe('2025-11-03');
  });
});

describe('stripXOperators', () => {
  it('去掉筛选运算符，留下普通关键词', () => {
    expect(stripXOperators('from:kim min_faves:3000 选题')).toBe('选题');
    expect(stripXOperators('filter:images -filter:replies cat')).toBe('cat');
    expect(stripXOperators('lang:zh since:2026-01-01 AI')).toBe('AI');
  });

  it('保留引号里的精确短语', () => {
    expect(stripXOperators('"AI Agent" min_retweets:500')).toBe('"AI Agent"');
  });

  it('不误删普通单词', () => {
    expect(stripXOperators('filter coffee')).toBe('filter coffee');
  });
});

describe('buildAdvancedQuery', () => {
  it('把完整表单翻译成 X 运算符', () => {
    expect(
      buildAdvancedQuery({
        allWords: 'AI Agent',
        exactPhrase: 'machine learning',
        anyWords: 'LLM GPT',
        noneWords: 'crypto',
        hashtags: '#AI',
        language: 'zh',
        from: '@realchendahuang',
        to: 'someone',
        mention: '@other',
        since: '2025-01-01',
        until: '2025-12-31',
        minReplies: '100',
        minRetweets: '50',
        minLikes: '3,000',
        content: 'images',
        replies: 'exclude',
        excludeRetweets: true,
        verifiedOnly: true,
        near: 'New York',
        within: '10',
        unit: 'mi',
        raw: 'list:123',
      }),
    ).toBe(
      'AI Agent "machine learning" (LLM OR GPT) -crypto #AI lang:zh from:realchendahuang ' +
        'to:someone @other since:2025-01-01 until:2025-12-31 min_replies:100 min_retweets:50 ' +
        'min_faves:3000 filter:images -filter:replies -filter:retweets filter:verified ' +
        'near:"New York" within:10mi list:123',
    );
  });

  it('空表单不产生任何运算符', () => {
    expect(buildAdvancedQuery({})).toBe('');
    expect(buildAdvancedQuery({ language: '!!', from: 'bad handle!', content: 'any' })).toBe('');
  });

  it('只看回复与引用帖各自映射到对应筛选', () => {
    expect(buildAdvancedQuery({ replies: 'only', content: 'quote' })).toBe(
      'filter:quote filter:replies',
    );
  });

  it('精确短语里的引号会被清掉，避免破坏查询', () => {
    expect(buildAdvancedQuery({ exactPhrase: 'a "b" c' })).toBe('"a b c"');
  });

  it('日期不合法时忽略', () => {
    expect(validDate('2025-02-31')).toBe('');
    expect(validDate('2025-2-1')).toBe('');
    expect(validDate('2024-02-29')).toBe('2024-02-29');
    expect(buildAdvancedQuery({ since: '2025-02-31' })).toBe('');
  });

  it('账号名去掉 @，非法字符整段忽略', () => {
    expect(cleanHandle('@Kim')).toBe('Kim');
    expect(cleanHandle('bad handle')).toBe('');
    expect(cleanHandle('')).toBe('');
  });
});

describe('xSearchUrl', () => {
  it('带上查询、来源和排序', () => {
    const url = new URL(xSearchUrl('from:kim min_faves:100', 'live'));
    expect(url.origin + url.pathname).toBe('https://x.com/search');
    expect(url.searchParams.get('q')).toBe('from:kim min_faves:100');
    expect(url.searchParams.get('f')).toBe('live');
    expect(url.searchParams.get('src')).toBe('typed_query');
  });
});

describe('googleSearchUrl', () => {
  it('有博主时只搜这个人的帖子页', () => {
    const url = new URL(googleSearchUrl({ handle: 'kim', keyword: 'AI Agent', range: 'y' }));
    const query = url.searchParams.get('q') ?? '';
    expect(query).toContain('site:x.com/kim/status');
    expect(query).toContain('site:twitter.com/kim/status');
    expect(query).toContain('AI Agent');
    expect(url.searchParams.get('tbs')).toBe('qdr:y');
  });

  it('没有博主时搜整个 X，并去掉 X 运算符', () => {
    const url = new URL(googleSearchUrl({ keyword: 'min_faves:3000 选题', range: 'any' }));
    const query = url.searchParams.get('q') ?? '';
    expect(query).toContain('site:x.com');
    expect(query).toContain('选题');
    expect(query).not.toContain('min_faves');
    expect(url.searchParams.get('tbs')).toBeNull();
  });

  it('取消「仅看这个博主」后退回搜整个 X', () => {
    const url = new URL(googleSearchUrl({ handle: 'kim', onlyFrom: false, keyword: 'x' }));
    expect(url.searchParams.get('q')).toContain('site:x.com OR site:twitter.com');
    expect(url.searchParams.get('q')).not.toContain('x.com/kim');
  });

  it('结构化关键词和起止日期转成 Google 语法', () => {
    const url = new URL(
      googleSearchUrl({
        from: 'kim',
        allWords: 'AI Agent',
        exactPhrase: 'machine learning',
        anyWords: 'LLM GPT',
        noneWords: 'crypto',
        hashtags: '#AI',
        since: '2025-01-01',
        until: '2025-06-30',
      }),
    );
    const query = url.searchParams.get('q') ?? '';
    expect(query).toContain('AI Agent');
    expect(query).toContain('"machine learning"');
    expect(query).toContain('(LLM OR GPT)');
    expect(query).toContain('-crypto');
    expect(query).toContain('#AI');
    expect(url.searchParams.get('tbs')).toBe('cdr:1,cd_min:1/1/2025,cd_max:6/30/2025');
  });
});

describe('handleFromLocation', () => {
  it('个人主页取路径里的 handle', () => {
    expect(handleFromLocation('/realchendahuang', '')).toBe('realchendahuang');
  });

  it('搜索页从 from: 里取 handle', () => {
    expect(handleFromLocation('/search', '?q=from%3Arealchendahuang+min_faves%3A3000')).toBe(
      'realchendahuang',
    );
    expect(handleFromLocation('/search', '?q=hello+from%3A%40Kim')).toBe('kim');
  });

  it('首页、帖子详情、没有 from: 的搜索页都返回 null', () => {
    expect(handleFromLocation('/home', '')).toBeNull();
    expect(handleFromLocation('/kim/status/123', '')).toBeNull();
    expect(handleFromLocation('/search', '?q=AI')).toBeNull();
  });
});

describe('偏好校验', () => {
  it('未知值回落到默认档', () => {
    expect(normalizeSearchRange('x')).toBe('any');
    expect(normalizeSearchContent(3)).toBe('any');
    expect(normalizeSearchSort('newest')).toBe('top');
    expect(normalizeSearchRange('y')).toBe('y');
  });
});
