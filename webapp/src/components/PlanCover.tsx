import type { ReactNode } from 'react';
import type { Format } from '../../../shared/types.ts';
import { FORMAT_THEME } from '../lib/themes.tsx';

/** Обложка сходки: цвет и большой значок зависят от формата. */
export function PlanCover({ format, children }: { format: Format; children: ReactNode }) {
  const { from, to, Icon } = FORMAT_THEME[format];
  return (
    <div className="cover" style={{ background: `linear-gradient(145deg, ${from}, ${to})` }}>
      <Icon size={132} strokeWidth={1.4} className="cover-mark" />
      {children}
    </div>
  );
}

export function FormatTile({ format, muted = false }: { format: Format; muted?: boolean }) {
  const { from, to, Icon } = FORMAT_THEME[format];
  return (
    <span className={muted ? 'tile small muted-tile' : 'tile small'} style={{ background: `linear-gradient(145deg, ${from}, ${to})` }}>
      <Icon size={20} />
    </span>
  );
}
