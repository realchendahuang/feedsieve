import { describe, expect, it } from 'vitest';
import {
  applyDetectorConfigOverride,
  detectorConfig,
  validateDetectorConfigOverride,
} from './config';

describe('detector 运行时配置覆写', () => {
  it('内置值默认生效；reset 后与内置逐项一致', () => {
    applyDetectorConfigOverride(null);
    expect(detectorConfig.garbledHandle.minLetterRun).toBe(12);
    expect(detectorConfig.digitAnchorWeights.threshold).toBe(3);
  });

  it('合法覆写被接受且改动生效', () => {
    const ok = applyDetectorConfigOverride({ combo: { minNameEmoji: 4 } });
    expect(ok).toBe(true);
    expect(detectorConfig.combo.minNameEmoji).toBe(4);
    // 其余键保持内置
    expect(detectorConfig.wordSalad.maxTokens).toBe(9);
    applyDetectorConfigOverride(null);
    expect(detectorConfig.combo.minNameEmoji).toBe(2);
  });

  it('未知 section / key / 非整数 / 越界一律拒绝并整体回退', () => {
    const reject: unknown[] = [
      { unknown: { a: 1 } },
      { combo: { unknownKey: 1 } },
      { combo: { minNameEmoji: 1.5 } },
      { combo: { minNameEmoji: -1 } },
      { combo: { minNameEmoji: 99 } }, // > 4× 内置
      { wordSalad: { maxTokens: 1 } }, // < 0.25× 内置
      '{"garbledHandle":{"minLetterRun":8}}',
    ];
    for (const bad of reject) {
      expect(validateDetectorConfigOverride(bad as unknown)).toBe(false);
    }
    // 拒绝后回退内置，不留半套杂值
    const accepted = applyDetectorConfigOverride({ combo: { minNameEmoji: 99 } });
    expect(accepted).toBe(false);
    expect(detectorConfig.combo.minNameEmoji).toBe(2);
  });

  it('覆写引用保持稳定（heuristics 按引用取值）', () => {
    const ref = detectorConfig.wordSalad;
    applyDetectorConfigOverride({ wordSalad: { strongMinWords: 6 } });
    expect(detectorConfig.wordSalad).toBe(ref);
    expect(ref.strongMinWords).toBe(6);
    applyDetectorConfigOverride(null);
  });
});
