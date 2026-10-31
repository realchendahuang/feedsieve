/** Jev 调用 + 节奏 + 判定（冒烟脚本用，口径同 eval-ai-accounts.mjs / evidence.ts）。 */

const DECISION = { strong: 0.65, weak: 0.5, suspect: 0.45, fast: 0.6, maxShort: 0.05, maxCv: 0.45 };

export function decide(p, r) {
  if (p >= DECISION.strong) return 'ai';
  if (
    p >= DECISION.weak &&
    r.fast >= DECISION.fast &&
    r.short <= DECISION.maxShort &&
    r.cv <= DECISION.maxCv
  )
    return 'ai';
  return p >= DECISION.suspect ? 'suspect' : 'human';
}

/** 直接从已配对的 replies + gaps 算节奏（本地 DOM 版，不依赖 TikHub timeline）。 */
export function rhythmFromReplies(replies, gaps) {
  const lens = replies.map(
    (r) =>
      [
        ...r.text
          .replace(/^(@\w+\s+)+/, '')
          .replace(/https:\/\/t\.co\/\S+/g, '')
          .trim(),
      ].length,
  );
  const n = Math.max(lens.length, 1);
  const mean = lens.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(lens.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  return {
    fast: gaps.filter((g) => g <= 90).length / Math.max(gaps.length, 1),
    short: lens.filter((v) => v <= 6).length / n,
    cv: mean ? sd / mean : 0,
  };
}

export async function judge(replies, gaps, questions, key) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'jev-latest',
        state: { replies, reply_gaps_seconds: gaps },
        questions,
      }),
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.answers?.ai_account) {
      return {
        p: json.answers.ai_account.noul,
        tokens: json.usage?.input_tokens ?? 0,
        model: json.model ?? null,
      };
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`jev ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  }
}
