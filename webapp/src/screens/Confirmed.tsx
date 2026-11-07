import { useState } from 'react';
import { dayLabel, joinNames, plural, weekdayShort } from '../../../shared/format.ts';
import type { PlanView } from '../../../shared/types.ts';
import { api, enableReminders, planLink } from '../api.ts';
import { DeletePlanButton } from '../components/DeletePlanButton.tsx';
import { IconBell, IconCalendar, IconChevron, IconPin, IconRoute, IconSend, IconUsers } from '../components/icons.tsx';
import { ActionBar, ActionSheet, Switch, useToast } from '../components/ui.tsx';
import { endTime, googleCalendarUrl, routeLinks } from '../lib/links.ts';
import { downloadFile, haptic, openLink, shareToChat } from '../telegram.ts';

type Sheet = { title: string; options: { label: string; run: () => void }[] };

const monthDay = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });

/** Итог: решение крупно на лайме, дальше только полезные действия. */
export function Confirmed({ plan, setPlan }: { plan: PlanView; setPlan: (p: PlanView) => void }) {
  const toast = useToast();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = plan.chosen!;
  const place = plan.places.find((p) => p.id === chosen.placeId) ?? null;
  const going = plan.members.filter((m) => m.status === 'go');
  const cannot = plan.members.filter((m) => m.status === 'no');
  const point = place && place.lat !== null && place.lng !== null ? { lat: place.lat, lng: place.lng } : null;
  const fits = plan.heat[`${chosen.date}T${chosen.time}`] ?? 0;
  const [y, m, d] = chosen.date.split('-').map(Number);

  async function setStatus(status: 'go' | 'no') {
    setBusy(true);
    try {
      setPlan(await api.updateMe(plan.id, { status }));
      haptic.success();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setRemind(on: boolean) {
    try {
      setPlan(await api.updateMe(plan.id, { remind: on }));
      if (on) await enableReminders(true);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  function share() {
    if (shareToChat(plan.id)) return;
    void navigator.clipboard?.writeText(planLink(plan.id));
    toast('Ссылка скопирована');
  }

  function showRoutes() {
    if (!point) return;
    const [yandex, ...others] = routeLinks(point);
    setSheet({ title: 'Построить маршрут', options: [yandex, ...others].map((r) => ({ label: r.label, run: () => openLink(r.url) })) });
  }

  function showCalendars() {
    setSheet({
      title: 'Добавить в календарь',
      options: [
        { label: 'Google Календарь', run: () => openLink(googleCalendarUrl({ title: plan.title, ...chosen, duration: plan.duration, location: place?.name ?? null })) },
        { label: 'Apple, Outlook и другие', run: () => downloadFile(api.icsUrl(plan.id), 'skhodka.ics') },
      ],
    });
  }

  const goingNow = plan.me.status === 'go';

  return (
    <div className="screen">
      <main className="content">
        <span className="note">{plan.title}</span>
        <section className="result">
          <span className="tag">Решено</span>
          <div className="stack" style={{ gap: 6 }}>
            <span className="display">
              {weekdayShort(chosen.date)}, {chosen.time}
            </span>
            <span style={{ fontSize: 15 }}>
              {monthDay.format(new Date(Date.UTC(y, m - 1, d)))} · до {endTime(chosen.time, plan.duration)}
              {plan.responded ? ` · подходит ${fits} из ${plan.responded}` : ''}
            </span>
          </div>
          <div className="result-rows">
            <div>
              <IconPin size={20} />
              <span className="stack" style={{ gap: 2 }}>
                <span>{place?.name ?? 'Место уточним'}</span>
                {place && (place.address || place.kind) && <span className="sub">{place.address ?? place.kind}</span>}
              </span>
            </div>
            <div>
              <IconUsers size={20} />
              <span>{going.length ? joinNames(going.map((g) => g.name)) : 'Пока никто не отметился'}</span>
            </div>
          </div>
        </section>

        <div className="group">
          {point && (
            <button type="button" className="row" onClick={showRoutes}>
              <span className="row-icon">
                <IconRoute size={20} />
              </span>
              <span className="lbl">
                <span>Открыть маршрут</span>
                <span className="sub">Яндекс Карты</span>
              </span>
              <IconChevron size={16} className="chev" />
            </button>
          )}
          <button type="button" className="row" onClick={showCalendars}>
            <span className="row-icon">
              <IconCalendar size={20} />
            </span>
            <span className="lbl">
              <span>Добавить в календарь</span>
              <span className="sub">{dayLabel(chosen.date)}</span>
            </span>
            <IconChevron size={16} className="chev" />
          </button>
          <button type="button" className="row" onClick={share}>
            <span className="row-icon">
              <IconSend size={20} />
            </span>
            <span className="lbl">
              <span>Отправить в чат</span>
            </span>
          </button>
          <div className="row">
            <span className="row-icon">
              <IconBell size={20} />
            </span>
            <span id="remind-label" className="lbl">
              <span>Напомнить за день и за 2 часа</span>
            </span>
            <Switch checked={plan.me.remind} onChange={setRemind} labelledBy="remind-label" />
          </div>
        </div>

        <p className="note" style={{ margin: 0 }}>
          {cannot.length > 0 && `${joinNames(cannot.map((c) => c.name))} ${cannot.length === 1 ? 'не сможет' : 'не смогут'} в это время. `}
          Бот напомнит всем за 2 часа.
          {going.length > 0 && ` Идут ${going.length} ${plural(going.length, ['человек', 'человека', 'человек'])}.`}
        </p>

        {plan.isOwner && <DeletePlanButton id={plan.id} />}
      </main>

      {sheet && <ActionSheet title={sheet.title} options={sheet.options} onClose={() => setSheet(null)} />}

      <ActionBar
        main={goingNow ? undefined : { label: 'Я иду', onClick: () => void setStatus('go'), busy }}
        secondary={goingNow ? { label: 'Не смогу', onClick: () => void setStatus('no'), disabled: busy } : undefined}
        note={goingNow ? 'Вы идёте' : null}
      />
    </div>
  );
}
