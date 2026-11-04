import { useState } from 'react';
import type { Format, LatLng, NewPlace } from '../../../shared/types.ts';
import { yandexSearchUrl } from '../lib/links.ts';
import { CITY_CENTER } from '../lib/ymaps.ts';
import { getLocation, haptic, openLink } from '../telegram.ts';
import { IconSearch, IconTarget } from './icons.tsx';
import { MapView } from './MapView.tsx';

export const emptyPlace = (): NewPlace => ({ name: '', url: null, lat: null, lng: null });

export const placePoint = (p: NewPlace): LatLng | null => (p.lat !== null && p.lng !== null ? { lat: p.lat, lng: p.lng } : null);

/**
 * Своё место: поиск по интересам в Яндекс Картах, название, точка на карте и ссылка.
 * Точку ставят нажатием на карту или кнопкой «Я здесь».
 */
export function PlacePicker({
  id,
  value,
  onChange,
  format,
  near = null,
  onError,
}: {
  id: string;
  value: NewPlace;
  onChange: (place: NewPlace) => void;
  /** Формат встречи — по нему ищем места в Яндекс Картах. */
  format: Format;
  /** Где начать карту и поиск, если точка ещё не отмечена. */
  near?: LatLng | null;
  onError?: (message: string) => void;
}) {
  const [focus, setFocus] = useState<LatLng | null>(null);
  const point = placePoint(value);
  const set = (patch: Partial<NewPlace>) => onChange({ ...value, ...patch });

  async function locate() {
    const here = await getLocation();
    if (!here) {
      onError?.('Не удалось определить местоположение');
      return;
    }
    set(here);
    setFocus(here);
  }

  return (
    <div className="place-picker">
      <button
        type="button"
        className="btn-secondary row"
        style={{ justifyContent: 'center' }}
        onClick={() => openLink(yandexSearchUrl(format, point ?? near ?? CITY_CENTER))}
      >
        <IconSearch size={18} />
        Найти место в Яндекс Картах
      </button>

      <div className="field">
        <label className="label" htmlFor={`${id}-name`}>
          Название
        </label>
        <input
          id={`${id}-name`}
          className="input"
          value={value.name}
          maxLength={60}
          placeholder="Например, кафе «Чайхана»"
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>

      <div className="field">
        <span className="label">Точка на карте</span>
        <div className="map-box">
          <MapView
            className="map small"
            initialView={point ?? near}
            pick={point}
            focus={focus}
            onPick={(p) => {
              haptic.select();
              set(p);
            }}
          />
          <span className="map-hint">{point ? 'Точка отмечена — можно поправить' : 'Нажмите на карту, чтобы отметить место'}</span>
          <button type="button" className="map-locate" onClick={locate} aria-label="Я здесь">
            <IconTarget size={20} />
          </button>
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor={`${id}-url`}>
          Ссылка на место (необязательно)
        </label>
        <input
          id={`${id}-url`}
          className="input"
          type="url"
          inputMode="url"
          value={value.url ?? ''}
          placeholder="https://yandex.uz/maps/…"
          onChange={(e) => set({ url: e.target.value.trim() || null })}
        />
      </div>
    </div>
  );
}
