import { DURATION_HOURS } from '../../../shared/format.ts';
import type { Duration, LatLng } from '../../../shared/types.ts';

const YANDEX_MAPS = 'https://yandex.uz/maps/';

function floating(date: string, time: string, plusHours = 0): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh + plusHours, mm))
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '');
}

export function endTime(time: string, duration: Duration): string {
  const [hh, mm] = time.split(':').map(Number);
  const end = (hh + DURATION_HOURS[duration]) % 24;
  return `${String(end).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function googleCalendarUrl(e: { title: string; date: string; time: string; duration: Duration; location: string | null }): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${floating(e.date, e.time)}/${floating(e.date, e.time, DURATION_HOURS[e.duration])}`,
  });
  if (e.location) params.set('location', e.location);
  return `https://calendar.google.com/calendar/render?${params}`;
}

export function routeLinks(to: LatLng): { label: string; url: string }[] {
  return [
    { label: 'Яндекс Карты', url: `${YANDEX_MAPS}?rtext=~${to.lat},${to.lng}&rtt=auto` },
    { label: '2GIS', url: `https://2gis.ru/routeSearch/rsType/car/to/${to.lng},${to.lat}` },
    { label: 'Google Maps', url: `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}` },
  ];
}

/** Ближайшие n дней начиная с сегодняшнего, в формате YYYY-MM-DD. */
export function upcomingDays(n: number, from = new Date()): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    return localDay(d);
  });
}

export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Пятница–воскресенье ближайших выходных (offset = 1 — следующих). */
export function weekend(offset = 0, from = new Date()): string[] {
  const d = new Date(from);
  const day = d.getDay();
  // Если сегодня пт–вс, «эти выходные» — уже идущие.
  const toFriday = day === 0 ? -2 : day === 6 ? -1 : 5 - day;
  d.setDate(d.getDate() + toFriday + offset * 7);
  const today = localDay(from);
  return [0, 1, 2]
    .map((i) => {
      const x = new Date(d);
      x.setDate(x.getDate() + i);
      return localDay(x);
    })
    .filter((x) => x >= today);
}

export function daysUntil(day: string, from = new Date()): number {
  const [y, m, d] = day.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}
