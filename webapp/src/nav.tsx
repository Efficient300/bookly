import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { NewPlan, PlanView } from '../../shared/types.ts';
import { api } from './api.ts';

export type Route =
  | { name: 'home' }
  | { name: 'create'; template?: Partial<NewPlan> }
  | { name: 'plan'; id: string }
  | { name: 'results'; id: string }
  | { name: 'places'; id: string }
  | { name: 'area'; id: string };

export interface Nav {
  push(route: Route): void;
  pop(): void;
  reset(routes: Route[]): void;
  /** Экран может перехватить «Назад» (например, шаги мастера). Вернуть true — обработано. */
  setBackOverride(fn: (() => boolean) | null): void;
}

export const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('NavContext не подключён');
  return nav;
}

// Последняя загруженная версия плана: экраны одного плана открываются без мигания.
const planCache = new Map<string, PlanView>();

export function usePlan(id: string) {
  const [plan, setPlanState] = useState<PlanView | null>(planCache.get(id) ?? null);
  const [error, setError] = useState<string | null>(null);

  const setPlan = useCallback(
    (next: PlanView) => {
      planCache.set(id, next);
      setPlanState(next);
    },
    [id],
  );

  const reload = useCallback(async () => {
    try {
      setPlan(await api.plan(id));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id, setPlan]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { plan, setPlan, error, reload };
}
