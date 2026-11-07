import { useState } from 'react';
import type { LatLng } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { IconTarget } from '../components/icons.tsx';
import { ActionBar, ErrorBox, Spinner, useToast } from '../components/ui.tsx';
import { useNav, usePlan } from '../nav.tsx';
import { getLocation, haptic } from '../telegram.ts';

/** Районы Ташкента и их примерные центры. Сервер всё равно хранит точку с точностью ~1 км. */
const DISTRICTS: { name: string; at: LatLng }[] = [
  { name: 'Алмазар', at: { lat: 41.348, lng: 69.211 } },
  { name: 'Бектемир', at: { lat: 41.209, lng: 69.334 } },
  { name: 'Мирабад', at: { lat: 41.287, lng: 69.284 } },
  { name: 'Мирзо-Улугбек', at: { lat: 41.338, lng: 69.334 } },
  { name: 'Сергели', at: { lat: 41.222, lng: 69.218 } },
  { name: 'Учтепа', at: { lat: 41.3, lng: 69.18 } },
  { name: 'Чиланзар', at: { lat: 41.276, lng: 69.203 } },
  { name: 'Шайхантахур', at: { lat: 41.327, lng: 69.239 } },
  { name: 'Юнусабад', at: { lat: 41.367, lng: 69.287 } },
  { name: 'Яккасарай', at: { lat: 41.287, lng: 69.257 } },
  { name: 'Яшнабад', at: { lat: 41.29, lng: 69.335 } },
  { name: 'Янгихаёт', at: { lat: 41.19, lng: 69.258 } },
];

function nearest(point: LatLng): string {
  const d = (a: LatLng) => (a.lat - point.lat) ** 2 + (a.lng - point.lng) ** 2;
  return DISTRICTS.reduce((best, x) => (d(x.at) < d(best.at) ? x : best)).name;
}

/** «Откуда поедете»: район чипом, геопозиция — по желанию. */
export function Area({ id }: { id: string }) {
  const nav = useNav();
  const toast = useToast();
  const { plan, setPlan, error, reload } = usePlan(id);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<{ name: string; at: LatLng } | null>(null);

  if (error && !plan) return <ErrorBox message={error} onRetry={reload} />;
  if (!plan) return <Spinner />;

  const current = picked?.name ?? (plan.me.area ? nearest(plan.me.area) : null);

  async function save(area: LatLng, name: string) {
    setBusy(true);
    try {
      setPlan(await api.updateMe(id, { area }));
      setPicked({ name, at: area });
      haptic.success();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function locate() {
    const here = await getLocation();
    if (!here) {
      toast('Не удалось определить местоположение');
      return;
    }
    void save(here, nearest(here));
  }

  return (
    <div className="screen">
      <main className="content">
        <div className="stack" style={{ gap: 8 }}>
          <span className="note">{plan.title}</span>
          <h1 className="h1">Откуда вы поедете?</h1>
          <p className="note" style={{ margin: 0 }}>
            {plan.isOwner ? 'Вы выберете' : `${plan.ownerName} выберет`} место посередине между всеми. Точный адрес не нужен, только район.
          </p>
        </div>

        <div className="chips" role="group" aria-label="Район">
          {DISTRICTS.map((d) => (
            <button
              key={d.name}
              type="button"
              className="chip"
              aria-pressed={current === d.name}
              disabled={busy}
              onClick={() => {
                haptic.select();
                void save(d.at, d.name);
              }}
            >
              {d.name}
            </button>
          ))}
        </div>

        <button type="button" className="btn-link" onClick={locate} disabled={busy}>
          <IconTarget size={20} />
          Определить по геопозиции
        </button>

        {current && <span className="note">Готово: {current}</span>}
      </main>

      <ActionBar
        main={{
          label: 'Готово',
          disabled: !current,
          onClick: () => {
            toast('Ответ отправлен');
            nav.reset([{ name: 'home' }, { name: 'plan', id }]);
          },
        }}
        note={current ? null : 'Выберите район'}
      />
    </div>
  );
}
