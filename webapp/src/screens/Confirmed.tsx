import { useState } from 'react';
import { dayLabel, joinNames, plural } from '../../../shared/format.ts';
import type { PlanView } from '../../../shared/types.ts';
import { api, enableReminders, planLink } from '../api.ts';
import { DeletePlanButton } from '../components/DeletePlanButton.tsx';
import { IconBell, IconCalendar, IconCheck, IconPin, IconSend } from '../components/icons.tsx';
import { PlanCover } from '../components/PlanCover.tsx';
import { ActionSheet, Avatar, StatusPicker, Switch, useToast } from '../components/ui.tsx';
import { endTime, googleCalendarUrl, routeLinks } from '../lib/links.ts';
import { downloadFile, haptic, openLink, shareToChat } from '../telegram.ts';

type Sheet = { title: string; options: { label: string; run: () => void }[] };

/** Сходка подтверждена: как билет — когда, где и быстрые действия. */
export function Confirmed({ plan, setPlan }: { plan: PlanView; setPlan: (p: PlanView) => void }) {
  const toast = useToast();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const chosen = plan.chosen!;
  const place = plan.places.find((p) => p.id === chosen.placeId) ?? null;
  const going = plan.members.filter((m) => m.status === 'go');
  const hasPoint = place !== null && place.lat !== null && place.lng !== null;

  async function patch(update: Parameters<typeof api.updateMe>[1]) {
    try {
      setPlan(await api.updateMe(plan.id, update));
      haptic.select();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function setRemind(on: boolean) {
    await patch({ remind: on });
    if (on) await enableReminders(true);
  }

  async function book() {
    const count = going.length || plan.members.length;
    const text = `Здравствуйте! Хотим забронировать столик на ${count} ${plural(count, ['человека', 'человек', 'человек'])} — ${dayLabel(chosen.date)}, в ${chosen.time}.`;
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

  function showRoutes() {
    if (!hasPoint) return;
    setSheet({
      title: 'Построить маршрут',
      options: routeLinks({ lat: place.lat as number, lng: place.lng as number }).map((r) => ({ label: r.label, run: () => openLink(r.url) })),
    });
  }

  function showCalendars() {
    setSheet({
      title: 'Добавить в календарь',
      options: [
        {
          label: 'Google Календарь',
          run: () => openLink(googleCalendarUrl({ title: plan.title, ...chosen, duration: plan.duration, location: place?.name ?? null })),
        },
        { label: 'Apple, Outlook и другие', run: () => downloadFile(api.icsUrl(plan.id), 'skhodka.ics') },
      ],
    });
  }

  return (
    <div className="screen">
      <main className="content">
        <PlanCover format={plan.format}>
          <span className="cover-pill row" style={{ gap: 4 }}>
            <IconCheck size={14} strokeWidth={3} />
            Решено
          </span>
          <h1 className="cover-title">{plan.title}</h1>
          <span className="cover-when">{dayLabel(chosen.date)}</span>
          <span className="cover-sub">
            {chosen.time} – {endTime(chosen.time, plan.duration)}
            {place ? ` · ${place.name}` : ' · место уточним'}
          </span>
        </PlanCover>

        <div className="actions">
          <button type="button" className="action" disabled={!hasPoint} onClick={showRoutes}>
            <span className="action-icon">
              <IconPin size={22} />
            </span>
            Маршрут
          </button>
          <button type="button" className="action" onClick={showCalendars}>
            <span className="action-icon">
              <IconCalendar size={22} />
            </span>
            Календарь
          </button>
          <button type="button" className="action" onClick={share}>
            <span className="action-icon">
              <IconSend size={22} />
            </span>
            В чат
          </button>
        </div>

        <section className="section">
          <h2 className="h2">Вы идёте?</h2>
          <StatusPicker value={plan.me.status} onChange={(status) => patch({ status })} />
        </section>

        <section className="section">
          <h2 className="h2">
            {going.length} {plural(going.length, ['идёт', 'идут', 'идут'])}
          </h2>
          <div className="card row" style={{ flexDirection: 'row', gap: 12 }}>
            {going.length > 0 && (
              <span className="avatars">
                {going.slice(0, 5).map((m) => (
                  <Avatar key={m.id} name={m.name} seed={m.id} photo={m.photo} size={32} />
                ))}
              </span>
            )}
            <span className="caption grow">{joinNames(going.map((m) => m.name)) || 'Пока никто не отметился'}</span>
          </div>
        </section>

        <div className="list">
          <div className="list-row">
            <span className="icon-box orange">
              <IconBell size={20} />
            </span>
            <span id="remind-label" className="grow list-title">
              Напомнить за день и за 2 часа
            </span>
            <Switch checked={plan.me.remind} onChange={setRemind} labelledBy="remind-label" />
          </div>
          {/* Своё место без ссылки — например, «дома у Тимура»: бронировать негде. */}
          {place && (!place.custom || place.url) && (
            <button type="button" className="list-row" onClick={book}>
              <span className="grow row-text">
                <span className="list-title accent-text">Забронировать столик</span>
                <span className="caption">Скопируем готовый текст брони</span>
              </span>
            </button>
          )}
        </div>

        {plan.isOwner && <DeletePlanButton id={plan.id} />}
      </main>

      {sheet && <ActionSheet title={sheet.title} options={sheet.options} onClose={() => setSheet(null)} />}
    </div>
  );
}
