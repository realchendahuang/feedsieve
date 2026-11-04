/**
 * AI 味的显示设置：遇到 AI 号怎么处理、识别范围、要不要标已关注账号。
 *
 * 和「黄推水军」的设置一样收在齿轮页里——弹窗的 AI 味页只留结论和「我测过的」。
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
    mode: '遇到 AI 号',
    modeHint:
      '已进社区 AI 号名单、或你测出 AI 味偏重的账号，在评论区和时间线上怎么显示。个人白名单里的账号不处理。',
    modes: { off: '不处理', mark: '标记', fold: '折叠' },
    scope: '识别范围',
    scopeHint: '「仅蓝V」按页面上的认证标记判断，不影响黄推识别。',
    scopes: { all: '全部', blue: '仅蓝V', skipBlue: '跳过蓝V' },
    markFollowing: '标记已关注账号',
    markFollowingHint:
      '默认关：不把检测结论贴到你关注的人身上。打开后已关注账号也照常标记 / 折叠；个人白名单仍然不处理。',
  },
  en: {
    mode: 'AI accounts',
    modeHint:
      'How accounts on the community AI list, or ones you found AI-heavy, show up in replies and timelines. Personal allowlisted accounts are left alone.',
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

  async function update(patch: Partial<AiCheckSettings>): Promise<void> {
    setSettings(await setAiSettings(patch));
  }

  return (
    <section className="group">
      <Row label={c.mode} hint={c.modeHint}>
        <div className="segmented" role="radiogroup" aria-label={c.mode}>
          {(['off', 'mark', 'fold'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={settings.mode === mode}
              className={settings.mode === mode ? 'is-selected' : ''}
              onClick={() => void update({ mode })}
            >
              {c.modes[mode]}
            </button>
          ))}
        </div>
      </Row>
      <Row label={c.scope} hint={c.scopeHint}>
        <div className="segmented" role="radiogroup" aria-label={c.scope}>
          {(['all', 'blue', 'skipBlue'] as const).map((scope) => (
            <button
              key={scope}
              type="button"
              role="radio"
              aria-checked={settings.scope === scope}
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
          onChange={(next) => void update({ markFollowing: next })}
        />
      </Row>
    </section>
  );
}
