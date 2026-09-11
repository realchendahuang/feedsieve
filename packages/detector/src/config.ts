/**
 * 判定参数集中配置（计分制基座：引擎与证据分离）。
 *
 * 分层换血纪律（见 docs/ARCHITECTURE.md §6.1）：本文件只是**天级**层的内置
 * 兜底值；线上热更版随签名词库包的 `detector_config` 段下发（小时级节奏），
 * 由消费端（extension keyword-packs 同步）在严格校验后覆写。校验失败或
 * 缺省一律回退内置值——引擎代码（heuristics 的解释器逻辑）不随参数发版。
 *
 * 乱码批量号锚点：纯字母段 + 尾缀数字容忍两征。
 * 数字形态批量号锚点：子信号求和制，阈下不成立。
 */
export const DETECTOR_CONFIG = {
  garbledHandle: {
    /** 连续纯小写字母的最短段长（真人姓名上不设限或加数字尾缀都达不到）。 */
    minLetterRun: 12,
    /** 段尾允许的数字位数（ohbfwzyzopkkt2 型批次变体的最小修正面）。 */
    trailingDigits: 2,
    rareLetterCount: 2,
    maxConsonantRun: 4,
  },
  digitAnchorWeights: {
    digitCluster5: 2,
    alternation: 3,
    digitRatio: 1,
    minLength12: 1,
    noVowelLetters: 2,
    threshold: 3,
  },
  wordSalad: {
    minTokens: 5,
    maxTokens: 9,
    /** 强证据：≥ strongMinWords 个英文词 + ≥1 个 emoji（经典单词沙拉）。 */
    strongMinWords: 4,
    /** 弱证据：只在组合层参与佐证，永不单独定案。 */
    weakMinTokens: 4,
    weakMinWords: 2,
    weakMinSymbols: 2,
    weakMaxTokens: 12,
  },
  combo: {
    minNameEmoji: 2,
  },
} as const;

type MutableConfig = {
  -readonly [K in keyof typeof DETECTOR_CONFIG]: {
    -readonly [P in keyof (typeof DETECTOR_CONFIG)[K]]: number;
  };
};

/**
 * 运行时活动配置：heuristics 与弱信号组合层全部从这里取值。
 * 覆写必须通过 applyDetectorConfigOverride（原地改写，引用保持稳定），
 * 消费端每轮词库同步后调用；缺省/非法回退内置，绝不散存垃圾值。
 */
export const detectorConfig: MutableConfig = {
  garbledHandle: { ...DETECTOR_CONFIG.garbledHandle },
  digitAnchorWeights: { ...DETECTOR_CONFIG.digitAnchorWeights },
  wordSalad: { ...DETECTOR_CONFIG.wordSalad },
  combo: { ...DETECTOR_CONFIG.combo },
};

const SECTION_KEYS: Record<keyof typeof DETECTOR_CONFIG, readonly string[]> = {
  garbledHandle: ['minLetterRun', 'trailingDigits', 'rareLetterCount', 'maxConsonantRun'],
  digitAnchorWeights: [
    'digitCluster5',
    'alternation',
    'digitRatio',
    'minLength12',
    'noVowelLetters',
    'threshold',
  ],
  wordSalad: [
    'minTokens',
    'maxTokens',
    'strongMinWords',
    'weakMinTokens',
    'weakMinWords',
    'weakMinSymbols',
    'weakMaxTokens',
  ],
  combo: ['minNameEmoji'],
};

/**
 * 远端覆写白名单校验：只接受已知 section / key，只收有界非负整数
 * （[0.25×, 4×] 内置值，至少 1）；任何未知 key 或越界都拒绝整份覆写——
 * 宁可保持内置参数，也不要半套未知来源的杂值。
 */
export function validateDetectorConfigOverride(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }
  for (const [section, values] of Object.entries(raw as Record<string, unknown>)) {
    if (!(section in DETECTOR_CONFIG)) {
      return false;
    }
    const allowed = SECTION_KEYS[section as keyof typeof DETECTOR_CONFIG];
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return false;
    }
    for (const [key, value] of Object.entries(values)) {
      if (!allowed.includes(key)) return false;
      const def =
        (DETECTOR_CONFIG as Record<string, Record<string, number> | undefined>)[section]?.[key] ?? 0;
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        !Number.isInteger(value) ||
        value < 0 ||
        value < Math.max(1, Math.floor(def / 4)) ||
        value > Math.max(4, def * 4)
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * 应用校验后的覆写（就地修改）；校验失败或传 null 时整体回退内置值。
 * 返回是否被接受（false = 已重置为内置）。
 */
export function applyDetectorConfigOverride(raw: unknown): boolean {
  const reset = (): void => {
    for (const [section, values] of Object.entries(DETECTOR_CONFIG)) {
      Object.assign(detectorConfig[section as keyof typeof DETECTOR_CONFIG] as object, values);
    }
  };
  if (raw != null && validateDetectorConfigOverride(raw)) {
    for (const [section, values] of Object.entries(raw as Record<string, unknown>)) {
      Object.assign(
        detectorConfig[section as keyof typeof DETECTOR_CONFIG] as object,
        values as Record<string, number>,
      );
    }
    return true;
  }
  reset();
  return false;
}

/** 明确回退内置值（词库包删除了 config 段的等价语义）。 */
export function resetDetectorConfigOverride(): void {
  applyDetectorConfigOverride(null);
}
