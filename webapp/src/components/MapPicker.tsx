import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Format, LatLng } from '../../../shared/types.ts';
import { CITY_CENTER, CITY_NAME, distanceLabel, hasSearch, reverseGeocode, searchPlaces } from '../lib/ymaps.ts';
import type { FoundPlace } from '../lib/ymaps.ts';
import { useNav } from '../nav.tsx';
import { expandApp, getLocation, haptic } from '../telegram.ts';
import { IconSearch, IconTarget, IconX } from './icons.tsx';
import { MapView } from './MapView.tsx';
import { ActionBar } from './ui.tsx';

const CATEGORIES = [
  { label: 'Рестораны', query: 'ресторан' },
  { label: 'Чайханы', query: 'чайхана' },
  { label: 'Кафе', query: 'кафе' },
  { label: 'Кофейни', query: 'кофейня' },
  { label: 'Фастфуд', query: 'фастфуд' },
  { label: 'Бары', query: 'бар' },
];

/** С какой категории начать поиск для формата встречи. */
const FORMAT_QUERY: Partial<Record<Format, string>> = {
  eat: 'ресторан',
  coffee: 'кофейня',
  bar: 'бар',
  active: 'боулинг',
  walk: 'парк',
  any: 'кафе',
};

const POINT_NAME = 'Точка на карте';

export type PickedPlace = FoundPlace & LatLng;

/** Выбор места внутри Mini App: поиск по городу, номерные пины, расстояние, выбор в одно касание. */
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
  onSelect: (place: PickedPlace) => void;
  onClose: () => void;
}) {
  const nav = useNav();
  const start = initial ?? near ?? CITY_CENTER;
  const center = useRef<LatLng>(start);
  const request = useRef(0);
  const [query, setQuery] = useState(() => (hasSearch ? (FORMAT_QUERY[format] ?? '') : ''));
  const [results, setResults] = useState<FoundPlace[]>([]);
  const [withPoints, setWithPoints] = useState(true);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<FoundPlace | null>(null);
  const [focus, setFocus] = useState<LatLng | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Форма под картой не перемонтируется: карта открывается поверх, «Назад» закрывает только её.
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
          setResults(found.places);
          setWithPoints(found.withPoints);
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
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const marks = useMemo(
    () =>
      results.flatMap((r, i) =>
        r.lat !== null && r.lng !== null ? [{ lat: r.lat, lng: r.lng, label: String(i + 1), selected: r === selected }] : [],
      ),
    [results, selected],
  );
  const point: PickedPlace | null = selected && selected.lat !== null && selected.lng !== null ? { ...selected, lat: selected.lat, lng: selected.lng } : null;

  function choose(place: FoundPlace) {
    haptic.select();
    ++request.current;
    setSelected(place);
    if (place.lat !== null && place.lng !== null) setFocus({ lat: place.lat, lng: place.lng });
  }

  function pickPoint(p: LatLng) {
    haptic.select();
    // Подсказка без координат получает точку, которую поставил человек.
    if (selected && selected.lat === null) {
      setSelected({ ...selected, ...p });
      return;
    }
    const id = ++request.current;
    setSearching(false);
    const own: FoundPlace = { ...p, name: POINT_NAME, address: null, distance: null };
    setSelected(own);
    void reverseGeocode(p).then((name) => {
      if (name && id === request.current) setSelected({ ...own, name });
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

  let status: string | null = null;
  if (notice) status = notice;
  else if (!hasSearch) status = 'Поиск не подключён. Нажмите на карту, чтобы поставить точку.';
  else if (failed) status = 'Поиск сейчас не отвечает. Поставьте точку на карте.';
  else if (searching) status = 'Ищем…';
  else if (query.trim().length >= 2 && results.length === 0) status = 'Ничего не нашли рядом. Измените запрос или поставьте точку на карте.';
  else if (query.trim().length < 2) status = 'Найдите заведение или нажмите на карту.';

  const needsPoint = selected !== null && selected.lat === null;

  return createPortal(
    <div className="picker" role="dialog" aria-modal="true" aria-label="Выбор места">
      <div className="picker-head">
        <div className="row-flex" style={{ justifyContent: 'space-between' }}>
          <h2 className="section-title">Выбор места</h2>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={onClose}>
            <IconX size={20} />
          </button>
        </div>
        <label className="search">
          <IconSearch size={20} />
          <span className="sr-only">Поиск места</span>
          <input
            value={query}
            placeholder="Плов, лагман, кофейня…"
            enterKeyHint="search"
            onChange={(e) => {
              setSelected(null);
              setQuery(e.target.value);
            }}
          />
          <span className="city">{CITY_NAME}</span>
        </label>
        {hasSearch && (
          <div className="chips strip" style={{ margin: '0 -16px', padding: '0 16px' }}>
            {CATEGORIES.map((c) => (
              <button
                key={c.query}
                type="button"
                className="chip"
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

      <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
        <MapView
          className="map picker-map"
          initialView={start}
          marks={marks}
          pick={point && !(withPoints && selected && results.includes(selected)) ? point : null}
          focus={focus}
          onMoveEnd={(c) => {
            center.current = c;
          }}
          onPick={pickPoint}
          onMarkClick={(i) => choose(results.filter((r) => r.lat !== null)[i])}
        />
        <button type="button" className="icon-btn locate" onClick={locate} aria-label="Моё местоположение">
          <IconTarget size={20} />
        </button>
      </div>

      <div className="picker-list">
        {results.length > 0 && !withPoints && (
          <div className="picker-status">Координат у подсказок нет: выберите место и нажмите на карту, где оно находится.</div>
        )}
        {results.map((r, i) => (
          <button key={`${r.name}-${i}`} type="button" className="row" aria-pressed={selected === r || (selected?.name === r.name && selected?.address === r.address)} onClick={() => choose(r)}>
            <span className="place-num" aria-hidden="true">
              {i + 1}
            </span>
            <span className="lbl">
              <span>{r.name}</span>
              {r.address && <span className="sub">{r.address}</span>}
            </span>
            {r.distance !== null && <span className="distance">{distanceLabel(r.distance)}</span>}
          </button>
        ))}
        {status && results.length === 0 && <div className="picker-status">{status}</div>}
      </div>

      <ActionBar
        note={needsPoint ? 'Нажмите на карту, где находится это место' : null}
        main={{
          label: point ? `Выбрать «${point.name}»` : 'Выберите место',
          disabled: !point,
          onClick: () => point && onSelect(point),
        }}
      />
    </div>,
    document.body,
  );
}
