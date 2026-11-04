import { describe, expect, it } from 'vitest';
import {
  addMuteRule,
  DEFAULT_MUTE_SETTINGS,
  MAX_MUTE_RULES,
  mergeNativeMutes,
  normalizeMutePhrase,
  normalizeMuteSettings,
  normalizeNativeMute,
  removeMuteRule,
  renameMuteRule,
  type MuteSettings,
} from './mute-store';

const settings = (): MuteSettings => ({ ...DEFAULT_MUTE_SETTINGS, rules: [] });

describe('屏蔽词规则存储', () => {
  it('拒绝空词、单字和只有标点的词', () => {
    expect(normalizeMutePhrase('')).toBeNull();
    expect(normalizeMutePhrase('a')).toBeNull();
    expect(normalizeMutePhrase('!!!')).toBeNull();
    expect(normalizeMutePhrase('加微信')).toBe('加微信');
    expect(normalizeMutePhrase('free airdrop')).toBe('free airdrop');
  });

  it('添加时去重、限量，并放在列表最前', () => {
    const first = addMuteRule(settings(), '加微信', { now: 1 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.settings.rules[0]?.phrase).toBe('加微信');

    const duplicate = addMuteRule(first.settings, '加微信');
    expect(duplicate).toEqual({ ok: false, code: 'duplicate' });

    const full = {
      ...settings(),
      rules: Array.from({ length: MAX_MUTE_RULES }, (_, index) => ({
        id: String(index),
        phrase: `词${index}`,
        enabled: true,
        origin: 'local' as const,
        syncState: 'local' as const,
        createdAt: index,
      })),
    };
    expect(addMuteRule(full, '新词')).toEqual({ ok: false, code: 'limit' });
  });

  it('归一化存储时丢弃非法词、去重并限制数量', () => {
    const normalized = normalizeMuteSettings({
      enabled: false,
      nativeSync: true,
      rules: [
        { id: '1', phrase: '加微信' },
        { id: '2', phrase: '加微信' },
        { id: '3', phrase: '!!!' },
        { id: '4', phrase: 'free airdrop', nativeId: '9' },
      ],
    });
    expect(normalized.enabled).toBe(false);
    expect(normalized.nativeSync).toBe(true);
    expect(normalized.rules.map((rule) => rule.phrase)).toEqual(['加微信', 'free airdrop']);
    expect(normalized.rules[1]?.syncState).toBe('synced');
  });

  it('删除只移除指定规则', () => {
    const current = addMuteRule(settings(), '加微信', { now: 1 });
    if (!current.ok) return;
    const next = addMuteRule(current.settings, '加V', { now: 2 });
    if (!next.ok) return;
    expect(removeMuteRule(next.settings, current.rule.id).rules.map((rule) => rule.phrase)).toEqual([
      '加V',
    ]);
  });

  it('改名校验长度和重复，但允许把词改回原文', () => {
    const first = addMuteRule(settings(), '加微信', { now: 1 });
    if (!first.ok) return;
    const second = addMuteRule(first.settings, '加V', { now: 2 });
    if (!second.ok) return;

    expect(renameMuteRule(second.settings, first.rule.id, 'a')).toEqual({
      ok: false,
      code: 'invalid',
    });
    expect(renameMuteRule(second.settings, first.rule.id, '加V')).toEqual({
      ok: false,
      code: 'duplicate',
    });
    expect(renameMuteRule(second.settings, 'missing', '新词')).toEqual({
      ok: false,
      code: 'invalid',
    });

    const renamed = renameMuteRule(second.settings, first.rule.id, '领福利');
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.rule.phrase).toBe('领福利');
    expect(renamed.settings.rules.map((rule) => rule.phrase)).toEqual(['加V', '领福利']);
    // 同一个词存回自己不算重复
    expect(renameMuteRule(renamed.settings, first.rule.id, '领福利').ok).toBe(true);
  });

  it('合并原生静音词：导入、关联、缺失回退本地、过期跳过', () => {
    const base = addMuteRule(settings(), '加微信', { now: 1 });
    if (!base.ok) return;
    const withNative = addMuteRule(base.settings, 'free airdrop', { now: 2 });
    if (!withNative.ok) return;
    const linked = {
      ...withNative.settings,
      rules: withNative.settings.rules.map((rule) =>
        rule.phrase === 'free airdrop' ? { ...rule, nativeId: '42', syncState: 'synced' as const } : rule,
      ),
    };
    const merged = mergeNativeMutes(
      linked,
      [
        {
          keyword: '加微信',
          id: '41',
          surfaces: ['home_timeline'],
          options: [],
          validUntil: null,
        },
        {
          keyword: '过期词',
          id: '43',
          surfaces: [],
          options: [],
          validUntil: '2020-01-01T00:00:00.000Z',
        },
      ],
      Date.UTC(2026, 10, 1),
    );
    expect(merged.imported).toBe(0);
    expect(merged.linked).toBe(1);
    expect(merged.settings.rules.find((rule) => rule.phrase === '加微信')?.nativeId).toBe('41');
    // free airdrop 的 nativeId 42 不在原生列表里：退回本地，不删词
    expect(merged.settings.rules.find((rule) => rule.phrase === 'free airdrop')).toMatchObject({
      nativeId: undefined,
      syncState: 'local',
    });
    expect(merged.settings.rules.some((rule) => rule.phrase === '过期词')).toBe(false);
  });

  it('解析原生静音词字段', () => {
    expect(
      normalizeNativeMute({
        keyword: '加微信',
        id: '1',
        mute_surfaces: ['home_timeline', 'notifications'],
        mute_options: ['exclude_following_accounts'],
        valid_until: null,
      }),
    ).toEqual({
      keyword: '加微信',
      id: '1',
      surfaces: ['home_timeline', 'notifications'],
      options: ['exclude_following_accounts'],
      validUntil: null,
    });
    expect(normalizeNativeMute({ keyword: '', id: '1' })).toBeNull();
  });
});
