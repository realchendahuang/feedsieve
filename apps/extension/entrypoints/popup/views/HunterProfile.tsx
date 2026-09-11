import { useEffect, useState } from 'react';
import {
  bindHunterEmail,
  fetchHunterProfile,
  saveHunterProfile,
  verifyHunterEmail,
  type HunterProfileState,
} from '../../../src/lib/community/hunter';
import { UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';
import { AppIcon } from './shared';

/**
 * 个人资料弹窗（设置页入口）：未验证 = 邮箱认领（验证码一次性绑定）；
 * 已验证 = 编辑昵称 / 一句话简介 / X handle，保存即上新榜（打野榜展示 bio）。
 * 无密码无会话——安装 ID 即凭证，绑定后免登录。
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

export default function HunterProfileModal({
  language,
  open,
  notify,
  onClose,
  onChanged,
}: {
  language: UiLanguage;
  open: boolean;
  notify: (message: string | null) => void;
  onClose: () => void;
  /** 档案变化（绑定/保存）后回调，父级可刷新列表行展示 */
  onChanged?: () => void;
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
    if (!open) return;
    void fetchHunterProfile().then((value) => {
      if (!value) return;
      setProfile(value);
      setName(value.display_name ?? '');
      setBio(value.bio ?? '');
      setXHandle(value.x_handle ?? '');
    });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close 仅用 setState，无需入 deps
  }, [open]);

  function close(): void {
    onClose();
    setStage('email');
    setCode('');
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
      notify(t.hunterVerified);
      onChanged?.();
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
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  const verified = profile?.email_verified ?? false;
  return (
    <div className="hunter-modal-overlay" onClick={close}>
      <div
        className="hunter-modal"
        role="dialog"
        aria-modal="true"
        aria-label={verified ? t.hunterSection : t.hunterClaimTitle}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="hunter-modal-head">
          <h2>{verified ? t.hunterSection : t.hunterClaimTitle}</h2>
          <button type="button" className="square-action" onClick={close} aria-label={t.hunterClose}>
            <AppIcon name="x" size={18} />
          </button>
        </div>
        {verified ? (
          <>
            <input
              type="text"
              value={name}
              maxLength={16}
              placeholder={t.hunterDisplayName}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              type="text"
              value={bio}
              maxLength={60}
              placeholder={t.hunterBio}
              onChange={(event) => setBio(event.target.value)}
            />
            <input
              type="text"
              value={xHandle}
              maxLength={15}
              placeholder={t.hunterXHandle}
              onChange={(event) => setXHandle(event.target.value)}
            />
            <button type="button" className="primary-action" onClick={() => void save()} disabled={busy}>
              {t.hunterSave}
            </button>
          </>
        ) : stage === 'email' ? (
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
              {busy ? t.processing : t.hunterSendCode}
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
              {busy ? t.processing : t.hunterVerify}
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
  );
}
