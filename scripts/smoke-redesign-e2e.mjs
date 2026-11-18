/**
 * 新版无 data-testid X 全功能端到端验收：真 Chromium + 真 MV3 构建产物（content + xhr-bridge + SW + popup）。
 *
 * 覆盖：
 * 1. 新版首页时间线（无 data-testid / cellInnerDiv / time）：
 *    - 关键词规则标黄 + 误标反馈落盘 + 点击不冒泡触发外层 role=link 卡片跳转
 *    - 普通推文手动拉黑入口 + 原因浮层不冒泡
 *    - MAIN world xhr-bridge 拦截 HomeTimeline GraphQL → 流速胶囊与作者量级胶囊渲染
 *    - 分享按钮 + XDS 菜单注入「复制为 Markdown」
 *    - 界面净化（Grok「解释这个帖子」按钮、付费推广帖、不误藏带「推广」按钮的自帖、无 sidebarColumn 侧栏趋势与推荐关注）
 *    - 无 SearchBox testid 搜索栏挂载高级搜索并打开弹窗
 * 2. 新版帖子详情页（主帖竖排头部无 .x-middot-group，时间戳在正文下方）：
 *    - 识别主帖（不挂 AI 检测入口），普通回复挂机器人入口
 *    - 已知 AI 账号在无 cellInnerDiv 下完成 mode=fold 折叠、展开不冒泡
 *    - 点 AI 味标签 → 报告卡 →「填入回复框」填入无 tweetTextarea/attachments testid 的新版回复框且不代点发送
 *    - 淡化纯回复位蓝标短回复，主帖不淡化
 * 3. 新版个人主页（无 primaryColumn / UserProfileHeader_Items）：
 *    - Tab 栏挂载「AI 味」Tab
 *    - 资料卡关注/粉丝行后挂载主页人气行（.fs-profile-line）
 * 4. 扩展弹窗（popup.html）：全部顶栏视图切换无报错。
 *
 * 运行：node scripts/smoke-redesign-e2e.mjs（需先 pnpm build:extension）
 */
import { chromium } from 'playwright';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const source = resolve('apps/extension/.output/chrome-mv3');
const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'));

function redesignCard({
  id,
  handle,
  name,
  postId,
  body,
  verified = true,
  promoted = false,
  ownPromoteBtn = false,
}) {
  const badge = verified ? '<div><span aria-label="认证账号" role="button"></span></div>' : '';
  const meta = promoted
    ? '<span>推广</span>'
    : `<span><a class="x-link" href="/${handle}/status/${postId}">1小时</a></span>`;
  const promoteBtn = ownPromoteBtn
    ? '<button role="button" class="own-promote"><span>推广</span></button>'
    : '';
  return `
    <div role="link" id="${id}" class="outer-card">
      <article class="flex flex-col gap-1">
        <div class="flex gap-2">
          <div class="relative flex w-10 shrink-0 flex-col items-center self-stretch">
            <div class="relative z-10"><a class="x-link" href="/${handle}"><div class="x-avatar"><img src="https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png" /></div></a></div>
          </div>
          <div class="flex min-w-0 flex-1 flex-col gap-3">
            <div class="flex flex-col gap-0.5">
              <div class="@container/post-actions flex items-start justify-between gap-2">
                <div class="x-middot-group max-w-full text-body font-normal text-secondary min-w-0">
                  <div class="flex items-center gap-1 min-w-0">
                    <span class="max-w-full min-w-0 flex shrink-0 items-center gap-1">
                      <a class="x-link" href="/${handle}"><div class="font-bold">${name}</div></a>
                      ${badge}
                    </span>
                    <span><a class="x-link" href="/${handle}"><span>@${handle}</span></a></span>
                  </div>
                  ${meta}
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  ${promoteBtn}
                  <span><button data-slot="xds-button" aria-label="解释这个帖子"><span class="x-button-slot"></span></button></span>
                  <button data-slot="xds-menu-trigger" aria-label="更多"><span class="x-button-slot"></span></button>
                </div>
              </div>
              <div class="max-w-full text-body font-normal text-primary whitespace-pre-wrap wrap-anywhere"><span>${body}</span></div>
            </div>
            <div role="group" class="flex items-center justify-between">
              <div data-engagement-action="reply"><a class="x-engagement-button" aria-label="回复" href="/compose/post?in_reply_to=${postId}"></a></div>
              <div data-engagement-action="retweet"><button data-slot="xds-menu-trigger" aria-label="转帖"></button></div>
              <div data-engagement-action="like"><button aria-label="点赞"></button></div>
              <div class="flex shrink-0 items-center">
                <div><span data-engagement-action="bookmark"><button aria-label="书签"></button></span></div>
                <button data-engagement-action="share" data-slot="xds-menu-trigger" aria-label="分享"><svg viewBox="0 0 24 24"><path d="M1 1h2"/></svg></button>
              </div>
            </div>
          </div>
        </div>
      </article>
    </div>`;
}

const homeHtml = `<!doctype html><html><body>
  <header><nav><a id="nav-grok" href="/i/grok">Grok</a></nav></header>
  <main>
    ${redesignCard({ id: 'card-spam', handle: 'spammer_x', name: '广告号', postId: '1850000000000000001', body: '全国空降同城上门' })}
    ${redesignCard({ id: 'card-clean', handle: 'clean_author', name: 'Clean Author', postId: '1850000000000000002', body: '今天读了一篇很好的技术文章，分享一下笔记。', ownPromoteBtn: true })}
    ${redesignCard({ id: 'card-ad', handle: 'ad_brand', name: 'Brand Ad', postId: '1850000000000000003', body: '全国空降同城上门限时大促推广信息', promoted: true })}
  </main>
  <aside role="complementary" id="shared-sidebar">
    <form role="search"><label id="search-capsule"><input type="search" aria-label="搜索" /></label></form>
    <div id="sidebar-stack">
      <div id="live-card"><h2 role="heading">X 上的直播</h2><div>直播间</div></div>
      <section role="region" id="trends-region"><h2 role="heading">有什么新鲜事</h2><div>趋势条目</div></section>
      <div id="wtf-card"><h2 role="heading">推荐关注</h2><div>某人</div></div>
      <div id="plain-sidebar-footer"><a href="/tos">服务条款</a></div>
    </div>
  </aside>
  <script>
    window.__cardClicks = [];
    document.querySelectorAll('.outer-card').forEach((card) => {
      card.addEventListener('click', () => window.__cardClicks.push(card.id));
    });
    document.querySelectorAll('[data-engagement-action="share"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('[data-slot="xds-menu-content"]').forEach((m) => m.remove());
        const menu = document.createElement('div');
        menu.setAttribute('data-slot', 'xds-menu-content');
        menu.innerHTML = '<div role="menuitem" id="xds-copy"><svg><path d="M0 0"/></svg><span>复制链接</span></div>';
        document.body.appendChild(menu);
      });
    });
  </script>
</body></html>`;

const detailHtml = `<!doctype html><html><body>
  <main>
    ${redesignCard({ id: 'leading-ad', handle: 'ad_top', name: '前置广告', postId: '1860000000000000000', body: '插在主帖之前的推广帖', promoted: true })}
    <article id="focal-post" class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <a href="/focal_op"><div class="x-avatar"><img src="https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png" /></div></a>
          <div class="flex flex-col">
            <div class="flex items-center gap-1">
              <a href="/focal_op"><div class="font-bold">主帖作者<img alt="🌸" src="https://abs-0.twimg.com/emoji/v2/svg/1f338.svg" /></div></a>
              <a href="/org_hq"><img src="https://pbs.twimg.com/profile_images/2/org.jpg" alt="Org" /></a>
              <div><span aria-label="认证账号" role="button"></span></div>
            </div>
            <div><a href="/focal_op"><span>@focal_op</span></a></div>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <button data-slot="xds-menu-trigger" aria-label="更多"></button>
        </div>
      </div>
      <div class="text-body whitespace-pre-wrap wrap-anywhere"><span>同意 <a href="/other_op/status/1860000000000000888">前文</a></span></div>
      <div role="radiogroup">
        <button type="button"><div class="whitespace-pre-wrap wrap-anywhere"><span>全国空降同城上门投票选项</span></div></button>
      </div>
      <div class="meta-row">
        <a href="/focal_op/status/1860000000000000001">上午10:00 · 2026年11月18日</a>
        <span>推广</span>
      </div>
      <div class="community-note">
        <div class="whitespace-pre-wrap wrap-anywhere"><span>读者背景信息：全国空降同城上门防骗提示</span></div>
      </div>
      <div role="group">
        <div data-engagement-action="reply"><a href="/compose/post?in_reply_to=1860000000000000001"></a></div>
        <div data-engagement-action="like"><button aria-label="点赞"></button></div>
        <button data-engagement-action="share" data-slot="xds-menu-trigger" aria-label="分享"><svg viewBox="0 0 24 24"><path d="M1 1h2"/></svg></button>
      </div>
    </article>
    ${redesignCard({ id: 'reply-op-self', handle: 'focal_op', name: '主帖作者', postId: '1860000000000000004', body: '补充一句我自己的看法。' })}
    ${redesignCard({ id: 'reply-ai', handle: 'ai_bot', name: 'AI Bot', postId: '1860000000000000002', body: '这是一条非常典型的机器人自动生成长回复内容，用来测试折叠与填入回复框。' })}
    ${redesignCard({ id: 'reply-thin', handle: 'blue_water', name: '水贴蓝标', postId: '1860000000000000003', body: '支持一下', verified: true })}
    ${redesignCard({ id: 'reply-ad-mention', handle: 'ad_reply', name: '评论广告', postId: '1860000000000000005', body: '正文带主帖链接 <a href="/focal_op/status/1860000000000000001">回看</a>', promoted: true })}
  </main>
  <script>
    window.__detailClicks = [];
    document.querySelectorAll('.outer-card').forEach((card) => {
      card.addEventListener('click', () => window.__detailClicks.push(card.id));
    });
    document.querySelectorAll('[data-engagement-action="reply"] a').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (document.querySelector('[role="dialog"]')) return;
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.innerHTML =
          '<div role="textbox" contenteditable="true"></div>' +
          '<div class="preview-zone"></div>' +
          '<input type="file" accept="image/png,image/jpeg" hidden />' +
          '<button id="send-reply" type="button">回复</button>';
        document.body.appendChild(dialog);
        const input = dialog.querySelector('input');
        input.addEventListener('change', () => {
          if (!input.files || !input.files[0]) return;
          const img = document.createElement('img');
          img.src = 'blob:https://x.com/mock-upload-id';
          img.alt = input.files[0].name;
          dialog.querySelector('.preview-zone').appendChild(img);
        });
      });
    });
  </script>
</body></html>`;

const inlineDetailHtml = `<!doctype html><html><body>
  <aside><div role="textbox" contenteditable="true"></div><input type="file" accept="image/png" id="sidebar-input" hidden /></aside>
  <main>
    ${redesignCard({ id: 'focal-ai-reply', handle: 'ai_bot', name: 'AI Bot', postId: '1860000000000000099', body: '被直接点进详情页的一条 AI 回复，下方是预渲染的内联回复框。' })}
    <div class="inline-composer-shell">
      <div class="editor-box"><div id="inline-textbox" role="textbox" contenteditable="true"></div></div>
      <div class="preview-zone"></div>
      <button id="send-inline-reply" type="button">回复</button>
    </div>
  </main>
  <script>
    window.__sidebarTouched = false;
    document.getElementById('sidebar-input').addEventListener('change', () => {
      window.__sidebarTouched = true;
    });
    document.querySelectorAll('[data-engagement-action="reply"] a').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });
    const tb = document.getElementById('inline-textbox');
    tb.addEventListener('focus', () => {
      setTimeout(() => {
        const shell = document.querySelector('.inline-composer-shell');
        if (shell.querySelector('input[type="file"]')) return;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png,image/jpeg';
        input.hidden = true;
        input.addEventListener('change', () => {
          if (!input.files || !input.files[0]) return;
          const img = document.createElement('img');
          img.src = 'blob:https://x.com/mock-inline-upload';
          shell.querySelector('.preview-zone').appendChild(img);
        });
        shell.appendChild(input);
      }, 40);
    });
  </script>
</body></html>`;

const profileHtml = `<!doctype html><html><body>
  <main>
    <div class="profile-card">
      <div>Creator Alice</div>
      <div>@alice</div>
      <div id="alice-follow-row">
        <a href="/alice/following"><span>120</span> 正在关注</a>
        <a href="/alice/verified_followers"><span>25K</span> 关注者</a>
      </div>
    </div>
    <nav><div role="tablist">
      <div role="presentation"><a role="tab" aria-selected="true" href="/alice"><span>帖子</span></a></div>
      <div role="presentation"><a role="tab" aria-selected="false" href="/alice/with_replies"><span>回复</span></a></div>
    </div></nav>
    ${redesignCard({ id: 'alice-post-1', handle: 'alice', name: 'Creator Alice', postId: '1870000000000000001', body: '我的代表作置顶推文' })}
  </main>
</body></html>`;

const temp = mkdtempSync(join(tmpdir(), 'feedsieve-redesign-e2e-'));
const extension = join(temp, 'extension');
cpSync(source, extension, { recursive: true });

const context = await chromium.launchPersistentContext(join(temp, 'profile'), {
  channel: 'chromium',
  headless: true,
  proxy: { server: 'http://127.0.0.1:9' },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});

try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;
  await context.setOffline(true);

  const nowSec = Math.floor(Date.now() / 1000);
  await worker.evaluate(async (now) => {
    // eslint-disable-next-line no-undef
    await chrome.storage.local.set({
      searchAssist: true,
      profileLine: true,
      uiSettingsV1: {
        v: 2,
        cleanUi: true,
        hideForYou: false,
        hideTrends: true,
        hideWhoToFollow: true,
        hidePromoted: true,
        hidePromoteButton: false,
        hideGrok: true,
        dimPremiumReplies: true,
        systemFont: true,
      },
      aiCheckSettingsV1: { mode: 'fold', scope: 'all', markFollowing: false },
      aiChecksV1: {
        ai_bot: {
          handle: 'ai_bot',
          verdict: 'ai',
          score: 0.94,
          replyCount: 15,
          judgedAt: now,
          expiresAt: now + 86400,
          comment: '句式高度同质，间隔极其机械',
        },
      },
    });
  }, nowSec);

  const homeTimelinePayload = JSON.stringify({
    data: {
      home: {
        home_timeline_urt: {
          instructions: [
            {
              type: 'TimelineAddEntries',
              entries: [
                {
                  entryId: 'tweet-1850000000000000002',
                  content: {
                    itemContent: {
                      tweet_results: {
                        result: {
                          __typename: 'Tweet',
                          rest_id: '1850000000000000002',
                          views: { count: '48000' },
                          core: {
                            user_results: {
                              result: {
                                rest_id: '10002',
                                core: {
                                  screen_name: 'clean_author',
                                  name: 'Clean Author',
                                  created_at: 'Mon Jan 01 00:00:00 +0000 2024',
                                },
                                relationship_counts: { followers: 56000, following: 200 },
                                tweet_counts: { tweets: 800 },
                              },
                            },
                          },
                          legacy: {
                            created_at: new Date(Date.now() - 2 * 3600 * 1000).toUTCString(),
                            full_text: '今天读了一篇很好的技术文章，分享一下笔记。',
                            favorite_count: 320,
                            retweet_count: 45,
                            reply_count: 18,
                            quote_count: 6,
                            bookmark_count: 90,
                          },
                        },
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    },
  });

  const aliceTimelinePayload = JSON.stringify({
    data: {
      user: {
        result: {
          timeline: {
            timeline: {
              instructions: [
                {
                  type: 'TimelineAddEntries',
                  entries: [1, 2, 3, 4, 5].map((idx) => ({
                    entryId: `tweet-187000000000000000${idx}`,
                    content: {
                      itemContent: {
                        tweet_results: {
                          result: {
                            __typename: 'Tweet',
                            rest_id: `187000000000000000${idx}`,
                            views: { count: String(10000 * idx) },
                            core: {
                              user_results: {
                                result: {
                                  rest_id: '20001',
                                  core: {
                                    screen_name: 'alice',
                                    name: 'Creator Alice',
                                    created_at: 'Mon Jan 01 00:00:00 +0000 2023',
                                  },
                                  relationship_counts: { followers: 25000, following: 120 },
                                  tweet_counts: { tweets: 300 },
                                },
                              },
                            },
                            legacy: {
                              created_at: new Date(Date.now() - idx * 86400 * 1000).toUTCString(),
                              full_text: `Alice post ${idx}`,
                              favorite_count: 100 * idx,
                              retweet_count: 10,
                              reply_count: 5,
                              quote_count: 1,
                              bookmark_count: 20,
                            },
                          },
                        },
                      },
                    },
                  })),
                },
              ],
            },
          },
        },
      },
    },
  });

  await context.route('https://x.com/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/HomeTimeline')) {
      return route.fulfill({ contentType: 'application/json', body: homeTimelinePayload });
    }
    if (url.pathname.includes('/UserOriginalsTimeline')) {
      return route.fulfill({ contentType: 'application/json', body: aliceTimelinePayload });
    }
    if (url.pathname.startsWith('/focal_op/status/')) {
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: detailHtml });
    }
    if (url.pathname.startsWith('/ai_bot/status/')) {
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: inlineDetailHtml });
    }
    if (url.pathname === '/alice') {
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: profileHtml });
    }
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: homeHtml });
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  // === 1. 新版首页全链路 ===
  await page.goto('https://x.com/home');
  await page.waitForSelector('#card-spam .fs-badge', { timeout: 20_000 });
  await page.waitForSelector('#card-clean .fs-manual-mark', { timeout: 10_000 });

  // 触发 MAIN world xhr-bridge 注入指标 → 流速与量级胶囊
  await page.evaluate(() => fetch('https://x.com/i/api/graphql/mock/HomeTimeline'));
  await page.waitForSelector('#card-clean .fs-velocity', { timeout: 10_000 });
  await page.waitForSelector('#card-clean .fs-tier', { timeout: 10_000 });
  assert.match((await page.locator('#card-clean .fs-tier').textContent()) ?? '', /56K/);

  // 点击误标与手动拉黑按钮：均不能冒泡触发外层 role=link 卡片跳转
  await page.locator('#card-spam .fs-allow').click();
  await page.waitForSelector('#card-spam .fs-badge', { state: 'detached' });
  await page.locator('#card-clean .fs-manual-mark').click({ force: true });
  await page.waitForSelector('.fs-reason-menu');
  assert.deepEqual(
    // eslint-disable-next-line no-undef
    await page.evaluate(() => window.__cardClicks),
    [],
  );

  // 分享菜单注入「复制为 Markdown」
  await page.locator('#card-clean [data-engagement-action="share"]').click();
  await page.waitForSelector('[data-slot="xds-menu-content"] [data-fs-share-item]');

  // 界面净化断言 + 无时间戳链接的推广帖也能被扫描器识别并标黄
  assert.equal(await page.locator('#card-ad article').getAttribute('data-fs-clean'), 'promoted');
  assert.equal(await page.locator('#card-ad .fs-badge').count(), 1);
  assert.equal(await page.locator('#card-clean article').getAttribute('data-fs-clean'), null);
  assert.equal(
    await page
      .locator('#card-clean button[aria-label="解释这个帖子"]')
      .getAttribute('data-fs-clean'),
    'grok',
  );
  assert.equal(await page.locator('#trends-region').getAttribute('data-fs-clean'), 'trends');
  assert.equal(await page.locator('#wtf-card').getAttribute('data-fs-clean'), 'follow');
  assert.equal(await page.locator('#shared-sidebar').getAttribute('data-fs-clean'), null);
  assert.equal(await page.locator('#sidebar-stack').getAttribute('data-fs-clean'), null);
  assert.equal(await page.locator('#live-card').getAttribute('data-fs-clean'), null);
  assert.equal(await page.locator('#plain-sidebar-footer').getAttribute('data-fs-clean'), null);

  // 搜索框高级搜索（与趋势/推荐关注共用同一个外层 aside 时，搜索框仍可见可点）
  await page.waitForSelector('#search-capsule .fs-search-trigger');
  await page.locator('#search-capsule .fs-search-trigger').click();
  await page.waitForSelector('.fs-adv-dialog');
  await page.locator('.fs-adv-close').click();

  // === 2. 新版帖子详情页全链路 ===
  await page.goto('https://x.com/focal_op/status/1860000000000000001');
  await page.waitForSelector('#reply-thin .fs-ai-entry', { timeout: 15_000 });
  await page.waitForSelector('#focal-post .fs-manual-mark', { timeout: 10_000 });
  // 带 Twemoji + 机构徽章的主帖被正确识别：不误并入投票选项/社区备注的垃圾词，不挂 AI 入口，主帖作者自评也不挂 AI 入口
  assert.equal(await page.locator('#focal-post .fs-badge').count(), 0);
  assert.equal(await page.locator('#focal-post .fs-ai-entry').count(), 0);
  assert.equal(await page.locator('#reply-op-self .fs-ai-entry').count(), 0);
  // 评论区 AI 检测入口插在作者首行 @handle 前面，不塞进时间戳 span
  assert.equal(
    await page.evaluate(() => {
      // eslint-disable-next-line no-undef
      const entry = document.querySelector('#reply-thin .fs-ai-entry');
      // eslint-disable-next-line no-undef
      const timeSpan = document.querySelector(
        '#reply-thin a[href$="/status/1860000000000000003"]',
      )?.parentElement;
      return Boolean(entry && timeSpan && !timeSpan.contains(entry));
    }),
    true,
  );
  // 评论区蓝标短回复被标记为 premium 淡化；同时前置推广广告隐藏、排在第二条的主帖即使带推广标也豁免不藏
  await page.waitForFunction(
    () =>
      // eslint-disable-next-line no-undef
      document.querySelector('#reply-thin article')?.getAttribute('data-fs-clean') === 'premium',
  );
  assert.equal(await page.locator('#focal-post').getAttribute('data-fs-clean'), null);
  assert.equal(await page.locator('#leading-ad article').getAttribute('data-fs-clean'), 'promoted');
  assert.equal(
    await page.locator('#reply-ad-mention article').getAttribute('data-fs-clean'),
    'promoted',
  );
  // 已知 AI 回复在无 cellInnerDiv 下完成折叠，展开不触发外层卡片点击
  await page.waitForSelector('#reply-ai article[data-fs-ai-fold="1"] .fs-ai-foldbar');
  await page.locator('#reply-ai .fs-ai-foldbar button').click();
  assert.equal(await page.locator('#reply-ai article').getAttribute('data-fs-ai-fold'), null);
  assert.deepEqual(
    // eslint-disable-next-line no-undef
    await page.evaluate(() => window.__detailClicks),
    [],
  );

  // 打开 AI 报告卡 → 点「填入回复框」（新版无 testid 回复框）
  await page.locator('#reply-ai .fs-ai-mark').click();
  const panel = page.locator('#fs-ai-panel');
  await panel.locator('.fs-ai-level').waitFor();
  await panel.getByRole('button', { name: '填入回复框' }).click();
  await page.waitForSelector('[role="dialog"] .preview-zone img[src^="blob:"]', {
    timeout: 15_000,
  });
  assert.equal(await page.locator('#send-reply').textContent(), '回复');
  assert.match((await panel.locator('.fs-ai-toast').textContent()) ?? '', /已填入回复框/);

  // === 2b. 新版详情页无 cellInnerDiv 预渲染内联回复框（非 dialog，fileInput 延迟挂载） ===
  await page.goto('https://x.com/ai_bot/status/1860000000000000099');
  await page.waitForSelector('#focal-ai-reply .fs-ai-mark', { timeout: 15_000 });
  await page.locator('#focal-ai-reply .fs-ai-mark').click();
  await panel.locator('.fs-ai-level').waitFor();
  await panel.getByRole('button', { name: '填入回复框' }).click();
  await page.waitForSelector('.inline-composer-shell .preview-zone img[src^="blob:"]', {
    timeout: 15_000,
  });
  assert.equal(await page.locator('#send-inline-reply').textContent(), '回复');
  assert.equal(
    // eslint-disable-next-line no-undef
    await page.evaluate(() => window.__sidebarTouched),
    false,
  );

  // === 3. 新版个人主页全链路 ===
  await page.goto('https://x.com/alice');
  await page.waitForSelector('[data-fs-ai-tab]', { timeout: 15_000 });
  await page.evaluate(() => fetch('https://x.com/i/api/graphql/mock/UserOriginalsTimeline'));
  await page.waitForSelector('.fs-profile-line', { timeout: 15_000 });
  assert.match((await page.locator('.fs-profile-line').textContent()) ?? '', /2\.5万 粉丝|25K/);

  // === 4. 弹窗 / 侧边栏全视图渲染检查 ===
  const popup = await context.newPage();
  popup.on('pageerror', (err) => pageErrors.push(`popup: ${err.message}`));
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForSelector('button, [role="tab"]', { timeout: 10_000 });
  const navButtons = popup.locator('nav button, header button, [role="tablist"] [role="tab"]');
  const navCount = await navButtons.count();
  assert(navCount >= 4, `Expected popup navigation items, got ${navCount}`);
  for (let i = 0; i < navCount; i++) {
    await navButtons.nth(i).click();
  }
  assert.deepEqual(pageErrors, []);

  console.log(
    JSON.stringify({
      scenario: 'redesign-full-e2e-and-popup',
      version: manifest.version,
      navTabsChecked: navCount,
      pageErrors,
      passed: true,
    }),
  );
} finally {
  await context.close();
  rmSync(temp, { recursive: true, force: true });
}
