import { useState } from 'react';
import { dayLabel, joinNames, plural } from '../../../shared/format.ts';
import type { MemberStatus, PlanView } from '../../../shared/types.ts';
import { api, enableReminders, planLink } from '../api.ts';
import { DeletePlanButton } from '../components/DeletePlanButton.tsx';
import { IconBell, IconCalendar, IconCheck, IconPin, IconSend, IconUsers } from '../components/icons.tsx';
import { BottomBar, MainButton, Segmented, Switch, useToast } from '../components/ui.tsx';
import { endTime, googleCalendarUrl, routeLinks } from '../lib/links.ts';
import { downloadFile, haptic, openLink, shareToChat } from '../telegram.ts';

const STATUS_OPTIONS: { value: MemberStatus; label: string }[] = [
  { value: 'go', label: 'Иду' },
  { value: 'maybe', label: 'Может быть' },
  { value: 'no', label: 'Не смогу' },
];

export function Confirmed({ plan, setPlan }: { plan: PlanView; setPlan: (p: PlanView) => void }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const chosen = plan.chosen!;
  const place = plan.places.find((p) => p.id === chosen.placeId) ?? null;
  const going = plan.members.filter((m) => m.status === 'go');

  async function patch(update: Parameters<typeof api.updateMe>[1]) {
    setSaving(true);
    try {
      setPlan(await api.updateMe(plan.id, update));
      haptic.select();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function setRemind(on: boolean) {
    await patch({ remind: on });
    if (on) await enableReminders();
  }

  async function book() {
    const text = `Здравствуйте! Хотим забронировать столик на ${going.length || plan.members.length} ${plural(going.length || plan.members.length, ['человека', 'человек', 'человек'])} — ${dayLabel(chosen.date)}, в ${chosen.time}.`;
    try {
      await navigator.clipboard.writeText(text);
      toast('Текст брони скопирован');
    } catch {
      toast(text);
    }
    if (place?.url) openLink(place.url);
    else if (place?.phone) openLink(`tel:${place.phone}`);
  }

  function share() {
    if (shareToChat(plan.id)) return;
    void navigator.clipboard?.writeText(planLink(plan.id));
    toast('Ссылка скопирована');
  }

  const location = place?.name ?? null;

  return (
    <div className="screen">
      <main className="content">
        <div className="head" style={{ gap: 12 }}>
          <span
            aria-hidden="true"
            style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--accent)', color: 'var(--accent-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <IconCheck size={26} strokeWidth={2.5} />
          </span>
          <h1 className="h1">{plan.title}</h1>
          <div className="muted" style={{ fontSize: 15 }}>
            Сходка подтверждена{plan.isOwner ? ' — участникам пришло уведомление' : ''}
          </div>
        </div>

        <div className="list" style={{ borderRadius: 24 }}>
          <div className="list-row">
            <span className="icon-box neutral">
              <IconCalendar size={20} />
            </span>
            <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{dayLabel(chosen.date)}</span>
              <span className="caption">
                {chosen.time} – {endTime(chosen.time, plan.duration)}
              </span>
            </span>
          </div>
          <div className="list-row">
            <span className="icon-box neutral">
              <IconPin size={20} />
            </span>
            <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{place?.name ?? 'Место уточним'}</span>
              <span className="caption">{[place?.address, place?.travel].filter(Boolean).join(' · ') || place?.kind}</span>
            </span>
          </div>
          <div className="list-row">
            <span className="icon-box neutral">
              <IconUsers size={20} />
            </span>
            <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>
                {going.length} {plural(going.length, ['идёт', 'идут', 'идут'])}
              </span>
              <span className="caption">{joinNames(going.map((m) => m.name)) || 'Пока никто не отметился'}</span>
            </span>
          </div>
        </div>

        <section className="section">
          <h2 className="h2">Вы идёте?</h2>
          <Segmented label="Вы идёте?" options={STATUS_OPTIONS} value={plan.me.status} onChange={(status) => patch({ status })} />
        </section>

        <section className="section">
          <h2 className="h2">Добавить в календарь</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => openLink(googleCalendarUrl({ title: plan.title, ...chosen, duration: plan.duration, location }))}
            >
              Google Календарь
            </button>
            <button type="button" className="btn-secondary" onClick={() => downloadFile(api.icsUrl(plan.id), 'skhodka.ics')}>
              Apple · Outlook
            </button>
          </div>
        </section>

        {place && place.lat !== null && place.lng !== null && (
          <section className="section">
            <h2 className="h2">Как добраться</h2>
            <div className="chips scroll">
              {routeLinks({ lat: place.lat, lng: place.lng }).map((r) => (
                <button key={r.label} type="button" className="chip sm" onClick={() => openLink(r.url)}>
                  {r.label}
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="list">
          <div className="list-row">
            <IconBell size={22} style={{ color: 'var(--muted)', flexShrink: 0 }} />
            <span id="remind-label" className="grow" style={{ fontSize: 15, fontWeight: 500 }}>
              Напомнить за день и за 2 часа
            </span>
            <Switch checked={plan.me.remind} onChange={setRemind} labelledBy="remind-label" />
          </div>
        </div>

        {plan.isOwner && (
          <button type="button" className="btn-text" onClick={share}>
            <IconSend size={18} />
            Отправить в чат ещё раз
          </button>
        )}
        {plan.isOwner && <DeletePlanButton id={plan.id} />}
      </main>

      {/* Своё место без ссылки — например, «дома у Тимура»: бронировать негде. */}
      {place && (!place.custom || place.url) && (
        <BottomBar>
          <div className="caption" style={{ textAlign: 'center' }}>
            Скопируем готовый текст брони
          </div>
          <MainButton onClick={book} disabled={saving}>
            Забронировать столик
          </MainButton>
        </BottomBar>
      )}
    </div>
  );
}
