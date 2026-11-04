import { useMemo, useState } from 'react';
import { analyzeProfile, HEATMAP_SLOT_HOURS } from '@feedsieve/metrics';
import {
  GAP_OPTIONS,
  HORIZON_OPTIONS,
  LEAD_OPTIONS,
  PER_HOUR_OPTIONS,
  capacitySummary,
  formatClock,
  parseClock,
  recommendTimes,
  weekdayLabel,
  type ScheduleSettings,
  type ScheduleWindow,
} from '../../../../src/lib/compose/schedule-slots';
import { setScheduleSettings } from '../../../../src/lib/compose/schedule-store';
import { getSelfHandle } from '../../../../src/lib/community/following-allowlist';
import type { UiLanguage } from '../../../../src/lib/platform/i18n';
import { AppIcon, HelpIcon, IconButton, Row, Toggle } from '../shared';
import { asCatalogEntry } from '../profile-model';

const COPY = {
  zh: {
    windows: '集中时段',
    windowsHint:
      '只在这些时段里排，按整点设置。可以加多段，比如早上和晚上；每段单独选星期和每小时最多几条。',
    add: '添加时段',
    remove: '删除这个时段',
    days: '星期',
    from: '从',
    to: '到',
    perHour: '每小时最多',
    perHourUnit: (n: number) => `${n} 条`,
    randomize: '随机分钟',
    randomizeHint: '在小时内随机一个时间，避免总是整点；分配后固定，不会变。',
    lead: '最早提前',
    leadHint: '只排现在之后这么多分钟的时间，留出写和检查的时间。',
    horizon: '最多排到',
    horizonUnit: (n: number) => `${n} 天后`,
    gap: '最小间隔',
    gapHint: '相邻两条至少隔这么久；0 表示只避开同一分钟。',
    gapNone: '不限',
    minutes: (m: number) => (m % 60 === 0 ? `${m / 60} 小时` : `${m} 分钟`),
    preview: (n: number) => `本周最多 ${n} 条`,
    previewEmpty: '还没有时段，排不了',
    recommend: '按我的数据推荐',
    recommendHint:
      '用「主页」里你自己账号各发帖时段的爆款倍数，挑表现最好的 3 个时段，每个时段 1 小时、每小时 1 条。要先打开过自己的主页。',
    recommendNone: '自己主页的数据还不够，先打开自己的主页刷一会儿',
    recommended: (list: string) => `已换成 ${list}`,
    invalidWindow: '结束时间要晚于开始时间',
  },
  en: {
    windows: 'Posting windows',
    windowsHint:
      'Only these windows are used, on whole hours. Add more than one (e.g. morning and evening); each window has its own weekdays and per-hour limit.',
    add: 'Add window',
    remove: 'Remove this window',
    days: 'Days',
    from: 'From',
    to: 'To',
    perHour: 'Per hour',
    perHourUnit: (n: number) => `${n} post${n === 1 ? '' : 's'}`,
    randomize: 'Random minute',
    randomizeHint:
      'Pick a random minute inside the hour instead of always posting on the hour. The exact time is fixed once assigned.',
    lead: 'Earliest',
    leadHint:
      'Only schedule at least this many minutes from now, leaving time to write and review.',
    horizon: 'Schedule ahead',
    horizonUnit: (n: number) => `${n} days`,
    gap: 'Min gap',
    gapHint: 'Keep at least this much between posts; 0 only avoids the exact same minute.',
    gapNone: 'None',
    minutes: (m: number) => (m % 60 === 0 ? `${m / 60}h` : `${m}m`),
    preview: (n: number) => `Up to ${n} posts this week`,
    previewEmpty: 'No window yet, nothing can be scheduled',
    recommend: 'Suggest from my data',
    recommendHint:
      'Picks the 3 best posting periods from your own Profile view, one hour each with 1 post per hour. Open your own profile first.',
    recommendNone: 'Not enough data on your profile yet; open your profile and scroll a bit',
    recommended: (list: string) => `Changed to ${list}`,
    invalidWindow: 'End time must be later than start time',
  },
} as const;

function windowId(): string {
  return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export default function CadencePage({
  language,
  schedule,
  notify,
}: {
  language: UiLanguage;
  schedule: ScheduleSettings;
  notify: (message: string | null) => void;
}) {
  const t = COPY[language];
  const [now] = useState(() => Date.now());
  const summary = useMemo(() => capacitySummary(schedule, [], now, 7), [schedule, now]);

  function save(patch: Partial<ScheduleSettings>): void {
    void setScheduleSettings(patch);
  }

  /** 时段按整点算：12:30 选进来会落到 12:00，避免一个小时里被算成两个名额。 */
  function hourOf(value: string): string | null {
    const minutes = parseClock(value);
    return minutes === null ? null : formatClock(Math.floor(minutes / 60) * 60);
  }

  function updateWindow(id: string, patch: Partial<ScheduleWindow>): void {
    const next = schedule.windows.map((window) => {
      if (window.id !== id) return window;
      const merged = { ...window, ...patch };
      const start = hourOf(merged.start);
      const end = hourOf(merged.end);
      if (start === null || end === null) return window;
      if (end <= start) {
        if (patch.start === undefined) {
          notify(t.invalidWindow);
          return window;
        }
        merged.start = start;
        merged.end = formatClock(Math.min(parseClock(start)! + 60, 23 * 60 + 59));
        return merged;
      }
      merged.start = start;
      merged.end = end;
      return merged;
    });
    save({ windows: next });
  }

  function addWindow(): void {
    const last = schedule.windows[schedule.windows.length - 1];
    const start = last ? parseClock(last.end) : 9 * 60;
    const minutes = Math.min(start ?? 9 * 60, 22 * 60);
    save({
      windows: [
        ...schedule.windows,
        {
          id: windowId(),
          days: [1, 2, 3, 4, 5],
          start: formatClock(minutes),
          end: formatClock(Math.min(minutes + 60, 23 * 60 + 59)),
          perHour: 1,
        },
      ],
    });
  }

  function removeWindow(id: string): void {
    save({ windows: schedule.windows.filter((window) => window.id !== id) });
  }

  function toggleDay(window: ScheduleWindow, day: number): void {
    updateWindow(window.id, {
      days: window.days.includes(day)
        ? window.days.filter((value) => value !== day)
        : [...window.days, day].sort((a, b) => a - b),
    });
  }

  async function recommend(): Promise<void> {
    const self = await getSelfHandle();
    const entry = self
      ? asCatalogEntry(
          await browser.runtime
            .sendMessage({ type: 'feedsieve:profile-get', handle: self })
            .catch(() => null),
          self,
        )
      : null;
    const heatmap = entry ? analyzeProfile(Object.values(entry.posts), Date.now()).heatmap : null;
    const times = heatmap ? recommendTimes(heatmap.cells, HEATMAP_SLOT_HOURS, 3) : [];
    if (times.length === 0) {
      notify(t.recommendNone);
      return;
    }
    save({
      windows: times.map((time, index) => {
        const start = parseClock(time) ?? 9 * 60;
        return {
          id: `r${index + 1}-${Date.now().toString(36)}`,
          days: [0, 1, 2, 3, 4, 5, 6],
          start: formatClock(start),
          end: formatClock(Math.min(start + 60, 23 * 60 + 59)),
          perHour: 1,
        };
      }),
    });
    notify(t.recommended(times.join(language === 'zh' ? '、' : ', ')));
  }

  return (
    <section className="group cadence-page">
      <Row label={t.windows} hint={t.windowsHint}>
        <button type="button" className="text-button" onClick={addWindow}>
          <AppIcon name="plus" size={14} />
          <span>{t.add}</span>
        </button>
      </Row>
      {schedule.windows.length === 0 ? (
        <p className="row-meta write-warn">{t.previewEmpty}</p>
      ) : null}
      {schedule.windows.map((window) => (
        <div className="cadence-window" key={window.id}>
          <div className="cadence-days" role="group" aria-label={t.days}>
            {[0, 1, 2, 3, 4, 5, 6].map((day) => (
              <button
                key={day}
                type="button"
                aria-pressed={window.days.includes(day)}
                className={`chip${window.days.includes(day) ? ' is-on' : ''}`}
                onClick={() => toggleDay(window, day)}
              >
                {language === 'zh'
                  ? weekdayLabel(day, language).replace('周', '')
                  : weekdayLabel(day, language).slice(0, 3)}
              </button>
            ))}
          </div>
          <div className="cadence-time">
            <input
              type="time"
              step={3600}
              className="number-input write-time-input"
              aria-label={`${t.from} ${window.id}`}
              value={window.start}
              onChange={(event) =>
                event.target.value && updateWindow(window.id, { start: event.target.value })
              }
            />
            <span className="row-meta">{t.to}</span>
            <input
              type="time"
              step={3600}
              className="number-input write-time-input"
              aria-label={`${t.to} ${window.id}`}
              value={window.end}
              onChange={(event) =>
                event.target.value && updateWindow(window.id, { end: event.target.value })
              }
            />
            <select
              className="sort-select"
              aria-label={t.perHour}
              value={window.perHour}
              onChange={(event) => updateWindow(window.id, { perHour: Number(event.target.value) })}
            >
              {PER_HOUR_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {t.perHourUnit(value)}
                </option>
              ))}
            </select>
            <IconButton icon="x" label={t.remove} onClick={() => removeWindow(window.id)} />
          </div>
        </div>
      ))}

      <Row label={t.randomize} hint={t.randomizeHint}>
        <Toggle
          checked={schedule.randomize}
          label={t.randomize}
          onChange={(randomize) => save({ randomize })}
        />
      </Row>
      <Row label={t.lead} hint={t.leadHint}>
        <select
          className="sort-select"
          aria-label={t.lead}
          value={schedule.leadMinutes}
          onChange={(event) => save({ leadMinutes: Number(event.target.value) })}
        >
          {LEAD_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value === 0 ? t.gapNone : t.minutes(value)}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t.horizon}>
        <select
          className="sort-select"
          aria-label={t.horizon}
          value={schedule.horizonDays}
          onChange={(event) => save({ horizonDays: Number(event.target.value) })}
        >
          {HORIZON_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {t.horizonUnit(value)}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t.gap} hint={t.gapHint}>
        <select
          className="sort-select"
          aria-label={t.gap}
          value={schedule.minGapMinutes}
          onChange={(event) => save({ minGapMinutes: Number(event.target.value) })}
        >
          {GAP_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value === 0 ? t.gapNone : t.minutes(value)}
            </option>
          ))}
        </select>
      </Row>

      <div className="row cadence-foot">
        <span className="row-meta">
          {summary.capacity > 0 ? t.preview(summary.capacity) : t.previewEmpty}
        </span>
        <button type="button" className="text-button" onClick={() => void recommend()}>
          <AppIcon name="sparkles" size={14} />
          <span>{t.recommend}</span>
        </button>
        <HelpIcon text={t.recommendHint} />
      </div>
    </section>
  );
}
