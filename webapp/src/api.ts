import type { Me, MePatch, NewPlace, NewPlan, PlanSummary, PlanView, Review } from '../../shared/types.ts';
import { askWriteAccess, askWriteAccessOnce, inTelegram, tg } from './telegram.ts';

const BASE = String(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

function authHeader(): string {
  if (inTelegram && tg) return `tma ${tg.initData}`;
  // Вне Telegram — тестовый пользователь (сервер должен быть запущен с DEV_MODE=1).
  return `dev ${new URLSearchParams(location.search).get('dev_user') ?? '1'}`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        Authorization: authHeader(),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Нет связи с сервером');
  }
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(data?.error ?? `Ошибка ${res.status}`, res.status);
  return data as T;
}

export const api = {
  me: () => request<Me>('GET', '/api/me'),
  writeAccess: (allowed: boolean) => request<{ ok: boolean }>('POST', '/api/me/write-access', { allowed }),
  plans: () => request<PlanSummary[]>('GET', '/api/plans'),
  plan: (id: string) => request<PlanView>('GET', `/api/plans/${id}`),
  create: (plan: NewPlan) => request<{ id: string; posted: boolean }>('POST', '/api/plans', plan),
  remove: (id: string) => request<{ ok: boolean }>('DELETE', `/api/plans/${id}`),
  updateMe: (id: string, patch: MePatch) => request<PlanView>('PATCH', `/api/plans/${id}/me`, patch),
  vote: (id: string, placeId: string, liked: boolean) =>
    request<PlanView>('POST', `/api/plans/${id}/votes`, { placeId, liked }),
  suggest: (id: string, place: NewPlace) => request<PlanView>('POST', `/api/plans/${id}/places`, place),
  confirm: (id: string, key: string, placeId: string | null) =>
    request<PlanView>('POST', `/api/plans/${id}/confirm`, { key, placeId }),
  nudge: (id: string) => request<{ sent: number }>('POST', `/api/plans/${id}/nudge`),
  setBill: (id: string, total: number) => request<PlanView>('PUT', `/api/plans/${id}/bill`, { total }),
  markPaid: (id: string, userId: number, paid: boolean) =>
    request<PlanView>('POST', `/api/plans/${id}/bill/paid`, { userId, paid }),
  review: (id: string, review: Review) => request<PlanView>('PUT', `/api/plans/${id}/review`, review),
  icsUrl: (id: string) => `${BASE}/api/plans/${id}/event.ics`,
};

/** Спрашивает разрешение на личные сообщения и сообщает ответ серверу. По просьбе человека — в любой момент. */
export async function enableReminders(force = false): Promise<void> {
  const allowed = await (force ? askWriteAccess() : askWriteAccessOnce());
  if (allowed !== null) await api.writeAccess(allowed).catch(() => {});
}

/** Ссылка, которую можно отправить вне Telegram-карточки. */
export function planLink(id: string): string {
  const bot = import.meta.env.VITE_BOT_USERNAME;
  // Без короткого имени ссылка ведёт на главное Mini App бота.
  const app = import.meta.env.VITE_APP_SHORT_NAME ? `/${import.meta.env.VITE_APP_SHORT_NAME}` : '';
  return bot ? `https://t.me/${bot}${app}?startapp=p_${id}&mode=compact` : `${location.origin}/?startapp=p_${id}`;
}
