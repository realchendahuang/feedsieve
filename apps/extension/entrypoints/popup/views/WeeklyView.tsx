/**
 * 「周刊」一级栏目：小筛子周刊的入口 + 封面广告。
 *
 * 这不是功能模块，没有自己的设置页；它就是一张会被反复看到的推荐位。
 * 打开时向周刊站点要最新一期（期号、标题、条数、OG 封面），接口不可用就退回
 * 站点封面和第 1 期。封面加载失败再退回品牌底色 + 文字，离线也不会留空白。
 */
import { useEffect, useState } from 'react';
import { UI_COPY, type UiLanguage } from '../../../src/lib/platform/i18n';
import {
  fetchLatestIssue,
  WEEKLY_FALLBACK_ISSUE_URL,
  WEEKLY_SITE_COVER,
  WEEKLY_URL,
  type WeeklyIssue,
} from './weekly-model';

export default function WeeklyView({ language }: { language: UiLanguage }) {
  const t = UI_COPY[language];
  const [issue, setIssue] = useState<WeeklyIssue | null>(null);
  const [coverSrc, setCoverSrc] = useState(WEEKLY_SITE_COVER);
  const [coverFailed, setCoverFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetchLatestIssue(controller.signal).then((next) => {
      if (!next) return;
      setIssue(next);
      setCoverSrc(next.cover);
      setCoverFailed(false);
    });
    return () => controller.abort();
  }, []);

  const latestUrl = issue?.url ?? WEEKLY_FALLBACK_ISSUE_URL;
  const latestNumber = issue?.number ?? 1;

  function onCoverError(): void {
    // 这一期的专属封面挂了先退回站点封面，站点封面也挂就显示品牌底色
    if (coverSrc !== WEEKLY_SITE_COVER) {
      setCoverSrc(WEEKLY_SITE_COVER);
      return;
    }
    setCoverFailed(true);
  }

  return (
    <div className="view weekly-view">
      <a
        className="weekly-hero"
        href={WEEKLY_URL}
        target="_blank"
        rel="noreferrer"
        aria-label={t.weeklyOpen}
      >
        <span className="weekly-hero-fallback" aria-hidden="true">
          <span className="weekly-hero-brand">{t.weeklyTitle}</span>
          <span className="weekly-hero-sub">{t.weeklyTagline}</span>
        </span>
        {coverFailed ? null : (
          <img className="weekly-hero-image" src={coverSrc} alt="" onError={onCoverError} />
        )}
        <span className="weekly-hero-badge">{t.weeklyEveryFriday}</span>
      </a>

      <section className="weekly-body">
        <div className="weekly-kicker">{t.weeklyKicker}</div>
        <h1>{t.weeklyTitle}</h1>

        {issue?.title ? (
          <a className="weekly-issue" href={issue.url} target="_blank" rel="noreferrer">
            <span className="weekly-issue-no">{t.weeklyIssue(issue.number)}</span>
            <span className="weekly-issue-title">{issue.title}</span>
            <span className="weekly-issue-count">{t.weeklyPostCount(issue.postCount)}</span>
          </a>
        ) : null}

        <p className="weekly-desc">{t.weeklyDesc}</p>

        <ul className="weekly-points">
          <li>{t.weeklyPoint1}</li>
          <li>{t.weeklyPoint2}</li>
          <li>{t.weeklyPoint3}</li>
        </ul>

        <div className="weekly-actions">
          <a className="primary-button" href={WEEKLY_URL} target="_blank" rel="noreferrer">
            {t.weeklyOpen}
          </a>
          <a className="secondary-button" href={latestUrl} target="_blank" rel="noreferrer">
            {t.weeklyLatest(latestNumber)}
          </a>
        </div>

        <nav className="weekly-links" aria-label={t.weeklyTitle}>
          <a href={`${WEEKLY_URL}/issues`} target="_blank" rel="noreferrer">
            {t.weeklyArchive}
          </a>
          <a href={`${WEEKLY_URL}/feed.xml`} target="_blank" rel="noreferrer">
            RSS
          </a>
          <a href={`${WEEKLY_URL}/new`} target="_blank" rel="noreferrer">
            {t.weeklySubmit}
          </a>
          <a href="https://feedsieve.win" target="_blank" rel="noreferrer">
            {t.weeklySite}
          </a>
        </nav>
      </section>
    </div>
  );
}
