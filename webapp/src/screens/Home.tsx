import { useEffect, useState } from 'react';
import { dayLabel, deadlineLabel, plural, slotLabel } from '../../../shared/format.ts';
import type { Me, PlanSummary } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { IconCalendar, IconCheck, IconChevron, IconClock, IconPin, IconPlus } from '../components/icons.tsx';
import { Avatar, BottomBar, ErrorBox, MainButton, Spinner } from '../components/ui.tsx';
import { daysUntil } from '../lib/links.ts';
import { useNav } from '../nav.tsx';

function whenLabel(day: string): string {
  const n = daysUntil(day);
  if (n === 0) return 'сегодня';
  if (n === 1) return 'завтра';
  return `через ${n} ${plural(n, ['день', 'дня', 'дней'])}`;
}

export function Home() {
  const nav = useNav();
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

  return (
    <div className="screen">
      <header className="row" style={{ justifyContent: 'space-between', padding: '16px 20px 0' }}>
        <h1 className="h1">Сходки</h1>
        {me && <Avatar name={me.name} seed={me.id} size={40} />}
      </header>

      <main className="content" style={{ gap: 24 }}>
        {plans.length === 0 && (
          <div className="empty">
            Пока нет ни одной сходки.
            <br />
            Создайте первую и отправьте её в чат с друзьями.
          </div>
        )}

        {next && (
          <section className="section">
            <h2 className="h2">Ближайшая</h2>
            <button type="button" className="card big" style={{ border: 'none', textAlign: 'left' }} onClick={() => open(next.id)}>
              <span className="row" style={{ justifyContent: 'space-between' }}>
                <span className="pill accent">
                  <IconCheck size={14} strokeWidth={2.5} />
                  Подтверждено
                </span>
                <span className="caption">{whenLabel(next.chosen!.date)}</span>
              </span>
              <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>{next.title}</span>
              <span className="info-line">
                <IconCalendar size={18} />
                {slotLabel(next.chosen!.date, next.chosen!.time)}
              </span>
              {next.placeName && (
                <span className="info-line">
                  <IconPin size={18} />
                  {next.placeName}
                </span>
              )}
              <span className="row" style={{ justifyContent: 'space-between' }}>
                <span className="row" style={{ gap: 10 }}>
                  <span className="avatars">
                    {next.going.slice(0, 5).map((name, i) => (
                      <Avatar key={i} name={name} seed={name} />
                    ))}
                  </span>
                  <span className="caption">
                    {next.going.length} {plural(next.going.length, ['идёт', 'идут', 'идут'])}
                  </span>
                </span>
                <span className="row" style={{ gap: 2, color: 'var(--accent)', fontSize: 14, fontWeight: 600 }}>
                  Открыть <IconChevron size={16} />
                </span>
              </span>
            </button>
          </section>
        )}

        {waiting.length > 0 && (
          <section className="section">
            <div className="row" style={{ padding: '0 4px' }}>
              <h2 className="h2">Ждут вашего ответа</h2>
              <span className="badge">{waiting.length}</span>
            </div>
            <div className="list">
              {waiting.map((p) => (
                <button key={p.id} type="button" className="list-row" onClick={() => open(p.id)}>
                  <span className="icon-box">
                    <IconClock size={20} />
                  </span>
                  <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span className="list-title">{p.title}</span>
                    <span className="caption">
                      Когда удобно?{p.deadline ? ` · до ${deadlineLabel(p.deadline)}` : ''}
                    </span>
                  </span>
                  <span className="btn-small" style={{ display: 'inline-flex', alignItems: 'center' }}>
                    Ответить
                  </span>
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
                  <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span className="list-title">{p.title}</span>
                    <span className="caption">
                      {p.status === 'collecting'
                        ? `Идёт сбор · ответили ${p.responded}${p.isOwner ? ' · вы организатор' : ''}`
                        : `${slotLabel(p.chosen!.date, p.chosen!.time)}${p.placeName ? ` · ${p.placeName}` : ''}`}
                    </span>
                  </span>
                  <IconChevron size={18} style={{ color: 'var(--muted)' }} />
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
                  <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span className="list-title">{p.title}</span>
                    <span className="caption">
                      {p.chosen ? dayLabel(p.chosen.date) : 'Время не выбрали'}
                      {p.placeName ? ` · ${p.placeName}` : ''}
                    </span>
                  </span>
                  <IconChevron size={18} style={{ color: 'var(--muted)' }} />
                </button>
              ))}
            </div>
          </section>
        )}
      </main>

      <BottomBar>
        <MainButton onClick={() => nav.push({ name: 'create' })}>
          <IconPlus size={20} strokeWidth={2.5} />
          Новая сходка
        </MainButton>
      </BottomBar>
    </div>
  );
}
