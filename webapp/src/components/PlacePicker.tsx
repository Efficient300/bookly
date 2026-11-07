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
    <div className="group">
      <button type="button" className="row" onClick={() => setOpen(true)}>
        <span className="row-icon">
          <IconPin size={20} />
        </span>
        <span className="lbl">
          <span>{point ? value.name || 'Место на карте' : 'Выбрать на карте'}</span>
          <span className="sub">{point ? 'Изменить' : 'Поиск по Ташкенту или точка на карте'}</span>
        </span>
        <IconChevron size={16} className="chev" />
      </button>
      {point && (
        <label className="row" htmlFor={`${id}-name`}>
          <span className="lbl">
            <span>Название</span>
          </span>
          <input
            id={`${id}-name`}
            style={{ flex: 2, minWidth: 0 }}
            value={value.name}
            maxLength={60}
            placeholder="Например, чайхана «Навруз»"
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
