/**
 * 推荐白名单 Issue 拉取（维护者本地手动跑，无定时、无 PR、无 CI）：
 * 把带 `whitelist-request` 标签的申请 issue 解析、校验、去重后**直接写进本地
 * community/lists/whitelist.yaml**，同时给 issue 回帖并打 `whitelist-ingested` 标签。
 * 自动化红线：绝不自动拉取、绝不自动提交入库——此文件是「永不标注」的强豁免名单，
 * 最终收录人是仓库所有者：跑完看 yaml diff，确认后再亲手跑
 * scripts/publish-community-whitelist.sh（D1 写入，发布即生效）。
 *
 * 解析/校验规则与 publish-community-whitelist.sh 的内嵌校验器完全同口径
 * （handle 正则 / note 4-240 单行 / name 1-40 / avatar 仅 pbs.twimg.com /
 * x_user_id 数字），生成行格式也一致（publish 脚本行解析吃的格式）。
 *
 * 用法（需要 gh CLI 登录仓库所有者账号）：
 *   node scripts/ingest-whitelist-issues.mjs --dry-run   # 只评估，不改文件不评论
 *   node scripts/ingest-whitelist-issues.mjs             # 拉取 + 写 yaml + 已处理 issue 打标/回帖
 */
import { execFileSync } from 'node:child_process';
/* global console, process */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE_FILE = 'community/lists/whitelist.yaml';
const SOURCE_LABEL = 'whitelist-request';
const INGESTED_LABEL = 'whitelist-ingested';

// GitHub issue 表单正文的小标题（与 .github/ISSUE_TEMPLATE/whitelist-request.yml 的 label 严格对应）
export const FIELD_LABELS = {
  handle: 'X 账号 handle',
  name: '显示昵称',
  avatarUrl: 'X 公开头像链接',
  note: '入册说明 / 简介',
  xUserId: 'X 数字 ID',
};

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const USER_ID_RE = /^[0-9]{1,20}$/;
const AVATAR_RE = /^https:\/\/pbs\.twimg\.com\/profile_images\/[\w\-./]+$/;

/** 解析 issue 表单正文：按 `### 小标题` 切段，取每段正文。 */
export function parseIssueBody(body) {
  const sections = {};
  for (const block of String(body).split(/^### /m).slice(1)) {
    const nl = block.indexOf('\n');
    if (nl < 0) continue;
    sections[block.slice(0, nl).trim()] = block.slice(nl + 1).trim();
  }
  return sections;
}

/**
 * 把一份申请正文收敛成合规条目；返回 { ok: true, entry } 或 { ok: false, errors }。
 * note 折行折叠成单行（publish 解析器只吃单行）。
 */
export function normalizeEntry(body) {
  const sections = parseIssueBody(body);
  const val = (key) => (sections[FIELD_LABELS[key]] ?? '').replace(/\s+/g, ' ').trim();
  const errors = [];

  const handle = val('handle').replace(/^@/, '').toLowerCase();
  if (!HANDLE_RE.test(handle)) errors.push(`handle 非法：「${val('handle')}」（字母数字下划线 1-15 位）`);

  const note = val('note');
  if (!(4 <= note.length && note.length <= 240)) errors.push(`入册说明需 4-240 字（当前 ${note.length} 字）`);

  const name = val('name') || null;
  if (name && !(1 <= name.length && name.length <= 40)) errors.push('显示昵称需 1-40 字');

  const avatarUrl = val('avatarUrl') || null;
  if (avatarUrl && !AVATAR_RE.test(avatarUrl)) errors.push('头像必须是 pbs.twimg.com/profile_images/ 开头的公开链接');

  const xUserId = val('xUserId') || null;
  if (xUserId && !USER_ID_RE.test(xUserId)) errors.push('X 数字 ID 必须是纯数字');

  // 双引号会破坏 publish 解析器的行格式；字段名用中文回显
  for (const [k, v] of Object.entries({ handle, note, name, avatar_url: avatarUrl, x_user_id: xUserId })) {
    if (v != null && /["\\]/.test(v)) errors.push(`「${FIELD_LABELS[k] ?? k}」不能包含引号或反斜杠`);
  }
  if (errors.length > 0) return { ok: false, errors };

  const entry = { handle, note };
  if (name) entry.name = name;
  if (avatarUrl) entry.avatar_url = avatarUrl;
  if (xUserId) entry.x_user_id = xUserId;
  return { ok: true, entry };
}

/** 生成与 publish-community-whitelist.sh 兼容的条目 YAML 块（字段顺序固定）。 */
export function entryBlock(entry) {
  const lines = [`  - handle: ${entry.handle}`];
  if (entry.name) lines.push(`    name: "${entry.name}"`);
  if (entry.avatar_url) lines.push(`    avatar_url: "${entry.avatar_url}"`);
  lines.push(`    note: "${entry.note}"`);
  if (entry.x_user_id) lines.push(`    x_user_id: "${entry.x_user_id}"`);
  return lines.join('\n');
}

/** yaml 里已存在的 handle（小写）。 */
function existingHandles(yaml) {
  const out = new Set();
  for (const match of yaml.matchAll(/^\s*- handle:\s*"?@?([\w-]+)"?\s*$/gm)) {
    out.add(match[1].toLowerCase());
  }
  return out;
}

function gh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', ...opts }).toString().trim();
}

/**
 * 主流程：拉当前合规 Issue → 写进本地 whitelist.yaml → 你看 diff →
 * `sh scripts/publish-community-whitelist.sh` 才真正进 D1（发布仍亲手执行）。
 */
export async function run({ dryRun = false } = {}) {
  gh(['label', 'create', SOURCE_LABEL, '--force', '--repo', ghRepo(), '--description', '推荐白名单申请（维护者手动拉取评审）']);

  const issues = JSON.parse(
    gh(['issue', 'list', '--repo', ghRepo(), '--state', 'open', '--label', SOURCE_LABEL, '--json', 'number,title,body,labels']),
  ).filter((issue) => !issue.labels.some((l) => l.name === INGESTED_LABEL));

  const abs = path.join(ROOT, SOURCE_FILE);
  const yaml = readFileSync(abs, 'utf8');
  const taken = existingHandles(yaml);

  const invalid = [];
  const duplicates = [];
  const pending = [];

  for (const issue of issues) {
    const result = normalizeEntry(issue.body);
    if (!result.ok) {
      invalid.push({ issue, errors: result.errors });
      continue;
    }
    if (taken.has(result.entry.handle)) {
      duplicates.push({ issue, handle: result.entry.handle });
      continue;
    }
    taken.add(result.entry.handle);
    pending.push({ issue, entry: result.entry });
  }

  if (dryRun) {
    for (const { issue, entry } of pending) console.log(`[dry] #${issue.number} + @${entry.handle} · ${entry.note}`);
    for (const { issue, handle } of duplicates) console.log(`[dry] #${issue.number} 已在名单：@${handle}`);
    for (const { issue, errors } of invalid) console.log(`[dry] #${issue.number} 不合规：${errors.join('；')}`);
    return { pending, invalid, duplicates, fileChanged: false };
  }

  // 不合规与重复：回帖说明并打标终结，这两类不写 yaml
  for (const { issue, handle } of duplicates) {
    gh(['issue', 'comment', String(issue.number), '--repo', ghRepo(), '--body', `提出的 @${handle} 已在推荐白名单里，无需重复申请。`]);
    gh(['issue', 'edit', String(issue.number), '--repo', ghRepo(), '--add-label', INGESTED_LABEL]);
  }
  for (const { issue, errors } of invalid) {
    gh(['issue', 'comment', String(issue.number), '--repo', ghRepo(), '--body', `申请暂不合规，请修正后重新提交：\n${errors.map((e) => `- ${e}`).join('\n')}`]);
  }

  if (pending.length === 0) return { pending, invalid, duplicates, fileChanged: false };

  // 追加到本地 whitelist.yaml（easy check：条目尾注引用 issue 编号）；不 commit、不开 PR、不推远端
  const block = pending
    .map((p) => `# 来自 issue #${p.issue.number}\n${entryBlock(p.entry)}`)
    .join('\n');
  const yamlTail = yaml.replace(/\s*$/, '');
  writeFileSync(abs, `${yamlTail}\n${block}\n`);
  for (const { issue } of pending) {
    gh(['issue', 'comment', String(issue.number), '--repo', ghRepo(), '--body', '已由维护者拉取写入发版候选（推荐白名单）。发布即生效，届时扩展与公示页同时更新。']);
    gh(['issue', 'edit', String(issue.number), '--repo', ghRepo(), '--add-label', INGESTED_LABEL]);
  }
  return { pending, invalid, duplicates, fileChanged: true };
}

function ghRepo() {
  if (!ghRepo.cache) ghRepo.cache = process.env.GITHUB_REPOSITORY || gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
  return ghRepo.cache;
}

// 直接执行才跑主流程；只认无参（发布拉取）与 --dry-run（预评估）两种调用
if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== '--dry-run')) {
    console.error('usage: node scripts/ingest-whitelist-issues.mjs [--dry-run]');
    process.exit(1);
  }
  const out = await run({ dryRun: args.includes('--dry-run') });
  console.log(
    JSON.stringify({
      added: out.pending.map((p) => ({ issue: p.issue.number, handle: p.entry.handle })),
      invalid: out.invalid.map((i) => ({ issue: i.issue.number, errors: i.errors })),
      duplicates: out.duplicates.map((d) => ({ issue: d.issue.number, handle: d.handle })),
      fileChanged: out.fileChanged,
    }),
    null,
    2,
  );
}
