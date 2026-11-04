// Яндекс Карты, JS API 2.1. Скрипт грузится один раз, при первом показе карты.
// Без ключа карта открывается, но только для разработки: для продакшена получите ключ
// «JavaScript API и HTTP Геокодер» в кабинете разработчика Яндекса (VITE_YANDEX_MAPS_KEY).
import type { LatLng } from '../../../shared/types.ts';

const KEY = import.meta.env.VITE_YANDEX_MAPS_KEY ?? '';

/** Центр города по умолчанию — Ташкент. */
export const CITY_CENTER: LatLng = { lat: 41.3111, lng: 69.2797 };

type Coords = [number, number];

export interface YEvent {
  get(name: 'coords' | 'newCenter'): Coords;
}

export interface YGeoObject {
  events: { add(type: string, cb: () => void): void };
}

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
  setBounds(bounds: Coords[], options?: { checkZoomRange?: boolean; zoomMargin?: number }): Promise<void>;
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
}

declare global {
  interface Window {
    ymaps?: YMaps;
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

/** Координаты в порядке Яндекса: широта, долгота. */
export const toCoords = (p: LatLng): Coords => [p.lat, p.lng];
export const fromCoords = ([lat, lng]: Coords): LatLng => ({ lat, lng });
