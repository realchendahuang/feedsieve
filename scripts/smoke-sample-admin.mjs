/** Isolated rendered admin acceptance; all API responses are fixtures, never production writes. */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const dir = resolve('apps/admin/dist');
const server = createServer((req, res) => {
  const path = req.url?.startsWith('/assets/') ? req.url : '/index.html';
  try {
    res.setHeader(
      'content-type',
      { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[extname(path)] ??
        'application/octet-stream',
    );
    res.end(readFileSync(resolve(dir, '.' + path)));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  let saved;
  const entry = {
    id: 1,
    received_at: 1789266000,
    content_hash: 'fixturehash',
    review_id: null,
    verdict: null,
    family: null,
    tags: [],
    note: null,
    reviewed_at: null,
    sample: {
      schemaVersion: 1,
      eventId: '00000000-0000-4000-8000-000000000001',
      handle: 'fixture_user',
      action: 'false-positive',
      observedAt: 1789266000000,
      actedAt: 1789266001000,
      clientVersion: '0.9.4',
      catalogVersion: '2026.09.13.2',
      text: '请不要相信“看简介加我”的垃圾广告',
      displayName: '正常读者',
      truncated: [],
      detection: { source: 'heuristic', ruleId: 'keyword:profile:adult-invitation', signalIds: [] },
    },
  };
  await page.route('**/api/admin/**', async (route) => {
    const url = new URL(route.request().url());
    let body = {};
    if (url.pathname.endsWith('/me')) body = { email: 'fixture@example.com' };
    else if (url.pathname.endsWith('/feedback')) body = { summary: [], feedback: [] };
    else if (url.pathname.endsWith('/review')) {
      saved = route.request().postDataJSON();
      Object.assign(entry, saved, { review_id: 1, reviewed_at: 1789266010 });
      body = { changed: true };
    } else if (url.pathname.endsWith('/samples'))
      body = {
        schema_version: 1,
        until: 1,
        review_until: entry.review_id ?? 0,
        entries: Number(url.searchParams.get('after') ?? 0) > 0 ? [] : [entry],
        next_cursor: Number(url.searchParams.get('after') ?? 0) > 0 ? null : 1,
      };
    await route.fulfill({ json: body });
  });
  await page.goto(`${origin}/feedback`);
  await page.getByText('证据样本', { exact: true }).waitFor();
  await page.getByText(entry.sample.text, { exact: true }).waitFor();
  await page.getByLabel('正常内容', { exact: true }).check();
  await page.getByLabel('模板家族 ID').fill('quoted-ad-warning');
  await page.getByLabel('否定', { exact: true }).check();
  await page.getByLabel('引用', { exact: true }).check();
  await page.getByLabel('复核依据').fill('引用广告并否定招揽，不是作者自己的广告。');
  await page.getByRole('button', { name: '保存复核', exact: true }).click();
  await page.getByText('已审：正常', { exact: true }).waitFor();
  assert.deepEqual(saved.tags.sort(), ['negation', 'quotation']);
  assert.equal(saved.verdict, 'normal');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出样本', exact: true }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
  assert.equal(exported.entries.length, 1);
  assert.equal(exported.entries[0].sample.text, entry.sample.text);
  assert.equal(exported.entries[0].verdict, 'normal');
  await page.screenshot({ path: '/tmp/feedsieve-sample-admin-094.png', fullPage: true });
  console.log(
    JSON.stringify({ scenario: 'admin-evidence-review-export', passed: true, productionWrites: 0 }),
  );
} finally {
  await browser.close();
  server.close();
}
