// Подписи и форматирование дат на русском для Mini App.
// Для бота то же самое есть на Python: server/app/formatting.py.
import type { Budget, Duration, Format } from './types.ts';

export const FORMAT_LABELS: Record<Format, string> = {
  eat: 'Поесть',
  coffee: 'Кофе',
  bar: 'Бар',
  active: 'Активность',
  walk: 'Прогулка',
  home: 'Дома',
  any: 'Без разницы',
};

/** Бюджет на человека в сумах. Те же границы на сервере: server/app/places.py. */
export const BUDGET_LABELS: Record<Budget, string> = {
  '1': 'до 100 000',
  '2': 'до 250 000',
  '3': 'до 500 000',
  any: 'Любой',
};

/** «до 250 000 сум»; для «Любой» — null, чтобы не показывать. */
export function budgetLabel(budget: Budget): string | null {
  return budget === 'any' ? null : `${BUDGET_LABELS[budget]} сум`;
}

/** Средний чек: «≈ 180 тыс сум», «бесплатно». */
export function avgCheckLabel(sum: number | null): string | null {
  if (sum === null) return null;
  if (sum === 0) return 'бесплатно';
  return sum >= 1000 ? `≈ ${Math.round(sum / 1000)} тыс сум` : `≈ ${sum} сум`;
}

export const DURATION_LABELS: Record<Duration, string> = {
  '1-2': '1–2 часа',
  '2-3': '2–3 часа',
  evening: 'Весь вечер',
};

export const DURATION_HOURS: Record<Duration, number> = {
  '1-2': 2,
  '2-3': 3,
  evening: 4,
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Дата YYYY-MM-DD как полночь UTC, чтобы часовой пояс не сдвигал день. */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const weekdayFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' });
const dayMonthFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/** «Сб» */
export function weekdayShort(day: string): string {
  return capitalize(weekdayFmt.format(parseDay(day)).replace('.', ''));
}

/** «7» */
export function dayNumber(day: string): string {
  return String(parseDay(day).getUTCDate());
}

/** «Сб, 7 ноября» */
export function dayLabel(day: string): string {
  return `${weekdayShort(day)}, ${dayMonthFmt.format(parseDay(day))}`;
}

/** «Сб, 7 ноября · 19:00» */
export function slotLabel(day: string, time: string): string {
  return `${dayLabel(day)} · ${time}`;
}

/** «Пт–Вс, 6–8 ноября» или «Сб, 7 ноября». */
export function daysRangeLabel(days: string[]): string {
  if (days.length === 0) return '';
  const sorted = [...days].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === last) return dayLabel(first);
  const a = parseDay(first);
  const b = parseDay(last);
  const range = a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()}–${monthFmt.format(b)}`
    : `${monthFmt.format(a)} – ${monthFmt.format(b)}`;
  return `${weekdayShort(first)}–${weekdayShort(last)}, ${range}`;
}

/** «ср, 4 ноя, 20:00» — для дедлайнов. */
export function deadlineLabel(iso: string): string {
  const fmt = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return fmt.format(new Date(iso)).replace(/\./g, '');
}

export function initials(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

/** plural(5, ['человек', 'человека', 'человек']) */
export function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`;
}
