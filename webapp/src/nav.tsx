import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { NewPlan, PlanView } from '../../shared/types.ts';
import { ApiError, api } from './api.ts';

export type Route =
  | { name: 'home' }
  | { name: 'create'; template?: Partial<NewPlan>; chatId?: number }
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
  /** То же для окна поверх экрана: срабатывает первым и не трогает перехват экрана. */
  setOverlayBack(fn: (() => boolean) | null): void;
}

export const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('NavContext не подключён');
  return nav;
}

// Последняя загруженная версия плана: экраны одного плана открываются без мигания.
const planCache = new Map<string, PlanView>();

export const forgetPlan = (id: string) => planCache.delete(id);

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
      // Сходку удалили: копия из кэша больше не нужна, показываем ошибку.
      if (err instanceof ApiError && err.status === 404) {
        planCache.delete(id);
        setPlanState(null);
      }
      setError((err as Error).message);
    }
  }, [id, setPlan]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { plan, setPlan, error, reload };
}
