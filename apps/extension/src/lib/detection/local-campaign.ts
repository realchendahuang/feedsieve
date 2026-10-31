/** Per-page, bounded evidence association. Inferred matches can never become seeds. */
export const LOCAL_CAMPAIGN_RULE_ID = 'keyword:profile:local-campaign';
const MAX_TEMPLATES = 512;
const MAX_AUTHORS = 64;
const TTL_MS = 15 * 60 * 1000;

export function campaignTemplate(text: string, normalize: (s: string) => string): string | null {
  if (text.length > 4096) return null;
  // Strip numeric noise before confusable folding (which can map 1 to l).
  const key = normalize(text.normalize('NFKC').replace(/\p{N}/gu, ''))
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[\p{N}\p{P}\p{S}\s]/gu, '');
  // Short expressions/lyrics are common; keep a conservative exact-template floor.
  return key.length >= 12 && key.length <= 240 ? key : null;
}
export function hasLongNumericPayload(text: string): boolean {
  const plain = text
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/(?<=\d)[\s\p{P}\p{S}]*(?=\d)/gu, '');
  return /(?<![\d.])\d{11,}(?![\d.])/.test(plain);
}
/** Corroboration only; neither signal establishes a direct seed or standalone spam label. */
export function campaignCandidateSignal(
  text: string,
  normalize: (s: string) => string,
): 'long-numeric-payload' | 'anti-bot-claim' | null {
  if (text.length > 4096) return null;
  if (hasLongNumericPayload(text)) return 'long-numeric-payload';
  // Quoting or discussing a spam claim is not making that claim.
  if (/[“”「」『』«»"‘’]/u.test(text)) return null;
  const compact = normalize(text).replace(/[\p{P}\p{S}\s]/gu, '');
  if (/歌词|引用|这句话|这段话|话术|广告|垃圾|举报|反诈|骗子|别信|不要信|谎称|自称/.test(compact))
    return null;
  return /不是(?:人机|机器人)[a-z0-9]{0,16}$/u.test(compact) ? 'anti-bot-claim' : null;
}
interface Family {
  at: number;
  authors: Map<string, boolean>;
}
export class LocalCampaignIndex {
  private families = new Map<string, Family>();
  constructor(
    private normalize: (s: string) => string,
    private now = () => Date.now(),
  ) {}
  clear(): void {
    this.families.clear();
  }
  observe(handle: string, text: string, directSeed: boolean): string[] {
    const key = campaignTemplate(text, this.normalize);
    if (!key) return [];
    let family = this.families.get(key);
    if (!family || this.now() - family.at > TTL_MS) {
      family = { at: this.now(), authors: new Map() };
      this.families.delete(key);
      this.families.set(key, family);
      if (this.families.size > MAX_TEMPLATES)
        this.families.delete(this.families.keys().next().value!);
    }
    const author = handle.toLowerCase();
    if (!family.authors.has(author) && family.authors.size >= MAX_AUTHORS) return [];
    const before = [...family.authors.values()].filter(Boolean).length;
    family.authors.set(author, directSeed);
    const after = [...family.authors.values()].filter(Boolean).length;
    return before < 2 !== after < 2 ? [...family.authors.keys()] : [];
  }
  match(handle: string, text: string, trusted: (handle: string) => boolean): number {
    if (!campaignCandidateSignal(text, this.normalize)) return 0;
    const key = campaignTemplate(text, this.normalize);
    const family = key ? this.families.get(key) : undefined;
    if (!family || this.now() - family.at > TTL_MS) return 0;
    const seeds = [...family.authors].filter(
      ([author, direct]) => direct && author !== handle.toLowerCase() && trusted(author),
    );
    return seeds.length >= 2 ? seeds.length : 0;
  }
}
