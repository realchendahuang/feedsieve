import { useEffect, useState } from 'react';
import {
  bindHunterEmail,
  fetchHunterProfile,
  saveHunterProfile,
  verifyHunterEmail,
  type HunterProfileState,
} from '../../../src/lib/community/hunter';
import { UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';
import { AppIcon, HelpIcon } from './shared';

/**
 * 猎手档案（打野 tab 页）：默认匿名上榜，「认领身份」走弹窗完成邮箱验证
 * （一次性绑定，之后免登录）；已验证后档案编辑平铺在卡内。
 * 无密码无会话——安装 ID 即凭证。
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
  const [claimOpen, setClaimOpen] = useState(false);
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

  useEffect(() => {
    if (!claimOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeClaim();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [claimOpen]);

  function closeClaim(): void {
    setClaimOpen(false);
    setStage('email');
  }

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
      closeClaim();
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
    <>
      <section className="settings-card">
        <div className="settings-card-head">
          <h2>{verified ? t.hunterSection : t.hunterClaimTitle}</h2>
          {verified ? null : <HelpIcon text={t.hunterClaimHelp} />}
        </div>
        {verified ? (
          <div className="settings-fields">
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
          </div>
        ) : (
          <button
            type="button"
            className="primary-action hunter-primary"
            onClick={() => setClaimOpen(true)}
          >
            {t.hunterClaimStart}
          </button>
        )}
      </section>

      {claimOpen ? (
        <div className="hunter-modal-overlay" onClick={closeClaim}>
          <div
            className="hunter-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t.hunterClaimTitle}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="hunter-modal-head">
              <h2>{t.hunterClaimTitle}</h2>
              <button type="button" className="square-action" onClick={closeClaim} aria-label={t.hunterClose}>
                <AppIcon name="x" size={18} />
              </button>
            </div>
            {stage === 'email' ? (
              <>
                <input
                  type="email"
                  value={email}
                  placeholder={t.hunterEmailPlaceholder}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => void sendCode()}
                  disabled={busy || !email.trim()}
                >
                  {t.hunterSendCode}
                </button>
              </>
            ) : (
              <>
                <input
                  type="text"
                  inputMode="numeric"
                  value={code}
                  maxLength={6}
                  placeholder={t.hunterCodePlaceholder}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                />
                <button type="button" className="primary-action" onClick={() => void verify()} disabled={busy}>
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
        </div>
      ) : null}
    </>
  );
}
