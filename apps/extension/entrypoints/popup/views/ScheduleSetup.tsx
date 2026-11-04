/**
 * 第一次打开「排期」时的节奏引导：问一天几条、哪个时间段，然后均匀铺开。
 *
 * 不填表、不排序、不选星期——用户在这里只回答两个问题就能开始排期，
 * 想细调再进「落笔设置 › 发帖节奏」。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  evenWindows,
  formatClock,
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
    preview: (count: number, slots: string[]) => `每天 ${count} 条 · ${slots.join(' ')}`,
    tooFew: (count: number) => `这段时间只放得下 ${count} 条`,
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
    preview: (count: number, slots: string[]) => `${count} a day · ${slots.join(' ')}`,
    tooFew: (count: number) => `Only room for ${count} in these hours`,
    guide: 'In X’s composer, tap the clock and pick “Schedule next” to land on these times.',
    later: 'Later',
    apply: 'Use these times',
  },
} as const;

const PER_DAY_OPTIONS = [1, 2, 3, 4, 5] as const;
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
  const [perDay, setPerDay] = useState(3);
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(22);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const windows = useMemo(
    () => evenWindows(perDay, startHour, endHour),
    [perDay, startHour, endHour],
  );
  const slots = windows.map((window) => window.start);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const setStart = (hour: number): void => {
    setStartHour(hour);
    if (endHour <= hour) setEndHour(Math.min(24, hour + 1));
  };
  const setEnd = (hour: number): void => {
    setEndHour(hour);
    if (startHour >= hour) setStartHour(Math.max(0, hour - 1));
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

        <div className="setup-row">
          <span className="setup-label">{c.perDay}</span>
          <div className="segmented" role="group" aria-label={c.perDay}>
            {PER_DAY_OPTIONS.map((count) => (
              <button
                key={count}
                type="button"
                className={count === perDay ? 'is-selected' : undefined}
                aria-pressed={count === perDay}
                onClick={() => setPerDay(count)}
              >
                {count}
              </button>
            ))}
          </div>
        </div>

        <div className="setup-row">
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

        <p className="setup-preview">{c.preview(windows.length, slots)}</p>
        {windows.length < perDay ? <p className="setup-note">{c.tooFew(windows.length)}</p> : null}
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
