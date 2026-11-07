import type { ReactNode } from 'react';
import type { Format } from '../../../shared/types.ts';
import { FORMAT_ICON } from '../lib/themes.tsx';

/** Обложка сходки: сплошной лайм и значок формата, рисуется сразу. */
export function PlanCover({ format, action, children }: { format: Format; action?: ReactNode; children: ReactNode }) {
  const Icon = FORMAT_ICON[format];
  return (
    <div className="cover">
      <div className="cover-top">
        <span className="cover-icon">
          <Icon size={28} />
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}
