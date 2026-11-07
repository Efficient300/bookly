import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { dayNumber, initials, weekdayShort } from '../../../shared/format.ts';
import type { PlanStatus } from '../../../shared/types.ts';
import { haptic, nativeBar, pushBar } from '../telegram.ts';
import type { BarAction } from '../telegram.ts';
import { IconChevron } from './icons.tsx';

export function Avatar({ name, photo = null, size = 32 }: { name: string; photo?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="av" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
      {initials(name)}
      {photo && !broken && <img src={photo} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />}
    </span>
  );
}

/** Аватары стопкой; «ждём» — пунктирные кружки для тех, кто ещё не ответил. */
export function AvatarStack({
  people,
  waiting = 0,
  max = 4,
  size = 32,
}: {
  people: { id: number; name: string; photo?: string | null }[];
  waiting?: number;
  max?: number;
  size?: number;
}) {
  const extra = people.length - max;
  return (
    <span className="avs" aria-hidden="true">
      {people.slice(0, max).map((p) => (
        <Avatar key={p.id} name={p.name} photo={p.photo} size={size} />
      ))}
      {extra > 0 && (
        <span className="av" style={{ width: size, height: size }}>
          +{extra}
        </span>
      )}
      {Array.from({ length: Math.min(waiting, 3) }, (_, i) => (
        <span key={`w${i}`} className="av wait" style={{ width: size, height: size }}>
          ?
        </span>
      ))}
    </span>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => {
            haptic.select();
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Строка формы: название, значение справа и один шеврон, который поворачивается при раскрытии. */
export function ExpandRow({
  label,
  value,
  warn = false,
  open,
  onToggle,
  children,
}: {
  label: string;
  value: string;
  warn?: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <button type="button" className="row" aria-expanded={open} onClick={onToggle}>
        <span className="lbl">
          <span>{label}</span>
        </span>
        <span className={warn ? 'val warn' : 'val'}>{value}</span>
        <IconChevron size={16} className="chev" />
      </button>
      {open && <div className="expand">{children}</div>}
    </>
  );
}

/** Чипы с одним выбранным значением. */
export function ChoiceChips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="chip"
          aria-pressed={value === o.value}
          onClick={() => {
            haptic.select();
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const TAGS: Record<PlanStatus | 'expired', { label: string; className: string }> = {
  confirmed: { label: 'Решено', className: 'tag on' },
  collecting: { label: 'Ждём ответы', className: 'tag' },
  done: { label: 'Прошла', className: 'tag out' },
  expired: { label: 'Не состоялась', className: 'tag out' },
};

export function StatusTag({ status }: { status: PlanStatus | 'expired' }) {
  const tag = TAGS[status];
  return <span className={tag.className}>{tag.label}</span>;
}

export function Switch({ checked, onChange, labelledBy }: { checked: boolean; onChange: (v: boolean) => void; labelledBy: string }) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      onClick={() => {
        haptic.select();
        onChange(!checked);
      }}
    >
      <span />
    </button>
  );
}

/** Плитка даты: день недели и число. */
export function DateTile({ day }: { day: string }) {
  return (
    <span className="date-tile" aria-hidden="true">
      <small>{weekdayShort(day)}</small>
      <b>{dayNumber(day)}</b>
    </span>
  );
}

/**
 * Главное и второе действие экрана. В Telegram это нативные MainButton и SecondaryButton,
 * вне его — своя панель внизу. Пояснение показываем текстом над кнопками.
 */
export function ActionBar({ main, secondary, note }: { main?: BarAction; secondary?: BarAction; note?: string | null }) {
  const bar = useRef<ReturnType<typeof pushBar> | null>(null);
  const latest = useRef({ main, secondary });
  latest.current = { main, secondary };

  useEffect(() => {
    if (!nativeBar) return;
    // Обработчики берём из последнего рендера, чтобы не перерегистрировать их на каждый ввод.
    const proxy = (pick: 'main' | 'secondary') => () => latest.current[pick]?.onClick();
    const state = () => ({
      main: latest.current.main && { ...latest.current.main, onClick: proxy('main') },
      secondary: latest.current.secondary && { ...latest.current.secondary, onClick: proxy('secondary') },
    });
    bar.current = pushBar(state());
    return () => {
      bar.current?.remove();
      bar.current = null;
    };
  }, []);

  useEffect(() => {
    if (!nativeBar || !bar.current) return;
    const proxy = (pick: 'main' | 'secondary') => () => latest.current[pick]?.onClick();
    bar.current.update({
      main: main && { ...main, onClick: proxy('main') },
      secondary: secondary && { ...secondary, onClick: proxy('secondary') },
    });
  }, [main?.label, main?.disabled, main?.busy, secondary?.label, secondary?.disabled, !!main, !!secondary]);

  if (nativeBar) {
    return note ? <div className="bar-note">{note}</div> : null;
  }
  if (!main && !secondary && !note) return null;
  return (
    <div className="bar">
      {note && <div className="bar-note" style={{ padding: 0 }}>{note}</div>}
      {main && (
        <button type="button" className="btn" onClick={main.onClick} disabled={main.disabled || main.busy} aria-busy={main.busy}>
          {main.busy ? 'Секунду…' : main.label}
        </button>
      )}
      {secondary && (
        <button type="button" className="btn secondary" onClick={secondary.onClick} disabled={secondary.disabled}>
          {secondary.label}
        </button>
      )}
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Загрузка" />;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="content">
      <div className="error-box" role="alert">
        {message}
      </div>
      {onRetry && (
        <button type="button" className="btn-link" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}

/** Меню снизу с вариантами действия. */
export function ActionSheet({
  title,
  options,
  onClose,
}: {
  title: string;
  options: { label: string; run: () => void }[];
  onClose: () => void;
}) {
  return createPortal(
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="action-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="action-title">{title}</div>
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            className="btn secondary"
            onClick={() => {
              onClose();
              o.run();
            }}
          >
            {o.label}
          </button>
        ))}
        <button type="button" className="btn-link" style={{ alignSelf: 'center' }} onClick={onClose}>
          Отмена
        </button>
      </div>
    </div>,
    document.body,
  );
}

// ---------- всплывающие сообщения ----------

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string) => {
    window.clearTimeout(timer.current);
    setMessage(text);
    timer.current = window.setTimeout(() => setMessage(null), 2600);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
