import { useEffect, useState } from 'react';
import { daysRangeLabel, deadlineLabel, plural, slotLabel } from '../../../shared/format.ts';
import type { Me, PlanSummary } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { IconBell, IconCalendar, IconPin, IconPlus } from '../components/icons.tsx';
import { ActionBar, AvatarStack, ErrorBox, Spinner, StatusTag, useToast } from '../components/ui.tsx';
import { useNav } from '../nav.tsx';
import { askWriteAccess, haptic, inTelegram, openBotChat } from '../telegram.ts';

const ONBOARDING = [
  { title: 'Создайте сходку', text: 'Категория, дни, время, место' },
  { title: 'Отправьте в чат', text: 'Друзья откроют её прямо из Telegram' },
  { title: 'Получите итог', text: 'Бот напишет, когда всё решится' },
];

function PlanCard({ plan, onOpen }: { plan: PlanSummary; onOpen: () => void }) {
  const status = plan.expired ? 'expired' : plan.status;
  const waiting = Math.max(0, plan.total - plan.responded);
  return (
    <button type="button" className="card" onClick={onOpen}>
      <span className="row-flex" style={{ justifyContent: 'space-between' }}>
        <StatusTag status={status} />
        {plan.needsAnswer && <span className="tag on">Ваш ответ</span>}
      </span>
      <span className="card-title">{plan.title}</span>
      {plan.chosen ? (
        <>
          <span className="meta">
            <IconCalendar size={16} />
            {slotLabel(plan.chosen.date, plan.chosen.time)}
          </span>
          {plan.placeName && (
            <span className="meta">
              <IconPin size={16} />
              <span className="ellipsis">{plan.placeName}</span>
            </span>
          )}
        </>
      ) : (
        <span className="meta">
          <IconCalendar size={16} />
          {plan.days.length ? daysRangeLabel(plan.days) : 'Дни не выбраны'}
          {plan.deadline && status === 'collecting' ? ` · до ${deadlineLabel(plan.deadline)}` : ''}
        </span>
      )}
      {status === 'confirmed' ? (
        plan.going.length > 0 && (
          <span className="row-flex" style={{ gap: 10 }}>
            <AvatarStack people={plan.going} />
            <span className="note">
              {plan.going.length} {plural(plan.going.length, ['идёт', 'идут', 'идут'])}
            </span>
          </span>
        )
      ) : status === 'collecting' ? (
        <span className="stack" style={{ gap: 8 }}>
          <span className="row-flex" style={{ justifyContent: 'space-between' }}>
            <AvatarStack people={plan.going} waiting={waiting} />
            <span className="note">
              Ответили {plan.responded} из {plan.total}
            </span>
          </span>
          <span className="progress" aria-hidden="true">
            <span style={{ width: `${plan.total ? (plan.responded / plan.total) * 100 : 0}%` }} />
          </span>
        </span>
      ) : null}
    </button>
  );
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

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!plans) return <Spinner />;

  const order = (p: PlanSummary) =>
    p.needsAnswer ? 0 : p.status === 'confirmed' ? 1 : p.status === 'collecting' && !p.expired ? 2 : 3;
  const sorted = [...plans].sort((a, b) => order(a) - order(b));
  const empty = plans.length === 0;

  return (
    <div className="screen">
      <header className="top-bar">
        <h1 className="h1">Сходки</h1>
        {!empty && (
          <button type="button" className="icon-btn" aria-label="Новая сходка" onClick={create}>
            <IconPlus size={20} />
          </button>
        )}
      </header>

      <main className="content">
        {inTelegram && me && !me.allowsPm && (
          <div className="group">
            <div className="row">
              <span className="row-icon">
                <IconBell size={20} />
              </span>
              <span className="lbl">
                <span>Уведомления в личку</span>
                <span className="sub">Ответы, итог и напоминания</span>
              </span>
              <button type="button" className="btn small ink" onClick={enableNotifications}>
                Включить
              </button>
            </div>
          </div>
        )}

        {empty ? (
          <section className="stack" style={{ gap: 24, paddingTop: 8 }}>
            <div className="stack" style={{ gap: 8 }}>
              <h2 className="h1">Соберите друзей за пару минут</h2>
              <p className="note" style={{ margin: 0 }}>
                Вы предлагаете дни и время, друзья отмечают, когда свободны. Сходка выберет лучший вариант.
              </p>
            </div>
            <ol className="steps-list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {ONBOARDING.map((s, i) => (
                <li key={s.title} className="step">
                  <span className="step-num">{i + 1}</span>
                  <span className="stack" style={{ gap: 2 }}>
                    <span style={{ fontWeight: 500 }}>{s.title}</span>
                    <span className="note">{s.text}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ) : (
          <section className="stack">
            {sorted.map((p) => (
              <PlanCard key={p.id} plan={p} onOpen={() => nav.push({ name: 'plan', id: p.id })} />
            ))}
          </section>
        )}
      </main>

      <ActionBar main={{ label: empty ? 'Создать сходку' : 'Новая сходка', onClick: create }} />
    </div>
  );
}
