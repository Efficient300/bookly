import { useRef } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { dayLabel, dayNumber, weekdayShort } from '../../../shared/format.ts';
import type { SlotValue } from '../../../shared/types.ts';
import { haptic } from '../telegram.ts';
import { IconCheck } from './icons.tsx';

function columns(days: string[]): CSSProperties {
  return { gridTemplateColumns: `48px repeat(${days.length}, minmax(56px, 1fr))` };
}

function DayHeader({ days }: { days: string[] }) {
  return (
    <>
      <span />
      {days.map((d) => (
        <span key={d} className="day">
          {weekdayShort(d)}
          <b>{dayNumber(d)}</b>
        </span>
      ))}
    </>
  );
}

function Row({ time, children }: { time: string; children: ReactNode }) {
  return (
    <>
      <span className="time">{time}</span>
      {children}
    </>
  );
}

/**
 * Сетка «когда удобно»: нажатие отмечает или снимает слот, протягивание пальцем
 * отмечает соседние тем же значением.
 */
export function SlotGrid({
  days,
  times,
  value,
  onChange,
}: {
  days: string[];
  times: string[];
  value: Record<string, SlotValue>;
  onChange: (next: Record<string, SlotValue>) => void;
}) {
  const current = useRef(value);
  current.current = value;
  const paint = useRef<boolean | null>(null);

  const set = (key: string, on: boolean) => {
    if (!!current.current[key] === on) return;
    const next = { ...current.current };
    if (on) next[key] = 1;
    else delete next[key];
    current.current = next;
    onChange(next);
  };

  const keyAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-key]')?.dataset.key;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const key = keyAt(e.clientX, e.clientY);
    if (!key) return;
    e.preventDefault();
    paint.current = !current.current[key];
    set(key, paint.current);
    haptic.select();
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (paint.current === null) return;
    const key = keyAt(e.clientX, e.clientY);
    if (key && !!current.current[key] !== paint.current) {
      set(key, paint.current);
      haptic.select();
    }
  };

  const stop = () => {
    paint.current = null;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, key: string) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    set(key, !current.current[key]);
  };

  return (
    <div className="grid-scroll">
      <div
        className="slot-grid"
        // Жест на слотах отмечает, а на подписях времени — листает страницу.
        style={{ ...columns(days), '--slot-touch': days.length > 4 ? 'pan-x' : 'none' } as CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stop}
        onPointerCancel={stop}
      >
        <DayHeader days={days} />
        {times.map((t) => (
          <Row key={t} time={t}>
            {days.map((d) => {
              const key = `${d}T${t}`;
              const on = !!value[key];
              return (
                <button
                  key={key}
                  type="button"
                  data-key={key}
                  className="cell"
                  aria-pressed={on}
                  aria-label={`${dayLabel(d)}, ${t}: ${on ? 'подходит' : 'не подходит'}`}
                  onKeyDown={(e) => onKeyDown(e, key)}
                >
                  {on && <IconCheck size={18} strokeWidth={2} />}
                </button>
              );
            })}
          </Row>
        ))}
      </div>
    </div>
  );
}

export function SlotLegend() {
  return (
    <div className="legend">
      <span>
        <i className="on" />
        Подходит
      </span>
      <span>
        <i />
        Не подходит
      </span>
    </div>
  );
}

/** Тепловая карта для организатора: сколько человек свободно в каждый слот, лучший — лаймом. */
export function HeatGrid({
  days,
  times,
  heat,
  total,
  bestKey,
}: {
  days: string[];
  times: string[];
  heat: Record<string, number>;
  total: number;
  bestKey: string | null;
}) {
  return (
    <div className="grid-scroll">
      <div className="slot-grid" style={columns(days)}>
        <DayHeader days={days} />
        {times.map((t) => (
          <Row key={t} time={t}>
            {days.map((d) => {
              const key = `${d}T${t}`;
              const n = heat[key] ?? 0;
              const share = total ? n / total : 0;
              return (
                <span
                  key={key}
                  className={`heat${key === bestKey ? ' best' : ''}`}
                  style={{
                    background: n ? `color-mix(in srgb, var(--c-ink) ${Math.round(12 + share * 78)}%, var(--c-surface))` : 'var(--c-surface)',
                    color: share > 0.45 ? 'var(--c-bg)' : n ? 'var(--c-ink)' : 'var(--c-muted)',
                  }}
                  aria-label={`${dayLabel(d)}, ${t}: свободно ${n} из ${total}`}
                >
                  {n}
                </span>
              );
            })}
          </Row>
        ))}
      </div>
    </div>
  );
}
