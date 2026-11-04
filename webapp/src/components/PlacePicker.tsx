import { useCallback, useState } from 'react';
import type { Format, LatLng, NewPlace } from '../../../shared/types.ts';
import { IconChevron, IconPin } from './icons.tsx';
import { MapPicker } from './MapPicker.tsx';

export const emptyPlace = (): NewPlace => ({ name: '', url: null, lat: null, lng: null });

export const placePoint = (p: NewPlace): LatLng | null => (p.lat !== null && p.lng !== null ? { lat: p.lat, lng: p.lng } : null);

/** Своё место: выбор на карте внутри Mini App и название, которое можно поправить. */
export function PlacePicker({
  id,
  value,
  onChange,
  format,
  near = null,
}: {
  id: string;
  value: NewPlace;
  onChange: (place: NewPlace) => void;
  /** Формат встречи — с него начинается поиск мест. */
  format: Format;
  /** Где начать карту, если точка ещё не отмечена. */
  near?: LatLng | null;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const point = placePoint(value);

  return (
    <div className="list">
      <button type="button" className="list-row" onClick={() => setOpen(true)}>
        <span className="icon-box">
          <IconPin size={20} />
        </span>
        <span className="grow list-title">{point ? 'Изменить на карте' : 'Выбрать на карте'}</span>
        <IconChevron size={18} style={{ color: 'var(--muted)' }} />
      </button>
      {point && (
        <label className="list-row input-row" htmlFor={`${id}-name`}>
          <span className="input-label">Название</span>
          <input
            id={`${id}-name`}
            className="grow"
            value={value.name}
            maxLength={60}
            placeholder="Например, кафе «Чайхана»"
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
        </label>
      )}
      {open && (
        <MapPicker
          format={format}
          near={near}
          initial={point}
          onClose={close}
          onSelect={(place) => {
            // Название точки без адреса не затирает то, что человек уже вписал.
            const generic = place.name === 'Точка на карте';
            const name = generic && value.name.trim() ? value.name : place.name.slice(0, 60);
            onChange({ ...value, name, lat: place.lat, lng: place.lng });
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
