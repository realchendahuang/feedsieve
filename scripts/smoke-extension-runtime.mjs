/** Real MV3 cold-start and recovery acceptance. Requires: pnpm exec playwright install chromium */
import { chromium } from 'playwright';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const source = resolve('apps/extension/.output/chrome-mv3');
const manifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'));
assert(
  !(manifest.web_accessible_resources ?? []).some((e) =>
    e.resources.some((p) => p.includes('community') || p === '*' || p === '**'),
  ),
);
const fixture = (handle, text, name = '测试用户') =>
  `<div data-testid="cellInnerDiv" id="${handle}"><article data-testid="tweet"><div data-testid="User-Name"><a href="/${handle}"><span>${name}</span></a><a href="/${handle}"><span>@${handle}</span></a></div><a href="/${handle}/status/1720000000000000000"><time>now</time></a><div data-testid="tweetText">${text}</div><div role="group"><button data-testid="like">Like</button></div></article></div>`;

const familyFixture = [
  // Candidate intentionally comes before seeds to verify retrospective rescanning.
  fixture('sarahcase', '她太涩了qy 我真顶不住 <a href="/belly308">@belly308</a> 2o', 'Sarah Sam'),
  fixture('sarahnocase', '这条广告说“她太涩了qy 我真顶不住 @belly308 2o”，不要相信', '普通博主'),
  fixture('vinokascase', '她太涩了jl 我真顶不住 <a href="/kkilyc">@kkilyc</a> 2w', 'vinokas'),
  fixture(
    'minnesotacase',
    '她太涩了rc 我真顶不住 <a href="/belly308">@belly308</a> 9f',
    'Minnesota Skinny',
  ),
  fixture('vpnnormalcase', 'proton从昨天开始就进不去了…还有什么加速器推荐么', '普通用户'),
  fixture('regenacase', '那一夜你没有拒绝我😨 🙄不是人机', 'Regena Lawing'),
  fixture('cletacase', '那一夜你👆没有拒绝我😁 🧒不是人机 1789266426152', '粉色❤️ 兔女郎'),
  fixture('hollycase', '那一夜你👆没有拒绝我🤝🏻 💪不是人机 7 🌲', '娇妻媚儿（❤️想找单男看我简介🍑'),
  fixture(
    'lisandracase',
    '那一夜你👆没有拒绝我😁 🧒不是人机 🌲 😚',
    '冰冰🈷️（大三学生🍓真实约见👌',
  ),
  fixture(
    'aldocase',
    't我果👆然太涩了💞😎 有人想锐评一下我的福嘛 - 3',
    '线下🈷️舞蹈学院球球想🈷️看简介🍑',
  ),
  fixture(
    'leahcase',
    '玩归玩闹归闹🗣️👩‍给你看福👆我不开玩笑 0 m q',
    '真实🈷️幂幂（腰软 🈷️主人看简介🍑',
  ),
  fixture('lyriccase', '“那一夜你没有拒绝我不是人机”', '普通博主'),
  fixture('cosplaycase', '今天排练准备参加学校的动漫社活动', '粉色❤️兔女郎'),
].join('');

async function run(degraded, remoteCached = false) {
  const temp = mkdtempSync(join(tmpdir(), 'feedsieve-mv3-'));
  const extension = join(temp, 'extension');
  cpSync(source, extension, { recursive: true });
  const variantPath = join(extension, 'community/keyword-packs/variant-tables.json');
  const variants = readFileSync(variantPath);
  if (degraded) rmSync(variantPath);
  const context = await chromium.launchPersistentContext(join(temp, 'profile'), {
    channel: 'chromium',
    headless: true,
    // Block external networking from process launch, including onInstalled SW fetches.
    proxy: { server: 'http://127.0.0.1:9' },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await context.setOffline(true);
    await worker.evaluate(async () => {
      // eslint-disable-next-line no-undef
      await chrome.storage.local.clear();
    });
    if (remoteCached) {
      const body = readFileSync(join(extension, 'community/keyword-packs/official.json'), 'utf8');
      await worker.evaluate(async (body) => {
        // eslint-disable-next-line no-undef
        await chrome.storage.local.set({
          keywordPacksSnapshotV2: {
            pack_version: JSON.parse(body).pack_version,
            body,
            synced_at: Date.now(),
          },
        });
      }, body);
    }
    await context.route('https://x.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><html><body><main>${fixture('literalcase', '全国空降')}${fixture('variantcase', '全國空降')}${fixture('screenshotcase', '应该没人比我👆玩的开了吧🍇🛶我福不黑不信你看 1789266318520')}${fixture('normalcase', '今天去公园散步，天气很好。')}${familyFixture}</main></body></html>`,
      }),
    );
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto('https://x.com/home');
    await page
      .waitForSelector('#literalcase .fs-badge', { timeout: 30_000 })
      .catch(async (error) => {
        console.error('Content errors:', errors);
        console.error('Fixture DOM:', await page.content());
        throw error;
      });
    if (degraded) {
      // Rules must work while variant loading fails. Restore the file without reloading X.
      assert(errors.some((e) => e.includes('变体表加载失败')));
      assert.equal(await page.locator('#variantcase .fs-badge').count(), 0);
      writeFileSync(variantPath, variants);
    }
    await page.waitForSelector('#variantcase .fs-badge', { timeout: 30_000 });
    await page.waitForSelector('#screenshotcase .fs-badge');
    assert.equal(await page.locator('#normalcase .fs-badge').count(), 0);
    for (const handle of ['hollycase', 'lisandracase', 'aldocase', 'leahcase', 'cletacase']) {
      await page.waitForSelector(`#${handle} .fs-badge`);
    }
    for (const handle of ['lyriccase', 'cosplaycase']) {
      assert.equal(await page.locator(`#${handle} .fs-badge`).count(), 0);
    }
    // Withdrawing one source must remove the inferred candidate, not just prevent future hits.
    await worker.evaluate(async () => {
      // eslint-disable-next-line no-undef
      await chrome.storage.local.set({ allowlist: [{ handle: 'hollycase', addedAt: Date.now() }] });
    });
    await page.waitForSelector('#hollycase .fs-badge', { state: 'detached' });
    await page.waitForSelector('#cletacase .fs-badge', { state: 'detached' });
    await page.waitForSelector('#regenacase .fs-badge', { state: 'detached' });
    await worker.evaluate(async () => {
      // eslint-disable-next-line no-undef
      await chrome.storage.local.set({ allowlist: [] });
    });
    await page.waitForSelector('#cletacase .fs-badge');
    await page.waitForSelector('#regenacase .fs-badge');
    await page.waitForSelector('#sarahcase .fs-badge');
    await page.waitForSelector('#vinokascase .fs-badge');
    await page.waitForSelector('#minnesotacase .fs-badge');
    assert.equal(await page.locator('#vpnnormalcase .fs-badge').count(), 0);
    assert.equal(await page.locator('#sarahnocase .fs-badge').count(), 0);
    // A real explicit correction must preserve the marked article in the offline outbox.
    await page.locator('#aldocase .fs-allow').click();
    await page.waitForSelector('#aldocase .fs-badge', { state: 'detached' });
    const samples = await worker.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const data = await chrome.storage.local.get(null);
      return Object.entries(data)
        .filter(([k]) => k.startsWith('trainingSamplePending:'))
        .map(([, v]) => v);
    });
    assert.equal(samples.length, 1);
    assert.equal(samples[0].action, 'false-positive');
    assert.equal(samples[0].handle, 'aldocase');
    assert.equal(samples[0].displayName, '线下🈷️舞蹈学院球球想🈷️看简介🍑');
    assert.equal(samples[0].text, 't我果👆然太涩了💞😎 有人想锐评一下我的福嘛 - 3');
    assert.equal(samples[0].detection.ruleId, 'keyword:profile:adult-invitation');
    assert.equal(samples[0].clientVersion, manifest.version);
    assert(samples[0].catalogVersion);

    const stored = await worker.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const values = await chrome.storage.local.get(null);
      return {
        keys: Object.keys(values),
        bundles: Object.entries(values)
          .filter(([k]) => k.startsWith('bundledData:'))
          .map(([key, v]) => ({ key, version: v.version })),
      };
    });
    assert.equal(stored.bundles.length, remoteCached ? 2 : 3);
    assert(stored.bundles.every((v) => v.version === manifest.version));
    assert(
      stored.keys.includes('keywordPacksSnapshotV2') === remoteCached,
      'Offline bundle must not masquerade as remote sync',
    );
    assert(
      !stored.keys.includes('communitySnapshotV2'),
      'Offline bundle must not masquerade as remote sync',
    );
    await page.reload();
    await page.waitForSelector('#variantcase .fs-badge');
    await page.waitForSelector('#screenshotcase .fs-badge');
    assert.equal(await page.locator('#normalcase .fs-badge').count(), 0);
    console.log(
      JSON.stringify({
        scenario: remoteCached
          ? 'remote-cache-without-settings'
          : degraded
            ? 'missing-variant-recovery'
            : 'offline-cold-and-warm-start',
        version: manifest.version,
        bundles: stored.bundles,
        passed: true,
      }),
    );
  } finally {
    await context.close();
    rmSync(temp, { recursive: true, force: true });
  }
}
await run(false);
await run(true);

await run(false, true);
