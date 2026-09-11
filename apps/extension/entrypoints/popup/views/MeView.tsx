import { useCallback, useEffect, useState } from 'react';
import {
  fetchHunterBoard,
  fetchHunterProfile,
  type HunterBoard,
  type HunterProfileState,
} from '../../../src/lib/community/hunter';
import type { CommunitySettings } from '../../../src/lib/community/community-store';
import type { MarkStrength } from '@feedsieve/community-lists';
import { UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';
import { getInstallationId } from '../../../src/lib/community/contribute';
import { AppIcon } from './shared';
import HunterProfileModal from './HunterProfile';
import SettingsView from './SettingsView';

/**
 * 「我的」一级入口：最外层是个人主页（昵称 / 称号 / 简介 / X 账号 / 认领状态 /
 * 安装 ID），编辑资料走弹窗；设置降为二级页，齿轮进入。
 */
export default function MeView({
  language,
  notify,
  community,
  onUpdateCommunity,
  onLanguageChange,
  onSyncCommunity,
}: {
  language: UiLanguage;
  notify: (message: string | null) => void;
  community: CommunitySettings | null;
  onUpdateCommunity: (patch: {
    enabled?: boolean;
    autoContribute?: boolean;
    strength?: MarkStrength;
  }) => Promise<unknown>;
  onLanguageChange: (next: UiLanguage) => void;
  onSyncCommunity: () => Promise<void>;
}) {
  const t = UI_COPY[language];
  const [profile, setProfile] = useState<HunterProfileState | null>(null);
  const [board, setBoard] = useState<HunterBoard | null>(null);
  const [installId, setInstallId] = useState('');
  const [sub, setSub] = useState<'home' | 'settings'>('home');
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  useEffect(() => {
    void fetchHunterProfile().then(setProfile);
    void fetchHunterBoard().then(setBoard).catch(() => setBoard(null));
    void getInstallationId().then(setInstallId);
  }, []);

  const refreshProfile = useCallback(() => {
    void fetchHunterProfile().then(setProfile);
  }, []);

  const verified = profile?.email_verified ?? false;
  const me = board?.me ?? null;
  // 未认领时 fallback 成榜上的默认名（猎手#XXXXXX），没有榜单数据则占位
  const name = (verified ? profile?.display_name : null) || me?.name || '—';
  const xHandle = profile?.x_handle ?? me?.x_handle ?? null;

  async function copyInstallationId(): Promise<void> {
    try {
      await navigator.clipboard.writeText(installId);
      notify(t.copiedId);
    } catch {
      notify(t.copyFailed);
    }
  }

  if (sub === 'settings') {
    return (
      <div className="view-stack settings-view">
        <div className="me-subhead">
          <button type="button" className="text-action me-back" onClick={() => setSub('home')}>
            ‹ {t.goBack}
          </button>
          <strong>{t.settingsTitle}</strong>
        </div>
        <SettingsView
          language={language}
          notify={notify}
          community={community}
          onUpdateCommunity={onUpdateCommunity}
          onLanguageChange={onLanguageChange}
          onSyncCommunity={onSyncCommunity}
        />
      </div>
    );
  }

  return (
    <div className="view-stack settings-view">
      <section className="settings-card me-card">
        <button type="button" className="me-gear" onClick={() => setSub('settings')} aria-label={t.settingsTitle}>
          <AppIcon name="settings" size={18} />
        </button>
        <div className="me-hero">
          <span className="me-avatar" aria-hidden="true">
            <AppIcon name="hunt" size={22} />
          </span>
          <div className="me-hero-body">
            <div className="me-name-line">
              <span className="me-name">{name}</span>
              {me?.tier ? <span className="hunter-tier">{me.tier}</span> : null}
              {me?.title ? <span className="hunter-title-badge">{me.title}</span> : null}
            </div>
            {profile?.bio ? <span className="me-bio">{profile.bio}</span> : null}
            {xHandle ? <span className="me-handle">@{xHandle}</span> : null}
          </div>
        </div>
        <button
          type="button"
          className="primary-action me-primary"
          onClick={() => setProfileModalOpen(true)}
        >
          {verified ? t.hunterProfileLabel : t.hunterClaimTitle}
        </button>
        <div className="me-meta">
          <span className={verified ? 'me-chip ok' : 'me-chip'}>
            {verified ? t.verifiedChip : t.hunterNotClaimed}
          </span>
          <button type="button" className="me-chip" title={installId} onClick={() => void copyInstallationId()}>
            <span aria-hidden="true">{t.hunterSection}ID</span>
            <span className="me-id-value">{installId || '…'}</span>
          </button>
        </div>
      </section>

      <HunterProfileModal
        language={language}
        open={profileModalOpen}
        notify={notify}
        onClose={() => setProfileModalOpen(false)}
        onChanged={refreshProfile}
      />
    </div>
  );
}
