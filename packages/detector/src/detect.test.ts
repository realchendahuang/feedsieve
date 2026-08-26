import { describe, expect, it } from 'vitest';
import { detectByHandleList, normalizeHandle } from './detect';

const SEED_LIST = new Set(['spamking88', 'crypto_teacher']);

describe('normalizeHandle', () => {
  it('strips @ prefix and lowercases', () => {
    expect(normalizeHandle('@SpamKing88')).toBe('spamking88');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeHandle('   ')).toBe('');
  });
});

describe('detectByHandleList', () => {
  it('marks list hits with an explainable reason', () => {
    const result = detectByHandleList('@SpamKing88', SEED_LIST);
    expect(result).not.toBeNull();
    expect(result?.marked).toBe(true);
    expect(result?.source).toBe('community-list');
    expect(result?.reason.length).toBeGreaterThan(0);
    expect(result?.handle).toBe('spamking88');
  });

  it('passes clean handles through as null', () => {
    expect(detectByHandleList('kim', SEED_LIST)).toBeNull();
  });

  it('rejects empty input', () => {
    expect(detectByHandleList('', SEED_LIST)).toBeNull();
    expect(detectByHandleList('@', SEED_LIST)).toBeNull();
  });
});
