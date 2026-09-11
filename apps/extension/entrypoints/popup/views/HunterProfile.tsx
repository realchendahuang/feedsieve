import { useEffect, useState } from 'react';
import {
  bindHunterEmail,
  fetchHunterProfile,
  saveHunterProfile,
  verifyHunterEmail,
  type HunterProfileState,
} from '../../../src/lib/community/hunter';
import { UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';
import { HelpIcon } from './shared';

/**
 * 猎手档案（打野 tab 页）：默认匿名上榜，验证一次邮箱解锁自定义昵称 / 简介 /
 * X handle（一次性绑定，之后免登录）。无密码无会话——安装 ID 即凭证。
 */
function bindErrorText(t: (typeof UI_COPY)[UiLanguage], error: string): string {
  switch (error) {
    case 'invalid_email':
      return t.hunterInvalidEmail;
    case 'too_many_code_requests':
      return t.hunterRateLimited;
    case 'mail_unconfigured':
      return t.hunterMailUnavailable;
    case 'too_many_attempts':
      return t.hunterTooManyAttempts;
    case 'invalid_or_expired_code':
      return t.hunterCodeInvalid;
    default:
      return t.hunterError;
  }
}

export default function HunterProfile({
  language,
  notify,
}: {
  language: UiLanguage;
  notify: (message: string | null) => void;
}) {
  const t = UI_COPY[language];
  const [profile, setProfile] = useState<HunterProfileState | null>(null);
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [xHandle, setXHandle] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchHunterProfile().then((value) => {
      if (!value) return;
      setProfile(value);
      setName(value.display_name ?? '');
      setBio(value.bio ?? '');
      setXHandle(value.x_handle ?? '');
    });
  }, []);

  async function sendCode(): Promise<void> {
    if (!email.trim() || busy) return;
    setBusy(true);
    try {
      const result = await bindHunterEmail(email.trim());
      if (!result.ok) {
        notify(bindErrorText(t, result.error));
        return;
      }
      if (!result.sent && result.dev_code) {
        // 部署侧未配置出站邮件（仅限开发环境）：码直接回填，便于自测
        setCode(result.dev_code);
      }
      setStage('code');
      notify(t.hunterCodeSent(email.trim()));
    } finally {
      setBusy(false);
    }
  }

  async function verify(): Promise<void> {
    if (!code.trim() || busy) return;
    setBusy(true);
    try {
      const result = await verifyHunterEmail(email.trim(), code.trim());
      if (!result.ok) {
        notify(bindErrorText(t, result.error ?? ''));
        return;
      }
      setProfile(await fetchHunterProfile());
      notify(t.hunterVerified);
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      // 去 @：用户习惯粘贴 @handle，X handle 存储不带 @
      const handle = xHandle.trim().replace(/^@+/, '');
      const result = await saveHunterProfile(name.trim(), bio.trim(), handle);
      notify(result.ok ? t.hunterProfileSaved : result.invalid ? t.hunterXHandleInvalid : t.hunterError);
      if (result.ok) setProfile(await fetchHunterProfile());
    } finally {
      setBusy(false);
    }
  }

  const verified = profile?.email_verified ?? false;
  return (
    <section className="settings-card">
      <div className="settings-card-head">
        <h2>{verified ? t.hunterSection : t.hunterClaimTitle}</h2>
        {verified ? null : <HelpIcon text={t.hunterClaimHelp} />}
      </div>
      <div className="settings-fields">
        {verified ? (
          <>
            <label className="setting-row">
              <span className="setting-copy">
                <strong>{t.hunterDisplayName}</strong>
              </span>
              <input
                type="text"
                value={name}
                maxLength={16}
                placeholder={t.hunterDisplayName}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="setting-row">
              <span className="setting-copy">
                <strong>{t.hunterBio}</strong>
              </span>
              <input
                type="text"
                value={bio}
                maxLength={60}
                placeholder={t.hunterBio}
                onChange={(event) => setBio(event.target.value)}
              />
            </label>
            <label className="setting-row">
              <span className="setting-copy">
                <strong>{t.hunterXHandle}</strong>
              </span>
              <input
                type="text"
                value={xHandle}
                maxLength={15}
                placeholder={t.hunterXHandle}
                onChange={(event) => setXHandle(event.target.value)}
              />
            </label>
            <button type="button" className="primary-action hunter-primary" onClick={() => void save()} disabled={busy}>
              {t.hunterSave}
            </button>
          </>
        ) : stage === 'email' ? (
          <>
            <div className="setting-block">
              <input
                type="email"
                value={email}
                placeholder={t.hunterEmailPlaceholder}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <button
              type="button"
              className="primary-action hunter-primary"
              onClick={() => void sendCode()}
              disabled={busy || !email.trim()}
            >
              {t.hunterSendCode}
            </button>
          </>
        ) : (
          <>
            <div className="setting-block">
              <input
                type="text"
                inputMode="numeric"
                value={code}
                maxLength={6}
                placeholder={t.hunterCodePlaceholder}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              />
            </div>
            <button type="button" className="primary-action hunter-primary" onClick={() => void verify()} disabled={busy}>
              {t.hunterVerify}
            </button>
            <button
              type="button"
              className="text-action"
              onClick={() => {
                setStage('email');
                setCode('');
              }}
            >
              {t.hunterChangeEmail}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
