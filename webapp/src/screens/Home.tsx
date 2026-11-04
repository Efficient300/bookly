import { useEffect, useState } from 'react';
import { dayLabel, deadlineLabel, plural, slotLabel } from '../../../shared/format.ts';
import type { Me, PlanSummary } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { FormatTile, PlanCover } from '../components/PlanCover.tsx';
import { IconBell, IconChevron, IconPlus } from '../components/icons.tsx';
import { Avatar, ErrorBox, MainButton, Spinner, useToast } from '../components/ui.tsx';
import { daysUntil } from '../lib/links.ts';
import { useNav } from '../nav.tsx';
import { askWriteAccess, haptic, inTelegram, openBotChat } from '../telegram.ts';

function whenLabel(day: string): string {
  const n = daysUntil(day);
  if (n === 0) return 'Сегодня';
  if (n === 1) return 'Завтра';
  return `Через ${n} ${plural(n, ['день', 'дня', 'дней'])}`;
}

export function Home() {
  const nav = useNav();
  const toast = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    Promise.all([api.me(), api.plans()])
      .then(([m, p]) => {
        setMe(m);
        setPlans(p);
      })
      .catch((e: Error) => setError(e.message));
  };
  useEffect(load, []);

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!plans) return <Spinner />;

  const upcoming = plans
    .filter((p) => p.status === 'confirmed' && p.chosen)
    .sort((a, b) => `${a.chosen!.date}T${a.chosen!.time}`.localeCompare(`${b.chosen!.date}T${b.chosen!.time}`));
  const [next, ...laterPlans] = upcoming;
  const waiting = plans.filter((p) => p.needsAnswer);
  const collecting = plans.filter((p) => p.status === 'collecting' && !p.needsAnswer && !p.expired);
  const past = plans.filter((p) => p.status === 'done' || p.expired).slice(0, 5);
  const open = (id: string) => nav.push({ name: 'plan', id });
  const create = () => nav.push({ name: 'create' });

  async function enableNotifications() {
    if (!me) return;
    const allowed = await askWriteAccess();
    if (allowed === null) {
      if (me.bot) openBotChat(me.bot);
      return;
    }
    if (!allowed) {
      toast('Без разрешения бот не сможет написать в личку');
      return;
    }
    await api.writeAccess(true).catch(() => {});
    haptic.success();
    setMe({ ...me, allowsPm: true });
    toast('Уведомления будут приходить в чат с ботом');
  }

  return (
    <div className="screen">
      <header className="nav-large">
        <h1 className="h1">Сходки</h1>
        <button type="button" className="round-btn" aria-label="Новая сходка" onClick={create}>
          <IconPlus size={22} strokeWidth={2.5} />
        </button>
      </header>

      <main className="content" style={{ paddingTop: 8 }}>
        {inTelegram && me && !me.allowsPm && (
          <div className="list">
            <div className="list-row">
              <span className="icon-box orange">
                <IconBell size={20} />
              </span>
              <span className="grow row-text">
                <span className="list-title">Уведомления в личку</span>
                <span className="caption">Ответы, подтверждение и напоминания о встрече</span>
              </span>
              <button type="button" className="btn-small" onClick={enableNotifications}>
                Включить
              </button>
            </div>
          </div>
        )}

        {plans.length === 0 && (
          <div className="empty">
            <FormatTile format="any" />
            <div className="empty-title">Соберите друзей</div>
            <div>Предложите дни, все отметят, когда удобно, а приложение найдёт лучшее время и место.</div>
            <MainButton onClick={create}>Создать первую сходку</MainButton>
          </div>
        )}

        {next && (
          <button type="button" className="cover-btn" onClick={() => open(next.id)}>
            <PlanCover format={next.format}>
              <span className="cover-pill">{whenLabel(next.chosen!.date)}</span>
              <span className="cover-title">{next.title}</span>
              <span className="cover-sub">
                {slotLabel(next.chosen!.date, next.chosen!.time)}
                {next.placeName ? ` · ${next.placeName}` : ''}
              </span>
              {next.going.length > 0 && (
                <span className="row" style={{ gap: 8, marginTop: 6 }}>
                  <span className="avatars on-cover">
                    {next.going.slice(0, 5).map((p) => (
                      <Avatar key={p.id} name={p.name} seed={p.id} photo={p.photo} />
                    ))}
                  </span>
                  <span className="cover-sub">
                    {next.going.length} {plural(next.going.length, ['идёт', 'идут', 'идут'])}
                  </span>
                </span>
              )}
            </PlanCover>
          </button>
        )}

        {waiting.length > 0 && (
          <section className="section">
            <div className="row" style={{ padding: '0 4px' }}>
              <h2 className="h2">Ждут ответа</h2>
              <span className="badge">{waiting.length}</span>
            </div>
            <div className="list">
              {waiting.map((p) => (
                <button key={p.id} type="button" className="list-row" onClick={() => open(p.id)}>
                  <FormatTile format={p.format} />
                  <span className="grow row-text">
                    <span className="list-title">{p.title}</span>
                    <span className="caption">{p.deadline ? `До ${deadlineLabel(p.deadline)}` : 'Когда вам удобно?'}</span>
                  </span>
                  <span className="btn-small">Ответить</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {(collecting.length > 0 || laterPlans.length > 0) && (
          <section className="section">
            <h2 className="h2">В работе</h2>
            <div className="list">
              {[...collecting, ...laterPlans].map((p) => (
                <button key={p.id} type="button" className="list-row" onClick={() => open(p.id)}>
                  <FormatTile format={p.format} />
                  <span className="grow row-text">
                    <span className="list-title">{p.title}</span>
                    <span className="caption">
                      {p.status === 'collecting'
                        ? `Ответили: ${p.responded}${p.isOwner ? ' · вы организатор' : ''}`
                        : `${slotLabel(p.chosen!.date, p.chosen!.time)}${p.placeName ? ` · ${p.placeName}` : ''}`}
                    </span>
                  </span>
                  <IconChevron size={16} className="row-chevron" />
                </button>
              ))}
            </div>
          </section>
        )}

        {past.length > 0 && (
          <section className="section">
            <h2 className="h2">Прошедшие</h2>
            <div className="list">
              {past.map((p) => (
                <button key={p.id} type="button" className="list-row" onClick={() => open(p.id)}>
                  <FormatTile format={p.format} muted />
                  <span className="grow row-text">
                    <span className="list-title">{p.title}</span>
                    <span className="caption">
                      {p.chosen ? dayLabel(p.chosen.date) : 'Время не выбрали'}
                      {p.placeName ? ` · ${p.placeName}` : ''}
                    </span>
                  </span>
                  <IconChevron size={16} className="row-chevron" />
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
