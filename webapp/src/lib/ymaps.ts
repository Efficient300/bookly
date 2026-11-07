// Яндекс Карты, JS API 2.1 — для самой карты. Скрипт грузится один раз, при первом показе карты.
// Поиск заведений идёт через наш сервер (API поиска по организациям, с координатами).
// Если серверный ключ не задан, остаются подсказки Яндекса: названия и адреса без координат.
import type { LatLng } from '../../../shared/types.ts';
import { api } from '../api.ts';

const KEY = import.meta.env.VITE_YANDEX_MAPS_KEY ?? '';

export const hasSearch = !!KEY;

/** Центр города по умолчанию — Ташкент. */
export const CITY_CENTER: LatLng = { lat: 41.3111, lng: 69.2797 };
export const CITY_NAME = 'Ташкент';

/** Дальше этого от центра карты — уже другой город. */
const MAX_DISTANCE_M = 30_000;
/** «Resto.uz» и подобные — сайты-агрегаторы, а не заведения. */
const AGGREGATOR = /\b[\w-]+\s*\.\s*(uz|ru|com|net|org|kz|info)\b/i;

/** Найденное место. Подсказки приходят без координат — точку тогда ставят на карте. */
export interface FoundPlace {
  lat: number | null;
  lng: number | null;
  name: string;
  address: string | null;
  /** Метры от центра карты. */
  distance: number | null;
}

type Coords = [number, number];

export interface YEvent {
  get(name: 'coords' | 'newCenter'): Coords;
}

export interface YGeoObject {
  events: { add(type: string, cb: () => void): void };
}

interface YFound {
  geometry: { getCoordinates(): Coords };
  properties: { get(name: string): unknown };
}

interface YSearchResult {
  geoObjects: { each(cb: (object: YFound) => void): void };
}

type YSearchOptions = { boundedBy?: Coords[]; results?: number };

export interface YCollection {
  add(object: YGeoObject): void;
  removeAll(): void;
  getBounds(): Coords[] | null;
}

export interface YMap {
  geoObjects: { add(object: YCollection): void };
  events: { add(type: string, cb: (e: YEvent) => void): void };
  getZoom(): number;
  setZoom(zoom: number, options?: { duration?: number }): Promise<void>;
  setBounds(bounds: Coords[], options?: { checkZoomRange?: boolean; zoomMargin?: number | number[] }): Promise<void>;
  panTo(center: Coords, options?: { flying?: boolean; duration?: number }): Promise<void>;
  destroy(): void;
}

export interface YMaps {
  ready(onReady: () => void, onError?: (e: unknown) => void): void;
  Map: new (el: HTMLElement, state: { center: Coords; zoom: number; controls: string[] }, options?: object) => YMap;
  Placemark: new (coords: Coords, properties: object, options: object) => YGeoObject;
  Circle: new (geometry: [Coords, number], properties: object, options: object) => YGeoObject;
  GeoObjectCollection: new () => YCollection;
  templateLayoutFactory: { createClass(template: string): unknown };
  geocode(request: string | Coords, options?: YSearchOptions): Promise<YSearchResult>;
}

declare global {
  interface Window {
    ymaps?: YMaps;
    [callback: `jsonp_skhodka_${number}`]: ((data: unknown) => void) | undefined;
  }
}

let loading: Promise<YMaps> | null = null;

export function loadYmaps(): Promise<YMaps> {
  loading ??= new Promise<YMaps>((resolve, reject) => {
    const params = new URLSearchParams({ lang: 'ru_RU' });
    if (KEY) params.set('apikey', KEY);
    const script = document.createElement('script');
    script.src = `https://api-maps.yandex.ru/2.1/?${params}`;
    script.async = true;
    script.onload = () => {
      const ymaps = window.ymaps;
      if (!ymaps) return reject(new Error('Яндекс Карты не загрузились'));
      ymaps.ready(() => resolve(ymaps), reject);
    };
    script.onerror = () => reject(new Error('Яндекс Карты не загрузились'));
    document.head.appendChild(script);
  }).catch((e: unknown) => {
    // Даём попробовать ещё раз при следующем показе карты.
    loading = null;
    throw e;
  });
  return loading;
}

let suggestId = 0;

/** Подсказки Яндекса (тот же сервис, что у JS API 3.0) с расстоянием от центра карты. */
function suggest(query: string, near: LatLng): Promise<FoundPlace[]> {
  return new Promise((resolve, reject) => {
    // Сервис подсказок принимает только имена обработчиков, начинающиеся с «jsonp_».
    const callback = `jsonp_skhodka_${++suggestId}` as const;
    const point = `${near.lng},${near.lat}`;
    const params = new URLSearchParams({
      apikey: KEY,
      text: query,
      lang: 'ru_RU',
      n: '20',
      v: '9',
      ull: point,
      ll: point,
      spn: '0.3,0.25',
      callback,
    });
    const script = document.createElement('script');
    const done = () => {
      delete window[callback];
      script.remove();
    };
    window[callback] = (data) => {
      done();
      const results = (data as { results?: SuggestResult[] }).results ?? [];
      resolve(
        results
          .filter((r) => r.type === 'business' && r.title?.text && !AGGREGATOR.test(r.title.text))
          .map((r) => ({
            lat: null,
            lng: null,
            name: r.title!.text,
            address: r.subtitle?.text ?? null,
            distance: r.distance?.value ?? null,
          }))
          .filter((r) => r.distance === null || r.distance <= MAX_DISTANCE_M)
          .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity)),
      );
    };
    script.onerror = () => {
      done();
      reject(new Error('Поиск не ответил'));
    };
    script.src = `https://suggest-maps.yandex.ru/suggest-geo?${params}`;
    document.head.appendChild(script);
  });
}

interface SuggestResult {
  type?: string;
  title?: { text: string };
  subtitle?: { text: string };
  distance?: { value: number };
}

/** Ищет заведения рядом с центром карты: с координатами через сервер, иначе подсказками. */
export async function searchPlaces(query: string, near: LatLng): Promise<{ places: FoundPlace[]; withPoints: boolean }> {
  try {
    const found = await api.searchPlaces(query, near);
    if (found.available) {
      return {
        withPoints: true,
        places: found.items.map((p) => ({ lat: p.lat, lng: p.lng, name: p.name, address: p.address ?? p.kind, distance: p.distance })),
      };
    }
  } catch {
    // Серверный поиск не ответил — пробуем подсказки.
  }
  return { withPoints: false, places: await suggest(query, near) };
}

/** Адрес точки на карте, если ключ это позволяет. */
export async function reverseGeocode(point: LatLng): Promise<string | null> {
  if (!hasSearch) return null;
  try {
    const ymaps = await loadYmaps();
    let name: string | null = null;
    (await ymaps.geocode(toCoords(point), { results: 1 })).geoObjects.each((o) => {
      name ??= String(o.properties.get('name') ?? '') || null;
    });
    return name;
  } catch {
    return null;
  }
}

/** «0,6 км», «350 м». */
export function distanceLabel(meters: number | null): string | null {
  if (meters === null) return null;
  if (meters < 1000) return `${Math.max(50, Math.round(meters / 50) * 50)} м`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} км`;
}

/** Координаты в порядке Яндекса: широта, долгота. */
export const toCoords = (p: LatLng): Coords => [p.lat, p.lng];
export const fromCoords = ([lat, lng]: Coords): LatLng => ({ lat, lng });
