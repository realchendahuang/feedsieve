/**
 * 伪人的显示设置：遇到伪人怎么处理、识别范围、要不要标已关注账号。
 *
 * 和「水军」的设置一样收在齿轮页里——弹窗的伪人页只留结论和「我测过的」。
 */
import { useEffect, useState } from 'react';
import type { UiLanguage } from '../../../../src/lib/platform/i18n';
import {
  getAiSettings,
  setAiSettings,
  type AiCheckSettings,
} from '../../../../src/lib/ai-check/client';
import { Row, Toggle } from '../shared';

const COPY = {
  zh: {
    mode: '遇到伪人',
    modeHint:
      '已进社区伪人名单、或你自己测出像 AI 代写的账号，在评论区和时间线上怎么显示。个人白名单里的账号不处理。批量屏蔽在伪人页。',
    modes: { off: '不处理', mark: '标记', fold: '折叠' },
    scope: '识别范围',
    scopeHint: '「仅蓝标」按页面上的认证标记判断，不影响水军识别。',
    scopes: { all: '全部', blue: '仅蓝标', skipBlue: '跳过蓝标' },
    markFollowing: '标记已关注账号',
    markFollowingHint:
      '默认关：不把检测结论贴到你关注的人身上。打开后已关注账号也照常标记 / 折叠；个人白名单仍然不处理。',
  },
  en: {
    mode: 'AI accounts',
    modeHint:
      'How accounts on the community AI list, or ones you found AI-heavy, show up in replies and timelines. Personal allowlisted accounts are left alone. Batch blocking lives on the AI page.',
    modes: { off: 'Ignore', mark: 'Mark', fold: 'Fold' },
    scope: 'Scope',
    scopeHint: '“Blue only” uses the verified badge on the page. Spam detection is unaffected.',
    scopes: { all: 'All', blue: 'Blue only', skipBlue: 'Skip blue' },
    markFollowing: 'Mark followed accounts',
    markFollowingHint:
      'Off by default: results are not shown on accounts you follow. Turning it on marks or folds them too; your personal allowlist is still skipped.',
  },
} as const;

export function AiDisplaySettings({ language }: { language: UiLanguage }) {
  const c = COPY[language];
  const [settings, setSettings] = useState<AiCheckSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void getAiSettings()
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!settings) return null;

  // 连点两个选项会各发一次写；串行化并在写入期间禁用，落盘的永远是最后一次点选。
  async function update(patch: Partial<AiCheckSettings>): Promise<void> {
    setSaving(true);
    try {
      setSettings(await setAiSettings(patch));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="group">
      <Row label={c.mode} hint={c.modeHint}>
        <div className="segmented" role="group" aria-label={c.mode}>
          {(['off', 'mark', 'fold'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={settings.mode === mode}
              disabled={saving}
              className={settings.mode === mode ? 'is-selected' : ''}
              onClick={() => void update({ mode })}
            >
              {c.modes[mode]}
            </button>
          ))}
        </div>
      </Row>
      <Row label={c.scope} hint={c.scopeHint}>
        <div className="segmented" role="group" aria-label={c.scope}>
          {(['all', 'blue', 'skipBlue'] as const).map((scope) => (
            <button
              key={scope}
              type="button"
              aria-pressed={settings.scope === scope}
              disabled={saving}
              className={settings.scope === scope ? 'is-selected' : ''}
              onClick={() => void update({ scope })}
            >
              {c.scopes[scope]}
            </button>
          ))}
        </div>
      </Row>
      <Row label={c.markFollowing} hint={c.markFollowingHint}>
        <Toggle
          checked={settings.markFollowing}
          label={c.markFollowing}
          disabled={saving}
          onChange={(next) => void update({ markFollowing: next })}
        />
      </Row>
    </section>
  );
}
