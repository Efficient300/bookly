import { useState } from 'react';
import { dayLabel } from '../../../shared/format.ts';
import { localDay } from '../lib/links.ts';
import { haptic } from '../telegram.ts';
import { IconChevron, IconChevronLeft } from './icons.tsx';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const monthName = new Intl.DateTimeFormat('ru-RU', { month: 'long' });
/** Насколько вперёд можно листать. */
const MONTHS_AHEAD = 12;

const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth();

/** Календарь по месяцам: выбранные дни — круги чернилами, сегодня обведено. */
export function MonthCalendar({
  value,
  onChange,
  max,
  onLimit,
}: {
  value: string[];
  onChange: (days: string[]) => void;
  /** Сколько дней можно выбрать. */
  max: number;
  onLimit: () => void;
}) {
  const today = new Date();
  const todayKey = localDay(today);
  const first = value.length > 0 ? new Date(`${[...value].sort()[0]}T00:00`) : today;
  const [shown, setShown] = useState(() => Math.max(monthIndex(first), monthIndex(today)));

  const year = Math.floor(shown / 12);
  const month = shown % 12;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Понедельник — первый день недели.
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const cells = Array.from({ length: daysInMonth }, (_, i) => localDay(new Date(year, month, i + 1)));
  const title = monthName.format(new Date(year, month, 1));

  function toggle(day: string) {
    haptic.select();
    if (value.includes(day)) onChange(value.filter((d) => d !== day));
    else if (value.length >= max) onLimit();
    else onChange([...value, day].sort());
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="cal-head">
        <button
          type="button"
          className="cal-nav"
          aria-label="Предыдущий месяц"
          disabled={shown <= monthIndex(today)}
          onClick={() => setShown(shown - 1)}
        >
          <IconChevronLeft size={18} />
        </button>
        <span aria-live="polite">
          {title.charAt(0).toUpperCase() + title.slice(1)} {year}
        </span>
        <button
          type="button"
          className="cal-nav"
          aria-label="Следующий месяц"
          disabled={shown >= monthIndex(today) + MONTHS_AHEAD}
          onClick={() => setShown(shown + 1)}
        >
          <IconChevron size={18} />
        </button>
      </div>
      <div className="cal">
        {WEEKDAYS.map((w) => (
          <span key={w} className="cal-wd" aria-hidden="true">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} />
        ))}
        {cells.map((day, i) => (
          <button
            key={day}
            type="button"
            className={`cal-day${day === todayKey ? ' today' : ''}`}
            aria-pressed={value.includes(day)}
            aria-label={dayLabel(day)}
            disabled={day < todayKey}
            onClick={() => toggle(day)}
          >
            <i>{i + 1}</i>
          </button>
        ))}
      </div>
    </div>
  );
}
