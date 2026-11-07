import { useEffect, useMemo, useRef, useState } from 'react';
import { ToastProvider } from './components/ui.tsx';
import { NavContext } from './nav.tsx';
import type { Nav, Route } from './nav.tsx';
import { Area } from './screens/Area.tsx';
import { Create } from './screens/Create.tsx';
import { Home } from './screens/Home.tsx';
import { Places } from './screens/Places.tsx';
import { PlanScreen } from './screens/PlanScreen.tsx';
import { Ready } from './screens/Ready.tsx';
import { Results } from './screens/Results.tsx';
import { inTelegram, startParam, tg } from './telegram.ts';

function initialStack(): Route[] {
  const param = startParam();
  if (param?.startsWith('p_')) return [{ name: 'home' }, { name: 'plan', id: param.slice(2) }];
  if (param === 'new') return [{ name: 'home' }, { name: 'create' }];
  // new_<id группы> — создание из кнопки в группе.
  const group = param?.match(/^new_(-\d+)$/);
  if (group) return [{ name: 'home' }, { name: 'create', chatId: Number(group[1]) }];
  return [{ name: 'home' }];
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <Home />;
    case 'create':
      return <Create template={route.template} chatId={route.chatId} />;
    case 'plan':
      return <PlanScreen id={route.id} />;
    case 'ready':
      return <Ready id={route.id} posted={route.posted} />;
    case 'results':
      return <Results id={route.id} />;
    case 'places':
      return <Places id={route.id} />;
    case 'area':
      return <Area id={route.id} />;
  }
}

export function App() {
  const [stack, setStack] = useState<Route[]>(initialStack);
  const overlayBack = useRef<(() => boolean) | null>(null);

  const nav = useMemo<Nav>(
    () => ({
      push: (route) => setStack((s) => [...s, route]),
      pop: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
      reset: (routes) => setStack(routes),
      setOverlayBack: (fn) => {
        overlayBack.current = fn;
      },
    }),
    [],
  );

  const goBack = () => {
    if (overlayBack.current?.()) return;
    nav.pop();
  };
  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;

  const depth = stack.length;
  const route = stack[depth - 1];

  // Нативная кнопка «Назад» Telegram.
  useEffect(() => {
    if (!tg || !inTelegram) return;
    const handler = () => goBackRef.current();
    if (depth > 1) {
      tg.BackButton.show();
      tg.BackButton.onClick(handler);
    } else {
      tg.BackButton.hide();
    }
    return () => tg?.BackButton.offClick(handler);
  }, [depth]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  return (
    <NavContext.Provider value={nav}>
      <ToastProvider>
        {/* Вне Telegram нет нативной кнопки — показываем свою, для разработки в браузере. */}
        {!inTelegram && depth > 1 && (
          <button type="button" className="btn-link" style={{ padding: '8px 16px 0', height: 36 }} onClick={goBack}>
            ← Назад
          </button>
        )}
        <Screen key={depth + route.name + ('id' in route ? route.id : '')} route={route} />
      </ToastProvider>
    </NavContext.Provider>
  );
}
