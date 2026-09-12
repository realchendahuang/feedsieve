import { useState } from 'react';
import {
  bindHunterEmail,
  saveHunterProfile,
  verifyHunterEmail,
  type HunterProfileState,
} from '../../../src/lib/community/hunter';
import { UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';
import { HelpIcon, AppIcon } from './shared';

/** 表单同步指纹：档案身份字段拼接，变化才覆写编辑态初值。 */
function profileKey(profile: HunterProfileState | null): string | null {
  return profile
    ? `${profile.email_verified}|${profile.display_name ?? ''}|${profile.bio ?? ''}|${profile.x_handle ?? ''}`
    : null;
}

/**
 * 个人资料卡（「我的」页）：昵称 / 简介 / X 账号随时可写可改（无需先绑定）；
 * 邮箱区负责绑定/换绑——绑定并验证后资料才展示到公开榜单（服务端口径一致）。
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

export default function HunterProfileCard({
  language,
  notify,
  profile,
  onChanged,
}: {
  language: UiLanguage;
  notify: (message: string | null) => void;
  profile: HunterProfileState | null;
  /** 档案变化（绑定/保存）后回调，父级刷新头部展示 */
  onChanged?: () => void;
}) {
  const t = UI_COPY[language];
  // null = 档案编辑态；'email'/'code' = 绑定（或换绑）流程
  const [stage, setStage] = useState<'email' | 'code' | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState(() => profile?.display_name ?? '');
  const [bio, setBio] = useState(() => profile?.bio ?? '');
  const [xHandle, setXHandle] = useState(() => profile?.x_handle ?? '');
  const [busy, setBusy] = useState(false);

  // 档案字段变化（绑邮箱 / 改名回来）时同步表单初值：render 期按上一值比较，
  // 用户正在输入的字段只有服务端值真正变化才被覆盖。
  const [syncedFrom, setSyncedFrom] = useState<string | null>(profileKey(profile));
  if (profile && profileKey(profile) !== syncedFrom) {
    setSyncedFrom(profileKey(profile));
    setName(profile.display_name ?? '');
    setBio(profile.bio ?? '');
    setXHandle(profile.x_handle ?? '');
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
      if (result.ok) {
        setStage(null);
        setCode('');
        notify(t.hunterVerified);
        onChanged?.();
        return;
      }
      notify(bindErrorText(t, result.error ?? ''));
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
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  const verified = profile?.email_verified ?? false;
  return (
    <section className="settings-card hunter-card" aria-label={t.hunterProfileLabel}>
      <input
        type="text"
        value={name}
        maxLength={16}
        placeholder={t.hunterDisplayName}
        aria-label={t.hunterDisplayName}
        onChange={(event) => setName(event.target.value)}
      />
      <input
        type="text"
        value={bio}
        maxLength={60}
        placeholder={t.hunterBio}
        aria-label={t.hunterBio}
        onChange={(event) => setBio(event.target.value)}
      />
      <input
        type="text"
        value={xHandle}
        maxLength={15}
        placeholder={t.hunterXHandle}
        aria-label={t.hunterXHandle}
        onChange={(event) => setXHandle(event.target.value)}
      />
      <button type="button" className="primary-action hunter-save" onClick={() => void save()} disabled={busy}>
        {t.hunterSave}
      </button>
      {verified ? (
        <div className="hunter-email-row">
          <AppIcon name="check" size={13} />
          <span className="hunter-email-state">{t.hunterVerified}</span>
          <button type="button" className="text-action" onClick={() => setStage('email')}>
            {t.hunterChangeEmail}
          </button>
        </div>
      ) : stage === null ? (
        <div className="hunter-email-bind-row">
          <button type="button" className="text-action hunter-email-bind" onClick={() => setStage('email')}>
            {t.hunterBindEmail}
          </button>
          <HelpIcon text={t.hunterEmailHint} />
        </div>
      ) : stage === 'email' ? (
        <div className="hunter-email-flow">
          <input
            type="email"
            value={email}
            placeholder={t.hunterEmailPlaceholder}
            aria-label={t.hunterEmailPlaceholder}
            onChange={(event) => setEmail(event.target.value)}
          />
          <div className="hunter-email-actions">
            <button
              type="button"
              className="primary-action hunter-save"
              onClick={() => void sendCode()}
              disabled={busy || !email.trim()}
            >
              {busy ? t.processing : t.hunterSendCode}
            </button>
            <button
              type="button"
              className="text-action"
              onClick={() => {
                setStage(null);
                setCode('');
              }}
            >
              {t.hunterClose}
            </button>
          </div>
        </div>
      ) : (
        <div className="hunter-email-flow">
          <input
            type="text"
            inputMode="numeric"
            value={code}
            maxLength={6}
            placeholder={t.hunterCodePlaceholder}
            aria-label={t.hunterCodePlaceholder}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          />
          <div className="hunter-email-actions">
            <button
              type="button"
              className="primary-action hunter-save"
              onClick={() => void verify()}
              disabled={busy}
            >
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
          </div>
        </div>
      )}
    </section>
  );
}
