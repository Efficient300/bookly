import { useEffect, useState } from 'react';
import { joinNames, plural, slotLabel, weekdayShort } from '../../../shared/format.ts';
import type { SlotStat } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { IconBell } from '../components/icons.tsx';
import { HeatGrid, HeatLegend } from '../components/SlotGrid.tsx';
import { AvatarStack, BottomBar, ErrorBox, MainButton, Spinner, useToast } from '../components/ui.tsx';
import { useNav, usePlan } from '../nav.tsx';
import { haptic } from '../telegram.ts';

function slotHint(s: SlotStat, responded: number): string {
  const parts = [`${s.good + s.maybe} из ${responded}`];
  if (s.missing.length) parts.push(`${s.missing.length === 1 ? 'не может' : 'не могут'} ${joinNames(s.missing)}`);
  if (s.maybeNames.length) parts.push(`«если надо»: ${joinNames(s.maybeNames)}`);
  return parts.join(' · ');
}

/** Итоги для организатора: тепловая карта, лучшие слоты, выбор места и подтверждение. */
export function Results({ id }: { id: string }) {
  const nav = useNav();
  const toast = useToast();
  const { plan, error, reload } = usePlan(id);
  const [slot, setSlot] = useState<string | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!plan) return;
    setSlot((s) => s ?? plan.top[0]?.key ?? null);
    setPlace((p) => p ?? plan.placeId ?? plan.places.find((x) => x.votes > 0)?.id ?? null);
  }, [plan]);

  if (error && !plan) return <ErrorBox message={error} onRetry={reload} />;
  if (!plan) return <Spinner />;

  const pending = plan.members.filter((m) => m.status === null && !m.isOwner);
  const placeOptions = plan.votePlace ? plan.places.filter((p) => p.votes > 0).slice(0, 4) : plan.places.slice(0, 4);
  const chosenSlot = plan.top.find((s) => s.key === slot) ?? null;

  async function confirm() {
    if (!slot) return;
    setBusy(true);
    try {
      await api.confirm(id, slot, place);
      haptic.success();
      toast('Готово! Сообщили всем в чате');
      nav.reset([{ name: 'home' }, { name: 'plan', id }]);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function nudge() {
    try {
      const { sent } = await api.nudge(id);
      toast(sent ? 'Напомнили' : 'Некому напоминать: участники не разрешили писать в личку');
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="screen">
      <main className="content">
        <div className="head">
          <div className="caption">{plan.title}</div>
          <h1 className="h1">Когда собираемся</h1>
          <div className="row" style={{ gap: 10, paddingTop: 4 }}>
            <AvatarStack people={plan.members.filter((m) => m.status !== null)} size={24} />
            <span className="caption">
              Ответили {plan.responded}
              {pending.length > 0 && ` · без ответа: ${joinNames(pending.map((m) => m.name))}`}
            </span>
          </div>
        </div>

        <section className="card" style={{ padding: 14, gap: 8 }} aria-label="Сколько человек свободно в каждый слот">
          <HeatGrid days={plan.days} times={plan.times} heat={plan.heat} total={plan.responded} bestKey={plan.top[0]?.key ?? null} />
          <HeatLegend total={plan.responded} />
        </section>

        <section className="section">
          <h2 className="h2">Лучшие варианты</h2>
          {plan.top.length === 0 ? (
            <div className="card caption">Пока никто не отметил время.</div>
          ) : (
            <div className="list">
              {plan.top.map((s, i) => (
                <button
                  key={s.key}
                  type="button"
                  className="list-row"
                  aria-pressed={slot === s.key}
                  onClick={() => {
                    haptic.select();
                    setSlot(s.key);
                  }}
                >
                  <span className="radio" aria-hidden="true" />
                  <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span className="row" style={{ gap: 8 }}>
                      <span style={{ fontSize: 16, fontWeight: 600 }}>{slotLabel(s.date, s.time)}</span>
                      {i === 0 && <span className="pill accent">Лучший</span>}
                    </span>
                    <span className="caption">{slotHint(s, plan.responded)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {(pending.length > 0 || plan.inGroup) && (
            <button type="button" className="btn-text" onClick={nudge}>
              <IconBell size={18} />
              Напомнить, кто не ответил
            </button>
          )}
        </section>

        <section className="section">
          <h2 className="h2">Место</h2>
          <div className="list">
            {placeOptions.map((p) => (
              <button
                key={p.id}
                type="button"
                className="list-row"
                aria-pressed={place === p.id}
                onClick={() => {
                  haptic.select();
                  setPlace(p.id);
                }}
              >
                <span className="radio" aria-hidden="true" />
                <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>{p.name}</span>
                  <span className="caption">
                    {plan.votePlace ? `${p.votes} ${plural(p.votes, ['голос', 'голоса', 'голосов'])}` : p.kind}
                    {p.travel ? ` · ${p.travel}` : ''}
                  </span>
                </span>
              </button>
            ))}
            <button type="button" className="list-row" aria-pressed={place === null} onClick={() => setPlace(null)}>
              <span className="radio" aria-hidden="true" />
              <span className="grow" style={{ fontSize: 16, fontWeight: 500 }}>
                Решим позже
              </span>
            </button>
          </div>
          {plan.votePlace && (
            <button type="button" className="btn-text" onClick={() => nav.push({ name: 'places', id })}>
              Открыть голосование
            </button>
          )}
        </section>
      </main>

      <BottomBar>
        <MainButton onClick={confirm} busy={busy} disabled={!chosenSlot}>
          {chosenSlot ? `Подтвердить: ${weekdayShort(chosenSlot.date)}, ${chosenSlot.time}` : 'Выберите время'}
        </MainButton>
      </BottomBar>
    </div>
  );
}
