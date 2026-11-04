import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { initials } from '../../../shared/format.ts';
import { haptic } from '../telegram.ts';

const AVATAR_TONES = 6;

function tone(seed: string | number): string {
  const n = typeof seed === 'number' ? seed : [...seed].reduce((s, c) => s + c.charCodeAt(0), 0);
  return `var(--av-${(Math.abs(n) % AVATAR_TONES) + 1})`;
}

export function Avatar({ name, seed, size = 28 }: { name: string; seed?: string | number; size?: number }) {
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.43, background: tone(seed ?? name) }}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ people, max = 5, size = 28 }: { people: { id: number; name: string }[]; max?: number; size?: number }) {
  return (
    <span className="avatars" aria-hidden="true">
      {people.slice(0, max).map((p) => (
        <Avatar key={p.id} name={p.name} seed={p.id} size={size} />
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
