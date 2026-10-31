/**
 * 白名单（community/lists/whitelist.yaml）规则与发布 SQL 的单一事实源。
 * 原实现是 publish-community-whitelist.sh 里内嵌的一段 Python（行式解析 +
 * 规则校验 + SQL 生成），现统一为本模块，供：
 * - scripts/publish-whitelist-sql.mjs（CLI 薄包装，发布脚本调用）
 * - scripts/ingest-whitelist-issues.mjs（复用常量/上限；面向 Issue 提交者的
 *   报错文案独立保留，不用本模块的 Python 文案）
 *
 * 这是发布链（psql 直写 PostgreSQL + 快照触发），本文件是原 Python 的逐行忠实移植。
 * Python 与 JS 的语义差异全部用 py* 助手显式对齐，勿“顺手修正”：
 * - str.splitlines / str.strip 的字符集、len 的码点计数、str 的 repr、
 *   \d 的 Unicode Nd 语义，均与 JS 默认行为不同；
 * - 字段吸收顺序固定 name -> avatar_url -> note -> x_user_id，期望顺序之外
 *   的行按「期望新的 "- handle:" 条目」报错；
 * - 双引号在解析层被剥掉（双引号的拦截在 ingest 提交层）；
 * - generateWhitelistSql 的 options.sourceFile 会写进 SQL 头注释（原 Python
 *   取自 argv[1]），是逐字节等价的一部分。
 */

/** handle 规则：字母数字下划线 1-15 位（校验发生在 lower() 之后）。 */
export const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

/** x_user_id 规则：1-20 位十进制数字。Python \d 匹配 Unicode Nd 类，用 \p{Nd} 对齐。 */
export const USER_ID_RE = /^\p{Nd}{1,20}$/u;

/** avatar_url 只要求以该前缀开头（publish 层不做更严校验）。 */
export const AVATAR_PREFIX = 'https://pbs.twimg.com/profile_images/';

export const NOTE_MIN = 4;
export const NOTE_MAX = 240;
export const NAME_MIN = 1;
export const NAME_MAX = 40;

// ---- Python 语义助手 ----

/** Python str.splitlines()：按全量 Unicode 行边界切分；结尾换行不产生尾随空行。 */
// eslint-disable-next-line no-control-regex -- 对齐 Python splitlines 语义必须包含这些控制字符
const PY_LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;
export function pySplitLines(text) {
  if (text === '') return [];
  const parts = text.split(PY_LINE_BREAK);
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
}

// Python str.strip() 的空白字符集（含 \x1c-\x1f、\x85；不含 JS 特有的 \ufeff）
const PY_WS =
  '\t\n\x0b\x0c\r \x1c\x1d\x1e\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000';
const PY_STRIP_LEAD = new RegExp(`^[${PY_WS}]+`);
const PY_STRIP_TAIL = new RegExp(`[${PY_WS}]+$`);
/** Python str.strip()。 */
export function pyStrip(s) {
  return s.replace(PY_STRIP_LEAD, '').replace(PY_STRIP_TAIL, '');
}

/** Python .strip('"\'')：只剥首尾的引号字符（中间的不动）。 */
function pyStripQuotes(s) {
  return s.replace(/^["']+/, '').replace(/["']+$/, '');
}

/** Python len()：按 Unicode 码点计数（JS .length 按 UTF-16 单元，emoji 会翻倍）。 */
export function pyLen(s) {
  return [...s].length;
}

// Python str.isprintable() 的近似：C0/C1 控制、Zs（除空格）、Zl/Zp、常见 Cf
// 按不可打印转义；未收进来的码位一律按可打印直出（对 yaml 文本足够）。
function pyIsPrintable(cp) {
  if (cp === 0x20) return true;
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return false; // Cc
  if (cp === 0xa0 || cp === 0xad) return false;
  if (cp >= 0x600 && cp <= 0x605) return false; // Cf（阿拉伯数字符号等）
  if (cp === 0x61c || cp === 0x6dd || cp === 0x70f || cp === 0x8e2 || cp === 0x180e) return false;
  if (cp === 0x1680) return false;
  if (cp >= 0x2000 && cp <= 0x200a) return false; // Zs
  if (cp >= 0x200b && cp <= 0x200f) return false; // Cf（零宽/双向控制）
  if (cp >= 0x2028 && cp <= 0x202e) return false; // Zl/Zp/Cf
  if (cp >= 0x2060 && cp <= 0x2064) return false;
  if (cp >= 0x2066 && cp <= 0x206f) return false;
  if (cp === 0x202f || cp === 0x205f || cp === 0x3000) return false;
  if (cp >= 0xd800 && cp <= 0xdfff) return false; // 孤立代理
  if (cp === 0xfeff || (cp >= 0xfff9 && cp <= 0xfffb)) return false;
  return true;
}

/** Python repr()（str 版）：引号择取与 \x/\u/\U 转义，用于错误文案逐字对齐。 */
export function pyRepr(s) {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    if (ch === quote || ch === '\\') {
      out += `\\${ch}`;
      continue;
    }
    if (ch === '\n' || ch === '\r' || ch === '\t') {
      out += { '\n': '\\n', '\r': '\\r', '\t': '\\t' }[ch];
      continue;
    }
    const cp = ch.codePointAt(0);
    if (pyIsPrintable(cp)) out += ch;
    else if (cp <= 0xff) out += `\\x${cp.toString(16).padStart(2, '0')}`;
    else if (cp <= 0xffff) out += `\\u${cp.toString(16).padStart(4, '0')}`;
    else out += `\\U${cp.toString(16).padStart(8, '0')}`;
  }
  return `${out}${quote}`;
}

// ---- 解析 ----

/** 条目内字段吸收顺序（固定，勿改；publish 行格式以此为准）。 */
const FIELD_ORDER = ['name', 'avatar_url', 'note', 'x_user_id'];

/**
 * 逐行解析 whitelist.yaml。返回 { entries, errors }：
 * - errors 元素格式 `"{lineno}: {message}"`（lineno 1 起始）；
 * - entries 元素 { handle, note, name, avatar_url, x_user_id, line }，
 *   选填字段缺失为 null；即使有解析错误也会跑完全量规则校验并汇总。
 */
export function parseWhitelistYaml(text) {
  const lines = pySplitLines(text);
  const entries = [];
  const errors = [];
  const fail = (lineno, message) => errors.push(`${lineno}: ${message}`);

  let cur = null; // 正在构建的条目
  let expect = null; // 当前条目下一个待吸收字段
  let inEntries = false;

  for (let i = 0; i < lines.length; i++) {
    const lineno = i + 1;
    const stripped = pyStrip(lines[i]);
    if (!stripped || stripped.startsWith('#')) continue;
    if (stripped === 'entries:' || stripped === 'entries: []') {
      inEntries = true;
      continue;
    }
    if (!inEntries) {
      if (stripped.startsWith('schema_version:') || stripped.startsWith('updated_at:')) continue;
      fail(lineno, `未知顶层字段 ${pyRepr(stripped)}`);
      continue;
    }
    if (stripped.startsWith('- handle:')) {
      if (cur !== null && !cur.note) fail(cur.line, '条目缺少 note');
      cur = {
        handle: pyStripQuotes(pyStrip(stripped.slice('- handle:'.length))).replace(/^@+/, ''),
        note: '',
        name: null,
        avatar_url: null,
        x_user_id: null,
        line: lineno,
      };
      entries.push(cur);
      expect = FIELD_ORDER[0];
      continue;
    }
    if (cur !== null && expect !== null && stripped.startsWith(`${expect}:`)) {
      const value = pyStripQuotes(pyStrip(stripped.slice(expect.length + 1)));
      if (expect === 'note') cur.note = value;
      else if (value) cur[expect] = value;
      // 吸收完后不再接收条目内字段（顺序吸收，期望指针只前进）
      const idx = FIELD_ORDER.indexOf(expect);
      expect = idx + 1 < FIELD_ORDER.length ? FIELD_ORDER[idx + 1] : null;
      continue;
    }
    if (cur !== null && !cur.note) {
      fail(
        cur.line,
        `条目 ${pyRepr(cur.handle)} 缺少 note（字段顺序: - handle: / name: / avatar_url: / note: / x_user_id:）`,
      );
      cur = null;
      expect = null;
    }
    fail(lineno, `期望新的 "- handle:" 条目，实际 ${pyRepr(stripped)}`);
  }
  if (cur !== null && !cur.note) fail(cur.line, '条目缺少 note');

  const seen = new Set();
  for (const entry of entries) {
    const handle = entry.handle.toLowerCase();
    if (!HANDLE_RE.test(handle)) fail(entry.line, `handle 非法: ${pyRepr(entry.handle)}`);
    if (seen.has(handle)) fail(entry.line, `handle 重复: @${handle}`);
    seen.add(handle);
    const noteLen = pyLen(entry.note);
    if (!(NOTE_MIN <= noteLen && noteLen <= NOTE_MAX))
      fail(entry.line, `note 需 4-240 字（当前 ${noteLen}）`);
    if (entry.x_user_id !== null && !USER_ID_RE.test(entry.x_user_id)) {
      fail(entry.line, `x_user_id 非法: ${pyRepr(entry.x_user_id)}`);
    }
    const nameLen = pyLen(entry.name ?? '');
    if (entry.name !== null && !(NAME_MIN <= nameLen && nameLen <= NAME_MAX)) {
      fail(entry.line, `name 需 1-40 字: ${pyRepr(entry.name)}`);
    }
    if (entry.avatar_url !== null && !entry.avatar_url.startsWith(AVATAR_PREFIX)) {
      fail(entry.line, `avatar_url 必须是 pbs.twimg.com 公开头像: ${pyRepr(entry.avatar_url)}`);
    }
  }

  return { entries, errors };
}

// ---- SQL 生成 ----

/**
 * 生成发布到 PostgreSQL 的 SQL（psql 单事务执行）：先全量撤销（文件中删除的账号被撤销）+ 审计，再逐条
 * upsert + 审计；文件为唯一事实。同一输入输出逐字节相同。
 * - now：10 位 unix 秒（int(datetime.now(utc).timestamp())）；
 * - stamp：Python isoformat 形如 `2026-09-13T00:57:22.276295+00:00`（头注释）；
 * - sourceFile：写进头注释（原 Python 取自 argv[1]）。
 */
export function generateWhitelistSql(entries, { now, stamp, sourceFile }) {
  const esc = (s) => s.replaceAll("'", "''");
  const out = [
    `-- generated by publish-community-whitelist.sh from ${sourceFile}`,
    `-- ${entries.length} entries · ${stamp} · 文件为唯一事实，先全量撤销再 upsert`,
    // 先撤销：文件中已删除的账号从白名单移除（并记审计）
    `UPDATE maintainer_whitelist SET active = 0, updated_at = ${now} WHERE active = 1;`,
    `INSERT INTO maintainer_whitelist_audit (action, handle, note, created_at) SELECT 'remove', handle, note, ${now} FROM maintainer_whitelist WHERE active = 0 AND updated_at = ${now};`,
  ];
  for (const entry of entries) {
    const handle = entry.handle.toLowerCase();
    const note = esc(entry.note);
    const name = esc(entry.name || '');
    const avatarUrl = esc(entry.avatar_url || '');
    const xUserId = entry.x_user_id || '';
    const nameSql = name ? `'${name}'` : 'NULL';
    const avatarSql = avatarUrl ? `'${avatarUrl}'` : 'NULL';
    out.push(
      `INSERT INTO maintainer_whitelist (handle, x_user_id, name, avatar_url, note, active, created_at, updated_at) VALUES ('${handle}', ${xUserId ? `'${xUserId}'` : 'NULL'}, ${nameSql}, ${avatarSql}, '${note}', 1, ${now}, ${now}) ON CONFLICT(handle) DO UPDATE SET x_user_id = COALESCE(excluded.x_user_id, maintainer_whitelist.x_user_id), name = COALESCE(excluded.name, maintainer_whitelist.name), avatar_url = COALESCE(excluded.avatar_url, maintainer_whitelist.avatar_url), note = excluded.note, active = 1, updated_at = excluded.updated_at;`,
    );
    out.push(
      `INSERT INTO maintainer_whitelist_audit (action, handle, note, created_at) VALUES ('update', '${handle}', '${note}', ${now});`,
    );
  }
  return `${out.join('\n')}\n`;
}

// ---- 时间戳（SQL 头/行内时间字段的原格式） ----

/** 当前 unix 秒，等价 Python int(datetime.now(utc).timestamp())。 */
export function epochSeconds(date = new Date()) {
  return Math.floor(date.getTime() / 1000);
}

/**
 * Python datetime.now(timezone.utc).isoformat() 的等价格式：
 * `2026-09-13T00:57:22.276295+00:00`（微秒为 0 时省略小数部分）。
 * JS Date 只有毫秒精度，微秒部分补零到 6 位。
 */
export function utcIsoStamp(date = new Date()) {
  const iso = date.toISOString(); // 2026-09-13T00:57:22.276Z
  const micros = (date.getTime() % 1000) * 1000;
  const fraction = micros === 0 ? '' : `.${String(micros).padStart(6, '0')}`;
  return `${iso.slice(0, 19)}${fraction}+00:00`;
}
