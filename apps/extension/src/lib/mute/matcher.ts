/**
 * 静音词的匹配器（纯函数，供内容脚本和单测共用）。
 *
 * 规则刻意保持简单、可预期：
 * - 英文/数字短语整词匹配，避免静音 `AI` 时误伤 `said`、`Adulthood`；
 * - `#话题` / `@用户名` 按带前缀的整词匹配；
 * - 中文、日文、韩文和混合短语按「去掉空白、标点、符号后的子串」匹配，
 *   能命中「同 城 约」「原神，启动」这类写法；
 * - 只做字面匹配，不支持正则，避免用户写出跑满主线程的表达式。
 */

export interface MuteMatcherRule {
  id: string;
  phrase: string;
  enabled: boolean;
  validUntil?: string | null;
}

export interface CompiledMuteRule {
  id: string;
  phrase: string;
  ascii: RegExp | null;
  compact: string;
}

const MAX_TEXT_LENGTH = 4_000;
const ZERO_WIDTH_RE = /[\u200b-\u200d\u2060\ufeff\u00ad]/g;

/** 统一大小写、全半角、零宽字符和连续空白。 */
export function normalizeMuteText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(ZERO_WIDTH_RE, '')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** 用于中日韩匹配的紧凑形式：去掉空白、标点和符号。 */
function compactMuteText(value: string): string {
  return normalizeMuteText(value).replace(/[\p{P}\p{S}\s]+/gu, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function asciiWordRegExp(phrase: string): RegExp | null {
  const normalized = normalizeMuteText(phrase);
  if (!normalized || /[\u0080-\uffff]/.test(normalized)) return null;
  if (normalized.startsWith('#') || normalized.startsWith('@')) {
    const body = escapeRegExp(normalized);
    return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, 'i');
  }
  if (!/^[a-z0-9][a-z0-9'&\-\s]*$/.test(normalized)) return null;
  const body = normalized
    .split(/\s+/)
    .filter(Boolean)
    .map(escapeRegExp)
    .join('\\W+');
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, 'i');
}

export function compileMuteRule(rule: MuteMatcherRule): CompiledMuteRule | null {
  const phrase = rule.phrase.trim();
  if (!phrase) return null;
  const compact = compactMuteText(phrase);
  const ascii = asciiWordRegExp(phrase);
  if (!ascii && !compact) return null;
  return { id: rule.id, phrase, ascii, compact };
}

export function compileMuteRules(rules: readonly MuteMatcherRule[]): CompiledMuteRule[] {
  const compiled: CompiledMuteRule[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const matcher = compileMuteRule(rule);
    if (matcher) compiled.push(matcher);
  }
  return compiled;
}

/** 命中第一条规则；没有命中返回 null。 */
export function matchMuteRules(
  rules: readonly CompiledMuteRule[],
  text: string,
): CompiledMuteRule | null {
  const plain = normalizeMuteText(text.slice(0, MAX_TEXT_LENGTH));
  if (!plain) return null;
  let compact: string | null = null;
  for (const rule of rules) {
    if (rule.ascii) {
      if (rule.ascii.test(plain)) return rule;
      continue;
    }
    compact ??= compactMuteText(plain);
    if (rule.compact && compact.includes(rule.compact)) return rule;
  }
  return null;
}
