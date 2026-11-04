// Обёртка над Telegram WebApp (скрипт telegram-web-app.js подключён в index.html).
// Вне Telegram (в обычном браузере) всё работает в режиме разработки.
import type { LatLng } from '../../shared/types.ts';

type ChatType = 'users' | 'bots' | 'groups' | 'channels';

export interface TgWebApp {
  initData: string;
  initDataUnsafe: {
    user?: { id: number; first_name: string; allows_write_to_pm?: boolean };
    start_param?: string;
  };
  colorScheme: 'light' | 'dark';
  isVersionAtLeast(version: string): boolean;
  ready(): void;
  expand(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor?(color: string): void;
  disableVerticalSwipes?(): void;
  onEvent(event: 'themeChanged', cb: () => void): void;
  BackButton: {
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  HapticFeedback: {
    selectionChanged(): void;
    notificationOccurred(type: 'success' | 'error' | 'warning'): void;
  };
  openLink(url: string): void;
  openTelegramLink(url: string): void;
  showConfirm(message: string, cb: (ok: boolean) => void): void;
  switchInlineQuery(query: string, chooseChatTypes?: ChatType[]): void;
  downloadFile?(params: { url: string; file_name: string }, cb?: (accepted: boolean) => void): void;
  requestWriteAccess?(cb?: (allowed: boolean) => void): void;
  LocationManager?: {
    isInited: boolean;
    isLocationAvailable: boolean;
    init(cb?: () => void): void;
    getLocation(cb: (data: { latitude: number; longitude: number } | null) => void): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp: TgWebApp };
  }
}

export const tg: TgWebApp | null = window.Telegram?.WebApp ?? null;
export const inTelegram = !!tg?.initData;

const supports = (version: string) => inTelegram && !!tg && tg.isVersionAtLeast(version);

function applyTheme() {
  const dark = inTelegram
    ? tg?.colorScheme === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (tg && supports('6.9')) {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    tg.setHeaderColor(bg);
    tg.setBackgroundColor(bg);
    if (supports('7.10')) tg.setBottomBarColor?.(bg);
  }
}

export function initTelegram() {
  applyTheme();
  if (!tg || !inTelegram) return;
  tg.ready();
  // Прямые ссылки из чатов открываются снизу на половину экрана (mode=compact), их не разворачиваем.
  if (!tg.initDataUnsafe.start_param) tg.expand();
  // Иначе свайп по сетке слотов сворачивает Mini App.
  if (supports('7.7')) tg.disableVerticalSwipes?.();
  tg.onEvent('themeChanged', applyTheme);
}

/** «p_<id>» из прямой ссылки t.me/<бот>/<app>?startapp=… или из адреса кнопки бота. */
export function startParam(): string | null {
  const query = new URLSearchParams(location.search);
  return tg?.initDataUnsafe.start_param ?? query.get('startapp') ?? query.get('tgWebAppStartParam');
}

/** Разворачивает Mini App на весь экран: карте на половине экрана тесно. */
export function expandApp() {
  if (tg && inTelegram) tg.expand();
}

export const haptic = {
  select: () => inTelegram && tg?.HapticFeedback.selectionChanged(),
  success: () => inTelegram && tg?.HapticFeedback.notificationOccurred('success'),
  error: () => inTelegram && tg?.HapticFeedback.notificationOccurred('error'),
};

export function openLink(url: string) {
  if (tg && inTelegram) tg.openLink(url);
  else window.open(url, '_blank', 'noopener');
}

export function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (tg && supports('6.2')) tg.showConfirm(message, resolve);
    else resolve(window.confirm(message));
  });
}

/** Открывает выбор чата и подставляет карточку сходки (нужен inline-режим у бота). */
export function shareToChat(planId: string): boolean {
  if (!tg || !supports('6.7')) return false;
  tg.switchInlineQuery(`p_${planId}`, ['users', 'groups']);
  return true;
}

export function downloadFile(url: string, fileName: string) {
  const absolute = new URL(url, location.href).toString();
  if (tg?.downloadFile && supports('8.0')) tg.downloadFile({ url: absolute, file_name: fileName });
  else openLink(absolute);
}

/** Разрешение боту писать в личку. null — клиент Telegram не умеет спрашивать. */
export function askWriteAccess(): Promise<boolean | null> {
  return new Promise((resolve) => {
    if (!tg?.requestWriteAccess || !supports('6.9')) return resolve(null);
    tg.requestWriteAccess((allowed) => resolve(allowed));
  });
}

/** После первого ответа спрашиваем один раз, чтобы не надоедать. */
export function askWriteAccessOnce(): Promise<boolean | null> {
  if (tg?.initDataUnsafe.user?.allows_write_to_pm) return Promise.resolve(null);
  try {
    if (localStorage.getItem('write-access-asked')) return Promise.resolve(null);
    localStorage.setItem('write-access-asked', '1');
  } catch {
    // localStorage может быть недоступен — просто спросим.
  }
  return askWriteAccess();
}

export function openBotChat(bot: string) {
  const url = `https://t.me/${bot}?start=notify`;
  if (tg && supports('6.1')) tg.openTelegramLink(url);
  else openLink(url);
}

export function getLocation(): Promise<LatLng | null> {
  return new Promise((resolve) => {
    const lm = tg?.LocationManager;
    if (lm && supports('8.0')) {
      const ask = () =>
        lm.isLocationAvailable
          ? lm.getLocation((d) => resolve(d ? { lat: d.latitude, lng: d.longitude } : null))
          : resolve(null);
      if (lm.isInited) ask();
      else lm.init(ask);
      return;
    }
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: 10_000 },
    );
  });
}
