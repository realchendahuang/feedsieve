/**
 * 第一次打开「排期」时的节奏引导：问一天几条、哪个时间段，然后均匀铺开。
 *
 * 只回答两个问题就能开始排期，想细调再进「落笔设置 › 发帖节奏」。
 * 条数支持 5 / 10 / 20 / 30 / 40 和自定义——真人运营一天二十条很正常，
 * 上限只受「时段时长 × 每小时最多 4 条」限制。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  evenWindows,
  formatClock,
  maxPerDay,
  type ScheduleWindow,
} from '../../../src/lib/compose/schedule-slots';
import type { UiLanguage } from '../../../src/lib/platform/i18n';

const COPY = {
  zh: {
    title: '定个发帖节奏',
    perDay: '一天几条',
    when: '什么时候发',
    from: '从',
    to: '到',
    custom: '自定义',
    preview: (count: number, times: string[]) => `每天 ${count} 条 · ${times.join(' ')}`,
    summary: (count: number, from: string, to: string, perHour: string) =>
      `每天 ${count} 条 · ${from}–${to} · 每小时 ${perHour} 条`,
    tooMany: (max: number) => `这段时长最多 ${max} 条`,
    guide: '以后在 X 发帖框点时钟，「排下一条」就落进这些时间。',
    later: '以后再说',
    apply: '就这样定',
  },
  en: {
    title: 'Set your posting rhythm',
    perDay: 'Posts a day',
    when: 'Posting hours',
    from: 'From',
    to: 'To',
    custom: 'Custom',
    preview: (count: number, times: string[]) => `${count} a day · ${times.join(' ')}`,
    summary: (count: number, from: string, to: string, perHour: string) =>
      `${count} a day · ${from}–${to} · ${perHour} per hour`,
    tooMany: (max: number) => `Up to ${max} in these hours`,
    guide: 'In X’s composer, tap the clock and pick “Schedule next” to land on these times.',
    later: 'Later',
    apply: 'Use these times',
  },
} as const;

/** 一天几条：常见的几档，剩下的用自定义填 */
const PER_DAY_OPTIONS = [5, 10, 20, 30, 40] as const;
/** 条数少到能一行列完时，直接把时间点摆出来 */
const LIST_TIMES_UP_TO = 6;
const HOURS = Array.from({ length: 25 }, (_, hour) => hour);

export default function ScheduleSetup({
  language,
  onApply,
  onDismiss,
}: {
  language: UiLanguage;
  onApply: (windows: ScheduleWindow[]) => void;
  onDismiss: () => void;
}) {
  const c = COPY[language];
  const [perDay, setPerDay] = useState(10);
  const [custom, setCustom] = useState(false);
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(22);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const max = maxPerDay(startHour, endHour);
  const count = Math.min(perDay, max);
  const windows = useMemo(() => evenWindows(count, startHour, endHour), [count, startHour, endHour]);
  const perHourList = windows.map((window) => window.perHour);
  const perHourMin = perHourList.length ? Math.min(...perHourList) : 1;
  const perHourMax = perHourList.length ? Math.max(...perHourList) : 1;
  const perHourLabel = perHourMin === perHourMax ? `${perHourMax}` : `${perHourMin}–${perHourMax}`;
  const span = endHour - startHour;

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // 时段一改，条数可能就装不下了：改的时候顺手夹住，不用 effect
  const setStart = (hour: number): void => {
    const nextEnd = Math.max(endHour, hour + 1);
    setStartHour(hour);
    setEndHour(nextEnd);
    setPerDay((current) => Math.min(current, maxPerDay(hour, nextEnd)));
  };
  const setEnd = (hour: number): void => {
    const nextStart = Math.min(startHour, hour - 1);
    setStartHour(nextStart);
    setEndHour(hour);
    setPerDay((current) => Math.min(current, maxPerDay(nextStart, hour)));
  };

  return (
    <div className="setup-scrim" role="presentation" onClick={onDismiss}>
      <div
        ref={dialogRef}
        className="setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-setup-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDismiss();
        }}
      >
        <h2 id="schedule-setup-title">{c.title}</h2>

        <div className="setup-field">
          <span className="setup-label">{c.perDay}</span>
          <div className="setup-count">
            {PER_DAY_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                className={`chip${!custom && count === value ? ' is-on' : ''}`}
                aria-pressed={!custom && count === value}
                disabled={value > max}
                onClick={() => {
                  setCustom(false);
                  setPerDay(value);
                }}
              >
                {value}
              </button>
            ))}
            <span className="setup-count-custom">
              <button
                type="button"
                className={`chip${custom ? ' is-on' : ''}`}
                aria-pressed={custom}
                onClick={() => setCustom(true)}
              >
                {c.custom}
              </button>
              {custom ? (
                <input
                  className="number-input setup-count-input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={max}
                  value={perDay}
                  aria-label={c.perDay}
                  autoFocus
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setPerDay(
                      Number.isFinite(next) ? Math.max(1, Math.min(max, Math.round(next))) : 1,
                    );
                  }}
                />
              ) : null}
            </span>
          </div>
        </div>

        <div className="setup-field">
          <span className="setup-label">{c.when}</span>
          <div className="setup-range">
            <select
              className="sort-select"
              aria-label={`${c.when} · ${c.from}`}
              value={startHour}
              onChange={(event) => setStart(Number(event.target.value))}
            >
              {HOURS.slice(0, 24).map((hour) => (
                <option key={hour} value={hour}>
                  {formatClock(hour * 60)}
                </option>
              ))}
            </select>
            <span className="setup-range-sep">{c.to}</span>
            <select
              className="sort-select"
              aria-label={`${c.when} · ${c.to}`}
              value={endHour}
              onChange={(event) => setEnd(Number(event.target.value))}
            >
              {HOURS.slice(1).map((hour) => (
                <option key={hour} value={hour}>
                  {formatClock(hour * 60)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="setup-preview">
          {count <= LIST_TIMES_UP_TO && count <= span
            ? c.preview(count, windows.map((window) => window.start))
            : c.summary(count, formatClock(startHour * 60), formatClock(endHour * 60), perHourLabel)}
        </p>
        {perDay > max ? <p className="setup-note">{c.tooMany(max)}</p> : null}
        <p className="setup-note">{c.guide}</p>

        <div className="setup-actions">
          <button type="button" className="text-button" onClick={onDismiss}>
            {c.later}
          </button>
          <button type="button" className="primary-button" onClick={() => onApply(windows)}>
            {c.apply}
          </button>
        </div>
      </div>
    </div>
  );
}
