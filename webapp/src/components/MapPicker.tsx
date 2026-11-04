import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Format, LatLng } from '../../../shared/types.ts';
import { CITY_CENTER, hasSearch, resolvePlace, reverseGeocode, searchPlaces } from '../lib/ymaps.ts';
import type { FoundPlace } from '../lib/ymaps.ts';
import { useNav } from '../nav.tsx';
import { expandApp, getLocation, haptic } from '../telegram.ts';
import { IconSearch, IconTarget } from './icons.tsx';
import { MapView } from './MapView.tsx';

const CATEGORIES = [
  { label: 'Кафе', query: 'кафе и рестораны' },
  { label: 'Кофейни', query: 'кофейни' },
  { label: 'Бары', query: 'бары' },
  { label: 'Развлечения', query: 'развлечения' },
  { label: 'Парки', query: 'парки' },
];

/** С какой категории начать поиск для формата встречи. */
const FORMAT_CATEGORY: Partial<Record<Format, string>> = {
  eat: 'кафе и рестораны',
  coffee: 'кофейни',
  bar: 'бары',
  active: 'развлечения',
  walk: 'парки',
};

const POINT_NAME = 'Точка на карте';

/** Выбор места внутри Mini App: поиск Яндекса, метки на карте и точка нажатием. */
export function MapPicker({
  format,
  near,
  initial,
  onSelect,
  onClose,
}: {
  format: Format;
  near: LatLng | null;
  initial: LatLng | null;
  onSelect: (place: FoundPlace & LatLng) => void;
  onClose: () => void;
}) {
  const nav = useNav();
  const start = initial ?? near ?? CITY_CENTER;
  const center = useRef<LatLng>(start);
  const request = useRef(0);
  const [query, setQuery] = useState(() => (hasSearch ? (FORMAT_CATEGORY[format] ?? '') : ''));
  const [results, setResults] = useState<FoundPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<FoundPlace | null>(null);
  const [focus, setFocus] = useState<LatLng | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // На карте тесно в половине экрана; «Назад» закрывает выбор, а не экран под ним.
  useEffect(() => {
    expandApp();
    nav.setOverlayBack(() => {
      onClose();
      return true;
    });
    document.body.style.overflow = 'hidden';
    return () => {
      nav.setOverlayBack(null);
      document.body.style.overflow = '';
    };
  }, [nav, onClose]);

  useEffect(() => {
    const text = query.trim();
    const id = ++request.current;
    if (!hasSearch || text.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searchPlaces(text, center.current)
        .then((found) => {
          if (id !== request.current) return;
          setResults(found);
          setFailed(false);
        })
        .catch(() => {
          if (id !== request.current) return;
          setResults([]);
          setFailed(true);
        })
        .finally(() => {
          if (id === request.current) setSearching(false);
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const marks = useMemo(
    () => results.flatMap((r, i) => (r.lat !== null && r.lng !== null ? [{ lat: r.lat, lng: r.lng, label: String(i + 1) }] : [])),
    [results],
  );
  const point = selected && selected.lat !== null && selected.lng !== null ? { ...selected, lat: selected.lat, lng: selected.lng } : null;

  async function choose(place: FoundPlace) {
    haptic.select();
    const id = ++request.current;
    setSelected(place);
    const full = await resolvePlace(place);
    if (id !== request.current) return;
    setSelected(full);
    if (full.lat !== null && full.lng !== null) setFocus({ lat: full.lat, lng: full.lng });
  }

  function pickPoint(point: LatLng) {
    haptic.select();
    const id = ++request.current;
    setSearching(false);
    // Выбранная подсказка без координат получает точку, которую поставил человек.
    if (selected && selected.lat === null) {
      setSelected({ ...selected, ...point });
      return;
    }
    setSelected({ ...point, name: POINT_NAME, address: null });
    void reverseGeocode(point).then((name) => {
      if (name && id === request.current) setSelected({ ...point, name, address: null });
    });
  }

  async function locate() {
    const here = await getLocation();
    if (!here) {
      setNotice('Не удалось определить местоположение');
      return;
    }
    setNotice(null);
    setFocus(here);
    pickPoint(here);
  }

  let hint = 'Нажмите на карту, чтобы поставить точку';
  if (!hasSearch) hint = 'Нажмите на карту, чтобы поставить точку. Поиск заработает с ключом Яндекс Карт.';
  else if (failed) hint = 'Поиск сейчас не отвечает. Поставьте точку на карте.';
  else if (searching) hint = 'Ищем…';
  else if (query.trim().length >= 2) hint = 'Ничего не нашли. Измените запрос или поставьте точку на карте.';

  return createPortal(
    <div className="picker" role="dialog" aria-modal="true" aria-label="Выбор места">
      <MapView
        className="map picker-map"
        initialView={start}
        marks={marks}
        pick={point}
        focus={focus}
        onMoveEnd={(c) => {
          center.current = c;
        }}
        onPick={pickPoint}
        onMarkClick={(i) => void choose(results.filter((r) => r.lat !== null)[i])}
      />

      <div className="picker-top">
        <div className="row">
          <label className="search-field grow">
            <IconSearch size={17} />
            <span className="sr-only">Поиск места</span>
            <input
              value={query}
              placeholder="Поиск места или адреса"
              enterKeyHint="search"
              onChange={(e) => {
                setSelected(null);
                setQuery(e.target.value);
              }}
            />
          </label>
          <button type="button" className="btn-plain" onClick={onClose}>
            Отмена
          </button>
        </div>
        {hasSearch && (
          <div className="chips scroll">
            {CATEGORIES.map((c) => (
              <button
                key={c.query}
                type="button"
                className="chip sm glass"
                aria-pressed={query === c.query}
                onClick={() => {
                  haptic.select();
                  setSelected(null);
                  setQuery(c.query);
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <section className="picker-panel">
        <div className="handle" aria-hidden="true" />
        <button type="button" className="map-locate" onClick={locate} aria-label="Моё местоположение">
          <IconTarget size={20} />
        </button>
        {selected ? (
          <div className="picker-selected">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{selected.name}</div>
              {selected.address && <div className="caption">{selected.address}</div>}
            </div>
            {point ? (
              <button type="button" className="btn-main" onClick={() => onSelect(point)}>
                Выбрать это место
              </button>
            ) : (
              <div className="pick-hint" role="status">
                Нажмите на карту, где находится это место
              </div>
            )}
          </div>
        ) : results.length > 0 ? (
          <div className="picker-results">
            {results.map((r, i) => (
              <button key={`${r.lat},${r.lng},${i}`} type="button" className="list-row" onClick={() => void choose(r)}>
                <span className="place-num" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span className="list-title">{r.name}</span>
                  {r.address && <span className="caption">{r.address}</span>}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="caption" role="status" style={{ padding: '8px 4px 12px', fontSize: 15 }}>
            {notice ?? hint}
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
