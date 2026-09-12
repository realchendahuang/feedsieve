import { useCallback, useEffect, useState } from 'react';
import {
  fetchHunterBoard,
  fetchHunterProfile,
  type HunterBoard,
  type HunterProfileState,
} from '../../../src/lib/community/hunter';
import type { CommunitySettings } from '../../../src/lib/community/community-store';
import type { MarkStrength } from '@feedsieve/community-lists';
import { getTodayStat, subscribeDaily, todayKey } from '../../../src/lib/stats/daily-stats';
import {
  loadSafetyLedger,
  remainingQuota,
  rolloverBudget,
  subscribeSafetyLedger,
} from '../../../src/lib/queue/block-safety';
import { UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';
import { getInstallationId } from '../../../src/lib/community/contribute';
import { AppIcon } from './shared';
import HunterProfileCard from './HunterProfile';
import SettingsView from './SettingsView';

/**
 * 「我的」页面：身份头部（昵称 / 称号 / 简介 / X 账号 / 猎手 ID）、当前战绩、
 * 个人资料编辑（邮箱 / 简介 / X 随时可写可改）。设置是这里的二级页，
 * 点进才展开，与身份/战绩不在一屏。
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
  const [todayBlocked, setTodayBlocked] = useState<number | null>(null);
  const [bullets, setBullets] = useState<{ left: number; total: number } | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    void fetchHunterProfile().then(setProfile);
    void fetchHunterBoard().then(setBoard).catch(() => setBoard(null));
    void getInstallationId().then(setInstallId);
    void getTodayStat().then((stat) => setTodayBlocked(stat.blocked));
    const applyLedger = (): void => {
      void loadSafetyLedger().then((ledger) => {
        const rolled = rolloverBudget(ledger, Date.now());
        setBullets({ left: remainingQuota(rolled, Date.now()), total: rolled.budget });
      });
    };
    applyLedger();
    const unsubs = [
      subscribeDaily((stats) => setTodayBlocked(stats.days[todayKey()]?.blocked ?? 0)),
      subscribeSafetyLedger(() => applyLedger()),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  const refreshProfile = useCallback(() => {
    void fetchHunterProfile().then(setProfile);
    void fetchHunterBoard().then(setBoard).catch(() => setBoard(null));
  }, []);

  const verified = profile?.email_verified ?? false;
  const me = board?.me ?? null;
  // 未认领且未上榜时没有可展示的名字，用弱化的「未认领」占位（资料卡紧随其下）
  const name = (verified && profile?.display_name) || me?.name || null;
  const xHandle = profile?.x_handle ?? me?.x_handle ?? null;
  const shortId = installId ? `${installId.slice(0, 8)}…${installId.slice(-4)}` : '…';
  // 打败百分比 = 1 - 本周排名/总人数；垫底就是 0%，不虚报
  const beatenPct =
    me?.rank && board && board.total > 0
      ? Math.max(0, Math.round((1 - me.rank / board.total) * 100))
      : null;

  async function copyInstallationId(): Promise<void> {
    try {
      await navigator.clipboard.writeText(installId);
      notify(t.copiedId);
    } catch {
      notify(t.copyFailed);
    }
  }

  if (showSettings) {
    return (
      <div className="view-stack me-subboard">
        <div className="subpage-head">
          <button type="button" className="subpage-back" onClick={() => setShowSettings(false)}>
            <span className="subpage-back-arrow" aria-hidden="true">
              ‹
            </span>
            <span>{t.goBack}</span>
          </button>
          <h2>{t.settings}</h2>
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
    <div className="view-stack me-view">
      <section className="settings-card me-card">
        <div className="me-hero">
          <span className="me-avatar" aria-hidden="true">
            <AppIcon name="hunt" size={22} />
          </span>
          <div className="me-hero-body">
            <div className="me-name-line">
              {name ? (
                <span className="me-name">{name}</span>
              ) : (
                <span className="me-name is-placeholder">{t.hunterNotClaimed}</span>
              )}
              {me?.tier ? <span className="hunter-tier">{me.tier}</span> : null}
              {me?.title ? <span className="hunter-title-badge">{me.title}</span> : null}
            </div>
            {profile?.bio ? <span className="me-bio">{profile.bio}</span> : null}
            {xHandle ? <span className="me-handle">@{xHandle}</span> : null}
          </div>
          <button
            type="button"
            className="me-chip me-id"
            title={installId}
            onClick={() => void copyInstallationId()}
          >
            <span aria-hidden="true">{t.hunterSection}ID</span>
            <span className="me-id-value">{shortId}</span>
            <AppIcon name="copy" size={12} />
          </button>
        </div>
        <div className="hunter-report-grid me-stats">
          <HunterStat label={t.statToday} value={String(todayBlocked ?? '—')} />
          <HunterStat label={t.statBullets} value={bullets ? `${bullets.left}/${bullets.total}` : '—'} />
          <HunterStat
            label={t.statWeek}
            value={me?.rank ? `#${me.rank}` : '—'}
            sub={me ? (t.hunterKillsUnit ? `${me.kills} ${t.hunterKillsUnit}` : `${me.kills}`) : t.hunterUnrankedShort}
          />
          <HunterStat
            label={t.statBeaten}
            value={beatenPct != null ? `${beatenPct}%` : '—'}
            hero={beatenPct != null}
          />
        </div>
      </section>

      <HunterProfileCard language={language} notify={notify} profile={profile} onChanged={refreshProfile} />

      <button type="button" className="me-settings-entry" onClick={() => setShowSettings(true)}>
        <AppIcon name="settings" size={16} />
        <span>{t.settings}</span>
        <span className="me-settings-entry-arrow" aria-hidden="true">
          ›
        </span>
      </button>
    </div>
  );
}

function HunterStat({
  label,
  value,
  sub,
  hero,
}: {
  label: string;
  value: string;
  sub?: string;
  /** hero：百分位这种"荣誉值"用主题色放大表现 */
  hero?: boolean;
}) {
  return (
    <div className={hero ? 'hunter-stat hunter-stat-hero' : 'hunter-stat'}>
      <span className="hunter-stat-value">{value}</span>
      <span className="hunter-stat-label">{label}</span>
      {sub ? <span className="hunter-stat-sub">{sub}</span> : null}
    </div>
  );
}
