/**
 * 帖子卡片的零件（热帖、主页洞察共用）：X 推文同款的头像、蓝标、量级、动作栏、相对时间。
 */
import { useState } from 'react';
import type { UiLanguage } from '../../../src/lib/platform/i18n';
import { UI_COPY } from '../../../src/lib/platform/i18n';
import { compact, formatCount } from '../../../src/lib/insight/format';
import { iconParts, TIER_ICONS, type IconName } from '../../../src/lib/insight/icons';

type Tier = 1 | 2 | 3 | 4 | 5 | 6;

export interface PostCounts {
  replies?: number;
  retweets?: number;
  likes?: number;
  views?: number;
  bookmarks?: number;
}

export interface AvatarSource {
  handle: string;
  displayName?: string;
  avatarUrl?: string;
}

/** 内容脚本同款图标（Lucide 形状共用 insight/icons.ts）。 */
export function LineIcon({ name, size = 11 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconParts(name).map((part, index) => {
        const Tag = part.tag;
        return <Tag key={index} {...part.attrs} />;
      })}
    </svg>
  );
}

/** 与推文上一致的量级：灰色的 [档位图标 粉丝数]，数字的含义放进无障碍标签。 */
export function TierPill({
  tier,
  followers,
  language,
  highlight = false,
}: {
  tier: number;
  followers: number;
  language: UiLanguage;
  highlight?: boolean;
}) {
  return (
    <span
      className={`tier-pill${highlight ? ' is-key' : ''}`}
      data-fs-tier-level={tier}
      role="img"
      aria-label={`${compact(followers)} ${language === 'zh' ? '粉丝' : 'followers'}`}
    >
      <LineIcon name={TIER_ICONS[tier as Tier] ?? 'sprout'} size={12} />
      <span>{compact(followers)}</span>
    </span>
  );
}

/** 正文末尾的 t.co 链接是图片 / 视频 / 引用的占位，弹窗里读不出内容，去掉。 */
export function readableText(text: string | undefined): string {
  if (!text) return '';
  return text.replace(/(\s*https:\/\/t\.co\/\w+)+\s*$/u, '').trim();
}

/** X 时间线的短时间写法：中文「25分钟」「2小时」「3天」，英文「25m」「2h」「3d」。 */
export function shortAgo(timestamp: number, now: number, language: UiLanguage): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  const zh = language === 'zh';
  if (minutes < 1) return zh ? '刚刚' : 'now';
  if (minutes < 60) return zh ? `${minutes}分钟` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return zh ? `${hours}小时` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return zh ? `${days}天` : `${days}d`;
}

export function statText(value: number, language: UiLanguage): string {
  return value < 10_000
    ? value.toLocaleString(language === 'zh' ? 'zh-CN' : 'en')
    : formatCount(value, language);
}

/** 和 X 动作栏同样的顺序和图标：回复、转发、喜欢、浏览、收藏，均匀铺开。 */
export function PostActions({
  item,
  language,
  showBookmarks,
}: {
  item: PostCounts;
  language: UiLanguage;
  showBookmarks: boolean;
}) {
  const t = UI_COPY[language];
  const stats: Array<[IconName, string, number | undefined]> = [
    ['reply', t.statReplies, item.replies],
    ['repost', t.statReposts, item.retweets],
    ['like', t.statLikes, item.likes],
    ['views', t.statViews, item.views],
    ['bookmark', t.statBookmarks, item.bookmarks],
  ];
  return (
    <div className="post-actions">
      {stats.map(([icon, label, value]) => (
        <span key={icon} aria-label={value === undefined ? label : `${label} ${value}`}>
          <LineIcon name={icon} size={16} />
          {/* 和 X 时间线一样，收藏只有图标不写数；按收藏排序时写出来，才看得出顺序 */}
          {value === undefined || value === 0 || (icon === 'bookmark' && !showBookmarks)
            ? null
            : statText(value, language)}
        </span>
      ))}
    </div>
  );
}

/** 头像：X 的圆形头像；图片加载失败时退回名字首字。 */
export function Avatar({ item }: { item: AvatarSource }) {
  const [failed, setFailed] = useState(false);
  const initial = (item.displayName ?? item.handle).slice(0, 1).toUpperCase();
  if (!item.avatarUrl || failed) {
    return (
      <span className="post-avatar is-fallback" aria-hidden="true">
        {initial}
      </span>
    );
  }
  return (
    <img
      className="post-avatar"
      // _normal 是 48px，弹窗里 40px 头像用 _bigger（73px）在高分屏上更清楚
      src={item.avatarUrl.replace(/_normal(\.\w+)$/u, '_bigger$1')}
      alt=""
      width={40}
      height={40}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

/** 蓝标：和 X 一样跟在名字后面。 */
export function VerifiedMark({ label }: { label: string }) {
  return (
    <svg
      className="post-verified"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      role="img"
      aria-label={label}
    >
      <path
        fill="currentColor"
        d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"
      />
      <path
        d="m9 12 2 2 4-4"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
