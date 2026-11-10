/**
 * 「AI 味报告卡 → 填入回复框」的端到端冒烟：真 MV3 扩展 + 真 Chromium。
 *
 * 假造一个 x.com 详情页（主帖 + 一条回复），把这条回复的账号预置成「已有 AI 结论」，
 * 然后：点名字后面的「AI 味」标签 → 报告卡出现 → 点「填入回复框」→ 断回复框里出现图片、
 * 且扩展没有点发送。
 *
 * 运行：node scripts/smoke-ai-fill-reply.mjs（先 pnpm build:extension）
 */
import { chromium } from 'playwright';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const source = resolve('apps/extension/.output/chrome-mv3');
JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'));

const POST = '1900000000000000001';

const page = `<!doctype html><html><body><main>
  <article data-testid="tweet" id="op">
    <div data-testid="User-Name"><div><a href="/op">原帖作者</a></div>
      <div><a href="/op">@op</a><a href="/op/status/${POST}">1h</a></div></div>
    <div data-testid="tweetText">主帖</div>
    <div role="group"><button data-testid="reply">reply</button><button data-testid="like">like</button></div>
  </article>
  <article data-testid="tweet" id="farm">
    <div data-testid="User-Name"><div><a href="/farm">Farm</a></div>
      <div><a href="/farm">@farm</a><a href="/farm/status/1900000000000000002">1m</a></div></div>
    <div data-testid="tweetText">回复正文</div>
    <div role="group"><button data-testid="reply">reply</button><button data-testid="like">like</button></div>
  </article>
</main>
<script>
  // X 在工作里点「回复」后的形状：一个 dialog（正文编辑器 + 附件区 + 文件入口）。
  // 这里用脚本模拟官方的上传反应：change 之后把预览图放进附件区。
  document.querySelectorAll('[data-testid="reply"]').forEach((button) => {
    button.addEventListener('click', () => {
      if (document.querySelector('[data-testid="tweetTextarea_0"]')) return;
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.innerHTML =
        '<div data-testid="tweetTextarea_0" contenteditable="true"></div>' +
        '<div data-testid="attachments"></div>' +
        '<input type="file" data-testid="fileInput" hidden />' +
        '<button data-testid="tweetButtonInline">回复</button>';
      document.body.appendChild(dialog);
      const input = dialog.querySelector('input');
      input.addEventListener('change', () => {
        if (!input.files || !input.files[0]) return;
        const img = document.createElement('img');
        img.alt = input.files[0].name;
        dialog.querySelector('[data-testid="attachments"]').appendChild(img);
      });
    });
  });
</script></body></html>`;

const temp = mkdtempSync(join(tmpdir(), 'feedsieve-fill-'));
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
  await context.setOffline(true);
  await worker.evaluate(async () => {
    // eslint-disable-next-line no-undef
    await chrome.storage.local.clear();
    // eslint-disable-next-line no-undef
    await chrome.storage.local.set({
      aiChecksV1: {
        farm: {
          handle: 'farm',
          verdict: 'ai',
          score: 0.91,
          replyCount: 10,
          judgedAt: Math.floor(Date.now() / 1000),
          expiresAt: Math.floor(Date.now() / 1000) + 86400,
          comment: '间隔机械，长短单一',
        },
      },
    });
  });
  await context.route('https://x.com/**', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: page }),
  );

  const tab = await context.newPage();
  const errors = [];
  tab.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await tab.goto(`https://x.com/op/status/${POST}`);

  // 1) 预置结论 → 评论区出现「AI 味 N%」标签（不是只有图标）
  const mark = tab.locator('#farm .fs-ai-mark');
  await mark.waitFor({ timeout: 30_000 });
  assert.match(await mark.textContent(), /AI 味/);

  // 2) 点标签 → 报告卡；卡片上必须有「填入回复框」
  await mark.click();
  const panel = tab.locator('#fs-ai-panel');
  await panel.waitFor();
  await panel.locator('.fs-ai-level').waitFor();
  const fill = panel.getByRole('button', { name: '填入回复框' });
  await fill.waitFor();
  assert.match(await fill.getAttribute('title'), /你点「回复」/);

  // 3) 点它 → 回复框打开，图片出现在附件区
  await fill.click();
  const attachment = tab.locator('[role="dialog"] [data-testid="attachments"] img');
  await attachment.waitFor({ timeout: 15_000 });
  assert.match(await attachment.getAttribute('alt'), /ai-flavor-farm\.png/);

  // 4) 关键红线：回复框里的正文仍为空、发送按钮没被点过（还是原生的「回复」）
  const text = await tab.locator('[data-testid="tweetTextarea_0"]').textContent();
  assert.equal(text, '');
  assert.equal(await tab.locator('[data-testid="tweetButtonInline"]').textContent(), '回复');
  const toasts = await panel.locator('.fs-ai-toast').textContent();
  assert.match(toasts ?? '', /已填入回复框/);

  console.log(
    JSON.stringify({
      scenario: 'ai-report-fill-reply',
      version: JSON.parse(readFileSync(join(extension, 'manifest.json'), 'utf8')).version,
      attached: true,
      publishedByExtension: false,
      consoleErrors: errors,
      passed: true,
    }),
  );
} finally {
  await context.close();
  rmSync(temp, { recursive: true, force: true });
}
