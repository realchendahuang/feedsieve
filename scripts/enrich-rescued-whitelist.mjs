/**
 * 为抢救→推荐白名单候选补齐 X 公开资料（维护者本地手动跑）：
 * 找 whitelist.yaml 里 note 以「社区抢救入册」开头的候选条目，走 X guest 的
 * UserByScreenName 拉公开昵称/头像(400x400)/简介/数字 ID，原地改写该条目：
 * name/avatar_url/x_user_id 补上，note 换成真实简介（>240 截断、剥引号/反斜杠）；
 * 拉不到或简介过短的条目保持 canned 文案不动（脚本幂等，可重跑续拉）。
 *
 * 复用 prober.ts 的 guest 指纹与常量；1.3s/条礼貌限速，429 立即收摊。
 *
 * 用法：
 *   node scripts/enrich-rescued-whitelist.mjs --dry-run   # 只打印将回填的内容
 *   node scripts/enrich-rescued-whitelist.mjs             # 回填 whitelist.yaml
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/* global console, process, fetch, setTimeout */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE_FILE = 'community/lists/whitelist.yaml';
const CANNED_PREFIX = '社区抢救入册';
const USER_BY_SCREEN_NAME_QUERY_ID = '32pL5BWe9WKeSK1MoPvFQQ';
const USER_FEATURES = encodeURIComponent(
  '{"hidden_profile_subscriptions_enabled":false,"responsive_web_graphql_exclude_directive_enabled":true,"verified_phone_label_enabled":false,"subscriptions_verification_info_is_verified_enabled":false,"subscriptions_verification_info_verified_since_enabled":false,"creator_subscriptions_tweet_count_enabled":false,"highlights_tweets_tab_ui_enabled":true}',
);
const FIELD_TOGGLES = encodeURIComponent('{"withAuxiliaryUserLabels":false}');
const X_WEB_BEARER =
  'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

/** publish 解析器同款护栏：单行、剥引号/反斜杠、≤max 字 */
function sanitizeOneLine(value, max) {
  return value.replace(/\s+/g, ' ').trim().replace(/["\\]/g, '').slice(0, max).trim();
}

async function guestToken() {
  const res = await fetch('https://api.x.com/1.1/guest/activate.json', {
    method: 'POST',
    headers: {
      Authorization: X_WEB_BEARER,
      'x-client-transaction-id': '1',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
    },
  });
  if (!res.ok) throw new Error(`guest activate HTTP ${res.status}`);
  return (await res.json()).guest_token;
}

async function fetchProfile(handle, guest) {
  const variables = encodeURIComponent(JSON.stringify({ screen_name: handle, withSafetyModeUserFields: true }));
  const url =
    `https://x.com/i/api/graphql/${USER_BY_SCREEN_NAME_QUERY_ID}/UserByScreenName` +
    `?variables=${variables}&features=${USER_FEATURES}&fieldToggles=${FIELD_TOGGLES}`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: X_WEB_BEARER,
        'x-guest-token': guest,
        'x-twitter-active-user': 'yes',
        'x-twitter-client-language': 'en',
        'user-agent': 'Mozilla/5.0 (compatible; FeedSieve-listbot/1.0)',
      },
    });
  } catch {
    return null;
  }
  if (res.status === 429) throw new Error('x-guest-rate-limited');
  if (!res.ok) return null;
  let body;
  try {
    body = await res.json();
  } catch {
    return null;
  }
  const legacy = body.data?.user?.result?.legacy;
  if (!legacy?.screen_name) return null;
  return {
    restId: legacy.id_str ?? body.data.user.result.rest_id ?? null,
    name: sanitizeOneLine(legacy.name ?? '', 40),
    avatarUrl: legacy.profile_image_url_https
      ? legacy.profile_image_url_https.replace(/_(?:normal|bigger|mini)(\.\w+)$/, '_400x400$1')
      : null,
    bio: sanitizeOneLine(legacy.description ?? '', 240),
    handle: String(legacy.screen_name).toLowerCase(),
  };
}

/** 把 yaml 切成「注释行 + 条目行块」数组，返回可整体重写的条目块索引。 */
function entryBlockRange(lines, handle) {
  const start = lines.findIndex((line) => line === `  - handle: ${handle}`);
  if (start === -1) return null;
  let end = start + 1;
  while (
    end < lines.length &&
    lines[end].startsWith('    ') &&
    !lines[end].startsWith('  - handle:')
  ) {
    end += 1;
  }
  return [start, end];
}

export async function main({ dryRun = false } = {}) {
  const abs = path.join(ROOT, SOURCE_FILE);
  const yaml = readFileSync(abs, 'utf8');
  const lines = yaml.split('\n');

  // 候选 = note 以 canned 前缀开头的条目
  const rescues = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^ {2}- handle: ([\w-]+)$/.exec(lines[i] ?? '');
    if (!match) continue;
    const noteLine = lines.slice(i + 1).find((l) => l.startsWith('    note:'));
    const note = noteLine ? noteLine.slice(10).replace(/^"|"$/g, '') : '';
    if (note.startsWith(CANNED_PREFIX)) rescues.push({ handle: match[1], at: i });
    i += 1;
  }
  if (rescues.length === 0) {
    console.log('没有待补资料的抢救条目');
    return 0;
  }
  console.log(`待补资料 ${rescues.length} 条`);

  const guest = await guestToken();
  const pending = new Set(rescues.map((r) => r.handle));
  for (const { handle } of rescues) {
    let profile = null;
    try {
      profile = await fetchProfile(handle, guest);
    } catch (error) {
      if (String(error?.message).includes('x-guest-rate-limited')) {
        console.error('X guest 限流，本轮中断（已回填的保留，下次接着跑）');
        break;
      }
    }
    await sleep(1300);
    if (!profile || profile.handle !== handle.toLowerCase()) {
      console.log(`@${handle} 资料拉取失败/被改名，保留 canned note`);
      continue;
    }
    if (!dryRun) {
      const fields = [
        `  - handle: ${handle}`,
        ...(profile.name ? [`    name: "${profile.name}"`] : []),
        ...(profile.avatarUrl ? [`    avatar_url: "${profile.avatarUrl}"`] : []),
        // 4-241 字护栏：真实简介放 note；拉不到体面简介时保留 canned 行位置
        `    note: "${profile.bio.length >= 4 ? profile.bio : sanitizeOneLine(`${CANNED_PREFIX}（资料拉取中）`, 240)}"`,
        ...(profile.restId ? [`    x_user_id: "${profile.restId}"`] : []),
      ];
      const block = entryBlockRange(lines, handle);
      lines.splice(block[0], block[1] - block[0], ...fields);
    }
    pending.delete(handle);
    console.log(`@${handle} → ${profile.name || '(无昵称)'} · bio ${profile.bio.length} 字`);
  }
  if (!dryRun && pending.size !== rescues.length) writeFileSync(abs, lines.join('\n'));
  const changed = rescues.length - pending.size;
  console.log(dryRun ? `[dry] 预览 ${changed}/${rescues.length} 条` : `回填 ${changed}/${rescues.length} 条（${SOURCE_FILE}）——发布前跑 sh scripts/publish-community-whitelist.sh --check 校验 note 长度`);
  return changed;
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  await main({ dryRun: process.argv.includes('--dry-run') });
}
