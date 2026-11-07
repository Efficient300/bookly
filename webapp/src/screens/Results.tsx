import { useEffect, useState } from 'react';
import { joinNames, plural, weekdayShort } from '../../../shared/format.ts';
import type { SlotStat } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { IconBell, IconCheck, IconChevron } from '../components/icons.tsx';
import { HeatGrid } from '../components/SlotGrid.tsx';
import { ActionBar, AvatarStack, DateTile, ErrorBox, Spinner, useToast } from '../components/ui.tsx';
import { useNav, usePlan } from '../nav.tsx';
import { haptic } from '../telegram.ts';

function slotHint(s: SlotStat, responded: number): string {
  const parts = [`Подходит ${s.good + s.maybe} из ${responded}`];
  if (s.missing.length) parts.push(`не ${s.missing.length === 1 ? 'может' : 'могут'} ${joinNames(s.missing)}`);
  return parts.join(' · ');
}

/** Итоги для организатора: сначала лучшее время, полная таблица — по запросу. */
export function Results({ id }: { id: string }) {
  const nav = useNav();
  const toast = useToast();
  const { plan, error, reload } = usePlan(id);
  const [slot, setSlot] = useState<string | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

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
      toast('Готово! Всем сообщили');
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
        <div className="stack" style={{ gap: 10 }}>
          <span className="note">{plan.title}</span>
          <h1 className="h1">Итоги</h1>
          <span className="row-flex" style={{ gap: 12 }}>
            <AvatarStack people={plan.members.filter((m) => m.status !== null)} waiting={pending.length} />
            <span className="note grow">
              Ответили {plan.responded} из {plan.members.length}
              {pending.length > 0 && ` · ждём ${joinNames(pending.map((m) => m.name))}`}
            </span>
          </span>
          {(pending.length > 0 || plan.inGroup) && (
            <button type="button" className="btn-link" onClick={nudge}>
              <IconBell size={18} />
              Напомнить
            </button>
          )}
        </div>

        <section className="stack">
          <h2 className="section-title">Лучшее время</h2>
          {plan.top.length === 0 ? (
            <div className="error-box">Пока никто не отметил время.</div>
          ) : (
            <div className="group">
              {plan.top.map((s, i) => (
                <button
                  key={s.key}
                  type="button"
                  className="row"
                  aria-pressed={slot === s.key}
                  onClick={() => {
                    haptic.select();
                    setSlot(s.key);
                  }}
                >
                  <DateTile day={s.date} />
                  <span className="lbl">
                    <span>
                      {s.time}
                      {i === 0 && <span className="tag on" style={{ marginLeft: 8, verticalAlign: 2 }}>Лучшее</span>}
                    </span>
                    <span className="sub">{slotHint(s, plan.responded)}</span>
                  </span>
                  <span className="check" aria-hidden="true">
                    <IconCheck size={16} strokeWidth={2} />
                  </span>
                </button>
              ))}
            </div>
          )}
          <button type="button" className="btn-link" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Скрыть таблицу' : 'Вся таблица'}
            <IconChevron size={16} className="chev" />
          </button>
          {showAll && <HeatGrid days={plan.days} times={plan.times} heat={plan.heat} total={plan.responded} bestKey={plan.top[0]?.key ?? null} />}
        </section>

        <section className="stack">
          <h2 className="section-title">Место</h2>
          <div className="group">
            {placeOptions.map((p) => (
              <button
                key={p.id}
                type="button"
                className="row"
                aria-pressed={place === p.id}
                onClick={() => {
                  haptic.select();
                  setPlace(p.id);
                }}
              >
                <span className="lbl">
                  <span>{p.name}</span>
                  <span className="sub">
                    {plan.votePlace ? `${p.votes} ${plural(p.votes, ['голос', 'голоса', 'голосов'])}` : (p.address ?? p.kind)}
                    {p.travel ? ` · ${p.travel}` : ''}
                  </span>
                </span>
                <span className="check" aria-hidden="true">
                  <IconCheck size={16} strokeWidth={2} />
                </span>
              </button>
            ))}
            <button type="button" className="row" aria-pressed={place === null} onClick={() => setPlace(null)}>
              <span className="lbl">
                <span>Решим позже</span>
              </span>
              <span className="check" aria-hidden="true">
                <IconCheck size={16} strokeWidth={2} />
              </span>
            </button>
            {plan.votePlace && (
              <button type="button" className="row" onClick={() => nav.push({ name: 'places', id })}>
                <span className="lbl">
                  <span>Открыть голосование</span>
                </span>
                <IconChevron size={16} className="chev" />
              </button>
            )}
          </div>
        </section>
      </main>

      <ActionBar
        note={chosenSlot ? null : 'Выберите время'}
        main={{
          label: chosenSlot ? `Подтвердить: ${weekdayShort(chosenSlot.date)}, ${chosenSlot.time}` : 'Подтвердить',
          onClick: confirm,
          disabled: !chosenSlot,
          busy,
        }}
      />
    </div>
  );
}
