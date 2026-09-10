import { describe, expect, it } from 'vitest';
import { CATEGORIES, categoryLabel, formatAgo, isCategory, normalizeHandle } from './index';

describe('categories', () => {
  it('canonical 顺序与历史各副本一致（community-api REPORT_REASONS / share-card CATEGORY_ORDER）', () => {
    expect(CATEGORIES).toEqual([
      'bot_spam',
      'copy_paste',
      'ai_slop',
      'advertising',
      'adult_gray_traffic',
      'scam_phishing',
      'engagement_bait',
      'other',
    ]);
  });

  it('zh/en 标签与 extension i18n CATEGORY_LABELS 逐字一致', () => {
    expect(categoryLabel('bot_spam', 'zh')).toBe('机器人');
    expect(categoryLabel('copy_paste', 'zh')).toBe('重复刷屏');
    expect(categoryLabel('ai_slop', 'zh')).toBe('AI 垃圾');
    expect(categoryLabel('advertising', 'zh')).toBe('广告号');
    expect(categoryLabel('adult_gray_traffic', 'zh')).toBe('色情引流');
    expect(categoryLabel('scam_phishing', 'zh')).toBe('诈骗');
    expect(categoryLabel('engagement_bait', 'zh')).toBe('互动钓鱼');
    // other 是统计桶语境：不显示「其他」
    expect(categoryLabel('other', 'zh')).toBe('垃圾账号');
    expect(categoryLabel('other', 'en')).toBe('Spam');
    expect(categoryLabel('scam_phishing', 'en')).toBe('Scams');
  });

  it('未知分类回退原始字符串（i18n 历史行为）', () => {
    expect(categoryLabel('nonexistent', 'zh')).toBe('nonexistent');
    expect(categoryLabel('nonexistent', 'en')).toBe('nonexistent');
  });

  it('isCategory 覆盖全部成员并拒绝未知', () => {
    for (const c of CATEGORIES) {
      expect(isCategory(c)).toBe(true);
    }
    expect(isCategory('')).toBe(false);
    expect(isCategory('bot_spam ')).toBe(false);
    expect(isCategory('BOT_SPAM')).toBe(false);
  });
});

describe('normalizeHandle', () => {
  it('去 @、小写、1-15 位合法值', () => {
    expect(normalizeHandle('@Foo_Bar')).toBe('foo_bar');
    expect(normalizeHandle('user1')).toBe('user1');
    expect(normalizeHandle('A'.repeat(15))).toBe('a'.repeat(15));
  });

  it('非法输入返回 null（不抛错）', () => {
    expect(normalizeHandle('')).toBe(null);
    expect(normalizeHandle('@')).toBe(null);
    expect(normalizeHandle('a'.repeat(16))).toBe(null);
    expect(normalizeHandle('has space')).toBe(null);
    expect(normalizeHandle('中文名')).toBe(null);
    expect(normalizeHandle('x/y')).toBe(null);
  });

  it('不做 trim（调用方自行决定）', () => {
    expect(normalizeHandle(' user1 ')).toBe(null);
  });
});

describe('formatAgo', () => {
  const sec = Math.floor(Date.now() / 1000);

  it('边界：59s→刚刚，60s→1 分钟前，3599s→59 小时前，86400s→1 天前', () => {
    expect(formatAgo(sec - 59, 'zh')).toBe('刚刚');
    expect(formatAgo(sec - 60, 'zh')).toBe('1 分钟前');
    expect(formatAgo(sec - 3599, 'zh')).toBe('59 分钟前');
    expect(formatAgo(sec - 3600, 'zh')).toBe('1 小时前');
    expect(formatAgo(sec - 86399, 'zh')).toBe('23 小时前');
    expect(formatAgo(sec - 86400, 'zh')).toBe('1 天前');
  });

  it('负值/未来时间按 0 处理（admin 历史行为）', () => {
    expect(formatAgo(sec + 100, 'zh')).toBe('刚刚');
  });

  it('英文标签与 extension i18n 逐字一致', () => {
    expect(formatAgo(sec - 30, 'en')).toBe('just now');
    expect(formatAgo(sec - 120, 'en')).toBe('2m ago');
    expect(formatAgo(sec - 7200, 'en')).toBe('2h ago');
    expect(formatAgo(sec - 172800, 'en')).toBe('2d ago');
  });

  it('与 extension 毫秒时间戳语义等价（秒级截断，亚秒边界最多差 1 秒显示）', () => {
    // extension 旧实现直接吃毫秒差（minutes = floor(delta/60000)）；shared 吃 Unix 秒。
    // 毫秒→秒截断会在「恰好 60s ± 1s」的亚秒边界产生 ≤1s 的显示差异，可忽略；
    // 常规边界（整 60s / 整 61s）两侧语义一致：
    const tsMin = Date.now() - 61_000;
    expect(formatAgo(Math.floor(tsMin / 1000), 'zh')).toBe('1 分钟前');
    const tsJust = Date.now() - 50_000;
    expect(formatAgo(Math.floor(tsJust / 1000), 'zh')).toBe('刚刚');
    const tsHour = Date.now() - 3_600_000;
    expect(formatAgo(Math.floor(tsHour / 1000), 'zh')).toBe('1 小时前');
  });
});
