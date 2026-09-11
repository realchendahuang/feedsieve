import { useEffect, useState } from 'react';
import {
  bindHunterEmail,
  fetchHunterProfile,
  saveHunterProfile,
  verifyHunterEmail,
  type HunterProfileState,
} from '../../../src/lib/community/hunter';
import { UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';

/**
 * 猎手档案（设置区）：默认匿名上榜，邮箱验证码解锁自定义昵称 / 一句话介绍。
 * 无密码无会话——安装 ID 即凭证，邮箱只用于发码。
 */
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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchHunterProfile().then((value) => {
      if (!value) return;
      setProfile(value);
      setName(value.display_name ?? '');
      setBio(value.bio ?? '');
    });
  }, []);

  async function sendCode(): Promise<void> {
    if (!email.trim() || busy) return;
    setBusy(true);
    try {
      const result = await bindHunterEmail(email.trim());
      if (!result.ok) {
        notify(t.hunterError);
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
      const ok = await verifyHunterEmail(email.trim(), code.trim());
      if (!ok) {
        notify(t.hunterError);
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
      const ok = await saveHunterProfile(name.trim(), bio.trim());
      notify(ok ? t.hunterProfileSaved : t.hunterError);
      if (ok) setProfile(await fetchHunterProfile());
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card">
      <div className="settings-card-head">
        <h2>{t.hunterSection}</h2>
      </div>
      <div className="settings-fields">
        {profile?.email_verified ? (
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
            <button type="button" className="text-action" onClick={() => void save()} disabled={busy}>
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
            <button type="button" className="text-action" onClick={() => void sendCode()} disabled={busy}>
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
            <button type="button" className="text-action" onClick={() => void verify()} disabled={busy}>
              {t.hunterVerify}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
