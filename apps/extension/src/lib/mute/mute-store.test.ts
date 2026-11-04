import { describe, expect, it } from 'vitest';
import {
  addMuteRule,
  DEFAULT_MUTE_SETTINGS,
  MAX_MUTE_RULES,
  mergeNativeMutes,
  normalizeMutePhrase,
  normalizeMuteSettings,
  removeMuteRule,
  replaceMuteRule,
  type MuteRule,
  type NativeMute,
} from './mute-store';

const native = (id: string, keyword: string): NativeMute => ({
  keyword,
  id,
  surfaces: ['home_timeline'],
  options: [],
  validUntil: null,
});

function rule(id: string, phrase: string, nativeId: string, createdAt = 1): MuteRule {
  return { id, phrase, nativeId, createdAt };
}

describe('静音词镜像与首次写入确认', () => {
  it('拒绝空词、单字和只有标点的词', () => {
    expect(normalizeMutePhrase('')).toBeNull();
    expect(normalizeMutePhrase('a')).toBeNull();
    expect(normalizeMutePhrase('!!!')).toBeNull();
    expect(normalizeMutePhrase('加微信')).toBe('加微信');
    expect(normalizeMutePhrase('free airdrop')).toBe('free airdrop');
  });

  it('默认未确认写入、没有任何词', () => {
    expect(DEFAULT_MUTE_SETTINGS).toEqual({ consented: false, rules: [] });
    expect(normalizeMuteSettings(undefined).consented).toBe(false);
    expect(normalizeMuteSettings({}).consented).toBe(false);
  });

  it('旧版存储：没有 X 词 id 的本地词丢弃，开过同步视为已确认', () => {
    const normalized = normalizeMuteSettings({
      nativeSync: true,
      rules: [
        { id: '1', phrase: '加微信' },
        { id: '2', phrase: '免费空投', nativeId: '11' },
        { id: '3', phrase: '免费空投', nativeId: '12' },
      ],
    });
    expect(normalized.consented).toBe(true);
    expect(normalized.rules.map((entry) => [entry.phrase, entry.nativeId])).toEqual([
      ['免费空投', '11'],
    ]);
  });

  it('用 X 列表对齐镜像：补新词、保留本地 id、删掉 X 端已删的词', () => {
    const initial = {
      consented: true,
      rules: [rule('a', '加微信', '11'), rule('b', '刷单', '12')],
    };
    const merged = mergeNativeMutes(initial, [native('11', '加微信'), native('13', '空投领取')]);
    expect(merged.imported).toBe(1);
    expect(merged.removed).toBe(1);
    expect(merged.settings.rules.map((entry) => entry.phrase)).toEqual(['加微信', '空投领取']);
    expect(merged.settings.rules[0]?.id).toBe('a');
    expect(merged.settings.consented).toBe(true);
  });

  it('新增去重、限量，并放在列表最前', () => {
    const first = addMuteRule({ consented: true, rules: [] }, native('11', '加微信'), 5);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.settings.rules[0]).toMatchObject({ phrase: '加微信', nativeId: '11', createdAt: 5 });

    const duplicate = addMuteRule(first.settings, native('12', '加微信'));
    expect(duplicate).toEqual({ ok: false, code: 'duplicate' });

    const full = {
      consented: true,
      rules: Array.from({ length: MAX_MUTE_RULES }, (_, index) => rule(String(index), `词${index}`, String(index))),
    };
    expect(addMuteRule(full, native('999', '新词'))).toEqual({ ok: false, code: 'limit' });
  });

  it('编辑用替换保持原 id 与创建时间', () => {
    const settings = { consented: true, rules: [rule('a', '加微信', '11', 3)] };
    const next = replaceMuteRule(settings, 'a', native('21', '加 V'), 9);
    expect(next.rules[0]).toMatchObject({ id: 'a', phrase: '加 V', nativeId: '21', createdAt: 3 });
  });

  it('删除只移除指定条目', () => {
    const settings = { consented: true, rules: [rule('a', '加微信', '11'), rule('b', '刷单', '12')] };
    expect(removeMuteRule(settings, 'a').rules.map((entry) => entry.phrase)).toEqual(['刷单']);
  });
});
