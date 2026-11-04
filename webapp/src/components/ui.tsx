import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { dayNumber, initials, weekdayShort } from '../../../shared/format.ts';
import type { MemberStatus } from '../../../shared/types.ts';
import { haptic } from '../telegram.ts';
import { IconCheck, IconQuestion, IconUpDown, IconX } from './icons.tsx';

const AVATAR_TONES = 6;

function tone(seed: string | number): string {
  const n = typeof seed === 'number' ? seed : [...seed].reduce((s, c) => s + c.charCodeAt(0), 0);
  return `var(--av-${(Math.abs(n) % AVATAR_TONES) + 1})`;
}

export function Avatar({
  name,
  seed,
  photo = null,
  size = 28,
}: {
  name: string;
  seed?: string | number;
  photo?: string | null;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.43, background: tone(seed ?? name) }}
    >
      {initials(name)}
      {photo && !broken && <img src={photo} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />}
    </span>
  );
}

export function AvatarStack({
  people,
  max = 5,
  size = 28,
}: {
  people: { id: number; name: string; photo?: string | null }[];
  max?: number;
  size?: number;
}) {
  return (
    <span className="avatars" aria-hidden="true">
      {people.slice(0, max).map((p) => (
        <Avatar key={p.id} name={p.name} seed={p.id} photo={p.photo} size={size} />
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
    <div className="segmented" role="group" aria-label={label}>
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

/** Строка со списком вариантов: на телефоне открывается системное меню выбора. */
export function SelectRow<T extends string>({
  label,
  options,
  value,
  onChange,
  suffix = '',
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  suffix?: string;
}) {
  const current = options.find((o) => o.value === value)?.label ?? '';
  return (
    <label className="list-row select-row">
      <span className="grow list-title">{label}</span>
      <span className="row-value">
        {current}
        {suffix}
      </span>
      <IconUpDown size={16} className="row-chevron" />
      <select
        value={value}
        aria-label={label}
        onChange={(e) => {
          haptic.select();
          onChange(e.target.value as T);
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const STATUSES: { value: MemberStatus; label: string; Icon: typeof IconCheck }[] = [
  { value: 'go', label: 'Иду', Icon: IconCheck },
  { value: 'maybe', label: 'Может быть', Icon: IconQuestion },
  { value: 'no', label: 'Не могу', Icon: IconX },
];

/** Три большие кнопки вместо мелкого переключателя: нажать можно не глядя. */
export function StatusPicker({ value, onChange }: { value: MemberStatus | null; onChange: (value: MemberStatus) => void }) {
  return (
    <div className="status-picker" role="group" aria-label="Ваш статус">
      {STATUSES.map(({ value: v, label, Icon }) => (
        <button
          key={v}
          type="button"
          className={`status-item ${v}`}
          aria-pressed={value === v}
          onClick={() => {
            haptic.select();
            onChange(v);
          }}
        >
          <span className="status-icon">
            <Icon size={22} strokeWidth={2.5} />
          </span>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Плитка даты, как значок календаря: день недели и число. */
export function DateTile({ day }: { day: string }) {
  return (
    <span className="date-tile" aria-hidden="true">
      <small>{weekdayShort(day)}</small>
      <b>{dayNumber(day)}</b>
    </span>
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
        <div className="list">
          <div className="action-title">{title}</div>
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              className="action-option"
              onClick={() => {
                onClose();
                o.run();
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button type="button" className="action-option cancel" onClick={onClose}>
          Отмена
        </button>
      </div>
    </div>,
    document.body,
  );
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

export function ToggleRow({ id, title, hint, checked, onChange }: { id: string; title: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="list-row">
      <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div id={id} style={{ fontSize: 15, fontWeight: 500 }}>
          {title}
        </div>
        {hint && <div className="caption">{hint}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} labelledBy={id} />
    </div>
  );
}

export function BottomBar({ children }: { children: ReactNode }) {
  return <div className="bottom-bar">{children}</div>;
}

export function MainButton({
  children,
  onClick,
  disabled,
  busy,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button type="button" className="btn-main" onClick={onClick} disabled={disabled || busy} aria-busy={busy}>
      {busy ? 'Секунду…' : children}
    </button>
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
        <button type="button" className="btn-text" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
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
