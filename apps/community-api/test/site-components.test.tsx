/**
 * 公示页组件级 SSR 内容测试（替代旧 site-pages.test.ts 的模板壳断言）:
 * TanStack Start 的整页 SSR 依赖虚拟模块，无法在 vitest 里跑；
 * 但每条公示路由拆成「loader 数据 → 展示组件」， Metal 用 react-dom/server
 * 对组件 renderToString 断言口径：tab id、榜单结构、申请表单、词库胶囊。
 */

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BlacklistPanel } from '../src/site/pages/lists/BlacklistPanel';
import { WhitelistPanel } from '../src/site/pages/lists/WhitelistPanel';
import { KeywordsPanel } from '../src/site/pages/lists/KeywordsPanel';
import { ERROR_TEXT } from '../src/site/pages/lists/ApplyPage';
import type { RosterPayload } from '../src/roster';

function rosterSample(): RosterPayload {
  return {
    snapshot_version: '2026.09.12.1',
    generated_at: '2026-09-12T03:00:00.000Z',
    signed: true,
    policy: {} as RosterPayload['policy'],
    blacklist: {
      count: 1,
      entries: [
        {
          handle: 'spam_bot_1',
          category: 'bot_spam',
          sources: ['maintainer', 'community'],
          net_votes: 7,
          report_count: 9,
          rescue_count: 2,
          maintainer_note: '批量广告话术',
          first_seen_at: '2026-09-01T00:00:00.000Z',
          updated_at: '2026-09-11T00:00:00.000Z',
          aliases: ['old_name'],
          evidence_post_ids: ['123456789'],
          domains: ['spam.example'],
        },
      ],
    },
    whitelist: {
      maintained: [{ handle: 'kosx_note', note: '真实简介', added_at: '2026-09-10T00:00:00.000Z' }],
      verified: [
        {
          handle: 'rescued_ok',
          net_votes: 1,
          rescue_count: 3,
          report_count: 2,
          updated_at: '2026-09-11T00:00:00.000Z',
        },
      ],
    },
  };
}

// react-router Link 需要 RouterProvider；panels 不用 Link（纯 a），可直接渲染。
// ListsTabs/HandleLink 才是 router 依赖件，均不在 panels 内。

describe('黑名单面板', () => {
  it('行结构：账号/分类/来源/净票/更新 一应俱全', () => {
    const html = renderToString(<BlacklistPanel entries={rosterSample().blacklist.entries} />);
    expect(html).toContain('x.com/spam_bot_1');
    expect(html).toContain('机器人');
    expect(html).toContain('维护者');
    expect(html).toContain('7');
  });
});

describe('白名单面板', () => {
  it('推荐白名单与社区抢救两表同行', () => {
    const data = rosterSample().whitelist;
    const html = renderToString(<WhitelistPanel maintained={data.maintained} verified={data.verified} />);
    expect(html).toContain('x.com/kosx_note');
    expect(html).toContain('真实简介');
    expect(html).toContain('x.com/rescued_ok');
  });
});

describe('词库面板', () => {
  it('展示词库版本与规则胶囊与贡献表单', () => {
    const html = renderToString(
      <KeywordsPanel
        data={{
          pack_version: '2026.09.10.1',
          signed: true,
          total_rules: 2,
          packs: [{ id: 'adult_gray', name: { zh: '黄推' }, rules: [{ phrase: '加微信' }] }],
        }}
      />,
    );
    expect(html).toContain('2026.09.10.1');
    expect(html).toContain('加微信');
    expect(html).toContain('想加入词库的词');
  });
});

describe('文案与错误码', () => {
  it('错误码表沿用旧口径', () => {
    expect(ERROR_TEXT.batch_too_large).toBe('一次最多提交 10 条');
    expect(ERROR_TEXT.application_pending).toBe('该账号已有申请在处理中');
  });
});

