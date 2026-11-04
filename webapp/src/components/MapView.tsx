import { useEffect, useRef, useState } from 'react';
import { initials } from '../../../shared/format.ts';
import type { LatLng, PlaceView } from '../../../shared/types.ts';
import { CITY_CENTER, fromCoords, loadYmaps, toCoords } from '../lib/ymaps.ts';
import type { YCollection, YMap, YMaps } from '../lib/ymaps.ts';

export interface Person extends LatLng {
  name: string;
  photo?: string | null;
  me?: boolean;
}

// Общий пустой список: значение по умолчанию не должно меняться между отрисовками.
const NONE: never[] = [];

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Метка из нашей разметки: кружок с номером или буквой, центр — точно в точке. */
function htmlMark(ymaps: YMaps, at: LatLng, html: string, radius: number, options: { title?: string; onClick?: () => void; transparent?: boolean } = {}) {
  const mark = new ymaps.Placemark(
    toCoords(at),
    { hintContent: options.title ?? '' },
    {
      iconLayout: ymaps.templateLayoutFactory.createClass(`<div class="ymark">${html}</div>`),
      iconShape: { type: 'Circle', coordinates: [0, 0], radius },
      // Прозрачные метки не перехватывают нажатия — они достаются карте.
      interactivityModel: options.transparent ? 'default#transparent' : 'default#geoObject',
    },
  );
  if (options.onClick) mark.events.add('click', options.onClick);
  return mark;
}

export function MapView({
  places = NONE,
  people = NONE,
  marks = NONE,
  center = null,
  focus = null,
  initialView = null,
  pick = null,
  onMoveEnd,
  onPick,
  onPlaceClick,
  onMarkClick,
  className = 'map',
}: {
  places?: PlaceView[];
  people?: Person[];
  /** Результаты поиска: при каждом новом списке карта подстраивается под них. */
  marks?: (LatLng & { label: string })[];
  center?: LatLng | null;
  focus?: LatLng | null;
  initialView?: LatLng | null;
  /** Точка, которую пользователь отметил нажатием на карту. */
  pick?: LatLng | null;
  onMoveEnd?: (center: LatLng) => void;
  /** Если задан, нажатие на карту отмечает точку. */
  onPick?: (point: LatLng) => void;
  onPlaceClick?: (place: PlaceView) => void;
  onMarkClick?: (index: number) => void;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState<{ ymaps: YMaps; map: YMap; layer: YCollection } | null>(null);
  const [failed, setFailed] = useState(false);
  const fitted = useRef(false);
  const fittedMarks = useRef<unknown>(null);
  const handlers = useRef({ onMoveEnd, onPick, onPlaceClick, onMarkClick });
  handlers.current = { onMoveEnd, onPick, onPlaceClick, onMarkClick };

  useEffect(() => {
    let alive = true;
    let map: YMap | null = null;
    loadYmaps()
      .then((ymaps) => {
        if (!alive || !el.current) return;
        const start = initialView ?? CITY_CENTER;
        map = new ymaps.Map(
          el.current,
          { center: toCoords(start), zoom: initialView ? 14 : 12, controls: [] },
          { suppressMapOpenBlock: true, yandexMapDisablePoiInteractivity: true, autoFitToViewport: 'always' },
        );
        map.events.add('boundschange', (e) => handlers.current.onMoveEnd?.(fromCoords(e.get('newCenter'))));
        map.events.add('click', (e) => handlers.current.onPick?.(fromCoords(e.get('coords'))));
        const layer = new ymaps.GeoObjectCollection();
        map.geoObjects.add(layer);
        fitted.current = !!initialView;
        setReady({ ymaps, map, layer });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      map?.destroy();
      fitted.current = false;
    };
    // Карта создаётся один раз; initialView нужен только при создании.
  }, []);

  useEffect(() => {
    if (!ready) return;
    const { ymaps, map, layer } = ready;
    layer.removeAll();

    if (center) {
      layer.add(
        new ymaps.Circle([toCoords(center), 900], {}, {
          fillColor: '#007AFF14',
          strokeColor: '#007AFF',
          strokeWidth: 2,
          strokeStyle: 'dash',
          interactivityModel: 'default#transparent',
        }),
      );
    }
    places.forEach((p, i) => {
      if (p.lat === null || p.lng === null) return;
      layer.add(
        htmlMark(ymaps, { lat: p.lat, lng: p.lng }, `<div class="pin">${i + 1}</div>`, 16, {
          title: p.name,
          onClick: () => handlers.current.onPlaceClick?.(p),
        }),
      );
    });
    for (const person of people) {
      const face = person.photo ? `<img src="${escape(person.photo)}" alt="" referrerpolicy="no-referrer" />` : '';
      const html = `<div class="pin person${person.me ? ' me' : ''}">${escape(initials(person.name))}${face}</div>`;
      layer.add(htmlMark(ymaps, person, html, 13, { title: person.name, transparent: true }));
    }

    marks.forEach((m, i) => {
      layer.add(htmlMark(ymaps, m, `<div class="pin">${escape(m.label)}</div>`, 15, { onClick: () => handlers.current.onMarkClick?.(i) }));
    });

    // Подгоняем масштаб один раз — по местам, людям и центру, без отмеченной точки.
    // Новые результаты поиска показываем всегда.
    const fitMarks = marks.length > 0 && fittedMarks.current !== marks;
    if (fitMarks) fittedMarks.current = marks;
    const bounds = layer.getBounds();
    if ((!fitted.current || fitMarks) && bounds) {
      fitted.current = true;
      // Результаты поиска не должны оказаться под панелью со списком.
      void map.setBounds(bounds, { checkZoomRange: true, zoomMargin: fitMarks ? [120, 40, 320, 40] : 48 }).then(() => {
        if (map.getZoom() > 15) void map.setZoom(15);
      });
    }

    if (pick) layer.add(htmlMark(ymaps, pick, '<div class="pin pick"></div>', 14, { transparent: true }));
  }, [ready, places, people, marks, center, pick]);

  useEffect(() => {
    if (!ready || !focus) return;
    const { map } = ready;
    void map.panTo(toCoords(focus), { flying: true, duration: 500 }).then(() => {
      if (map.getZoom() < 15) void map.setZoom(15, { duration: 200 });
    });
  }, [ready, focus]);

  if (failed) {
    return (
      <div className={`${className} map-failed`} role="status">
        Карта не загрузилась. Проверьте интернет и откройте экран ещё раз.
      </div>
    );
  }
  return <div ref={el} className={className} />;
}
