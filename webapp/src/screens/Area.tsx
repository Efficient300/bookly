import { useEffect, useRef, useState } from 'react';
import type { LatLng } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { IconMapPinFilled, IconTarget } from '../components/icons.tsx';
import { MapView } from '../components/MapView.tsx';
import { BottomBar, ErrorBox, MainButton, Spinner, useToast } from '../components/ui.tsx';
import { CITY_CENTER } from '../lib/ymaps.ts';
import { useNav, usePlan } from '../nav.tsx';
import { expandApp, getLocation, haptic } from '../telegram.ts';

/** Выбор района «откуда поеду»: двигаем карту под булавкой. Храним с точностью ~1 км. */
export function Area({ id }: { id: string }) {
  const nav = useNav();
  const toast = useToast();
  const { plan, setPlan, error, reload } = usePlan(id);
  useEffect(expandApp, []);
  const center = useRef<LatLng | null>(null);
  const [focus, setFocus] = useState<LatLng | null>(null);
  const [busy, setBusy] = useState(false);

  if (error && !plan) return <ErrorBox message={error} onRetry={reload} />;
  if (!plan) return <Spinner />;

  const firstPlace = plan.places.find((p) => p.lat !== null && p.lng !== null);
  const start =
    plan.me.area ?? plan.center ?? (firstPlace ? { lat: firstPlace.lat as number, lng: firstPlace.lng as number } : CITY_CENTER);

  async function locate() {
    const here = await getLocation();
    if (here) setFocus(here);
    else toast('Не удалось определить местоположение');
  }

  async function save(area: LatLng | null) {
    setBusy(true);
    try {
      setPlan(await api.updateMe(id, { area }));
      haptic.success();
      nav.pop();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div className="head" style={{ padding: '20px 20px 12px' }}>
        <h1 className="h1" style={{ fontSize: 24 }}>
          Откуда поедете?
        </h1>
        <div className="caption">Двигайте карту. Сохраним только район — точный адрес никто не увидит.</div>
      </div>
      <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
        <MapView
          className="map tall"
          initialView={start}
          focus={focus}
          onMoveEnd={(c) => {
            center.current = c;
          }}
        />
        <div className="center-pin" aria-hidden="true">
          <IconMapPinFilled />
        </div>
      </div>
      <BottomBar>
        <div className="row">
          <button type="button" className="btn-secondary row grow" style={{ justifyContent: 'center' }} onClick={locate}>
            <IconTarget size={18} />
            Я здесь
          </button>
          {plan.me.area && (
            <button type="button" className="btn-secondary grow" onClick={() => save(null)} disabled={busy}>
              Убрать отметку
            </button>
          )}
        </div>
        <MainButton busy={busy} onClick={() => save(center.current ?? start)}>
          Сохранить район
        </MainButton>
      </BottomBar>
    </div>
  );
}
