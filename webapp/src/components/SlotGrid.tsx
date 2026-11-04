import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { dayLabel, dayNumber, weekdayShort } from '../../../shared/format.ts';
import type { SlotValue } from '../../../shared/types.ts';
import { haptic } from '../telegram.ts';
import { IconCheck } from './icons.tsx';

type Cell = 0 | SlotValue;
const WORDS = ['не могу', 'удобно', 'если надо'];

function columns(days: string[]) {
  return { gridTemplateColumns: `44px repeat(${days.length}, minmax(64px, 1fr))` };
}

function DayHeader({ days }: { days: string[] }) {
  return (
    <>
      <span />
      {days.map((d) => (
        <span key={d} className="day">
          <b>{weekdayShort(d)}</b> <span className="muted">{dayNumber(d)}</span>
        </span>
      ))}
    </>
  );
}

/**
 * Сетка «когда удобно». Нажатие переключает удобно → если надо → не могу,
 * протягивание пальцем закрашивает соседние слоты тем же значением.
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
  const paint = useRef<Cell | null>(null);

  const set = (key: string, v: Cell) => {
    if ((current.current[key] ?? 0) === v) return;
    const next = { ...current.current };
    if (v) next[key] = v;
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
    const v = (((current.current[key] ?? 0) + 1) % 3) as Cell;
    paint.current = v;
    set(key, v);
    haptic.select();
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (paint.current === null) return;
    const key = keyAt(e.clientX, e.clientY);
    if (key && (current.current[key] ?? 0) !== paint.current) {
      set(key, paint.current);
      haptic.select();
    }
  };

  const stop = () => {
    paint.current = null;
  };

  // Клавиатура: Enter/пробел переключают слот, без мыши.
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, key: string) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    set(key, (((current.current[key] ?? 0) + 1) % 3) as Cell);
  };

  return (
    <div className="slot-scroll">
      <div
        className="slot-grid"
        style={{ ...columns(days), touchAction: days.length > 4 ? 'pan-x' : 'none' }}
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
              const v = (value[key] ?? 0) as Cell;
              return (
                <button
                  key={key}
                  type="button"
                  data-key={key}
                  className={`slot${v === 1 ? ' good' : v === 2 ? ' maybe' : ''}`}
                  aria-label={`${dayLabel(d)}, ${t}: ${WORDS[v]}`}
                  onKeyDown={(e) => onKeyDown(e, key)}
                >
                  {v === 1 && <IconCheck size={18} strokeWidth={2.5} />}
                  {v === 2 && 'если надо'}
                </button>
              );
            })}
          </Row>
        ))}
      </div>
    </div>
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

export function SlotLegend() {
  return (
    <div className="legend">
      <span>
        <i className="good" />
        Удобно
      </span>
      <span>
        <i className="maybe" />
        Если надо
      </span>
      <span>
        <i />
        Не могу
      </span>
    </div>
  );
}

const HEAT_STEPS = 6;

/** Тепловая карта: сколько человек свободно в каждый слот. */
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
  const level = (n: number) => (total === 0 || n === 0 ? 0 : Math.max(1, Math.round((n / total) * HEAT_STEPS)));
  return (
    <div className="slot-scroll">
      <div className="slot-grid" style={{ ...columns(days), gap: 4, touchAction: 'auto' }}>
        <DayHeader days={days} />
        {times.map((t) => (
          <Row key={t} time={t}>
            {days.map((d) => {
              const key = `${d}T${t}`;
              const n = heat[key] ?? 0;
              const l = level(n);
              return (
                <span
                  key={key}
                  className={`heat${key === bestKey ? ' best' : ''}`}
                  style={{
                    background: `var(--heat-${l})`,
                    color: l >= 5 ? 'var(--accent-ink)' : l === 0 ? 'var(--muted)' : 'var(--ink)',
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

export function HeatLegend({ total }: { total: number }) {
  return (
    <div className="row small muted" style={{ justifyContent: 'flex-end', gap: 6 }}>
      <span>Свободно: 0</span>
      <span className="heat-scale" aria-hidden="true">
        {Array.from({ length: HEAT_STEPS + 1 }, (_, i) => (
          <span key={i} style={{ background: `var(--heat-${i})`, boxShadow: i === 0 ? 'inset 0 0 0 1px var(--line)' : undefined }} />
        ))}
      </span>
      <span>{total}</span>
    </div>
  );
}
