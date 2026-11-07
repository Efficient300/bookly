import { useEffect, useState } from 'react';
import { DURATION_LABELS, budgetLabel, daysRangeLabel, deadlineLabel, joinNames, plural } from '../../../shared/format.ts';
import type { PlanView, SlotValue } from '../../../shared/types.ts';
import { api, enableReminders, planLink } from '../api.ts';
import { DeletePlanButton } from '../components/DeletePlanButton.tsx';
import { IconCalendar, IconChevron, IconClock, IconSend, IconWallet } from '../components/icons.tsx';
import { SlotGrid, SlotLegend } from '../components/SlotGrid.tsx';
import { ActionBar, Avatar, AvatarStack, useToast } from '../components/ui.tsx';
import { useNav } from '../nav.tsx';
import { haptic, shareToChat } from '../telegram.ts';

// Неотправленные отметки переживают переход к месту или району и обратно.
const drafts = new Map<string, Record<string, SlotValue>>();

/** Сбор ответов: приглашение, затем сетка «когда удобно», затем место или район. */
export function Answer({ plan, setPlan }: { plan: PlanView; setPlan: (p: PlanView) => void }) {
  const nav = useNav();
  const toast = useToast();
  const [step, setStep] = useState<'invite' | 'times'>('invite');
  const [slots, setSlotsState] = useState<Record<string, SlotValue>>(() => drafts.get(plan.id) ?? plan.me.slots);
  const [busy, setBusy] = useState(false);
  const setSlots = (next: Record<string, SlotValue>) => {
    drafts.set(plan.id, next);
    setSlotsState(next);
  };

  // «Назад» на сетке времени возвращает к приглашению, а не уводит со сходки.
  useEffect(() => {
    if (step !== 'times') return;
    nav.setOverlayBack(() => {
      setStep('invite');
      return true;
    });
    return () => nav.setOverlayBack(null);
  }, [step, nav]);

  const answered = plan.me.status !== null;
  const marked = Object.keys(slots).length;
  const responded = plan.members.filter((m) => m.status !== null);
  const waiting = plan.members.length - responded.length;

  async function save(status: 'go' | 'no') {
    setBusy(true);
    try {
      const next = await api.updateMe(plan.id, { status, slots: status === 'no' ? {} : slots });
      setPlan(next);
      drafts.delete(plan.id);
      haptic.success();
      void enableReminders();
      return next;
    } catch (e) {
      haptic.error();
      toast((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    if (await save('no')) {
      toast('Ответ отправлен: не сможете');
      setStep('invite');
    }
  }

  async function submitTimes() {
    const next = await save('go');
    if (!next) return;
    setStep('invite');
    if (next.votePlace) nav.push({ name: 'places', id: plan.id });
    else if (next.middle) nav.push({ name: 'area', id: plan.id });
    else toast('Ответ отправлен');
  }

  function share() {
    if (shareToChat(plan.id)) return;
    void navigator.clipboard?.writeText(planLink(plan.id));
    toast('Ссылка скопирована');
  }

  if (step === 'times') {
    const next = plan.votePlace ? 'Дальше: место' : plan.middle ? 'Дальше: район' : 'Отправить ответ';
    return (
      <div className="screen">
        <main className="content">
          <div className="stack" style={{ gap: 8 }}>
            <span className="note">{plan.title}</span>
            <h1 className="h1">Когда вы свободны?</h1>
            <p className="note" style={{ margin: 0 }}>
              Отметьте все подходящие варианты. Чем больше, тем проще найти общее время.
            </p>
          </div>
          <SlotGrid days={plan.days} times={plan.times} value={slots} onChange={setSlots} />
          <SlotLegend />
          <span className="note">Нажмите на ячейку, чтобы отметить. Можно провести пальцем по нескольким.</span>
        </main>
        <ActionBar
          note={marked ? null : 'Отметьте хотя бы один вариант'}
          main={{
            label: marked ? `${next} · ${marked} ${plural(marked, ['вариант', 'варианта', 'вариантов'])}` : next,
            onClick: submitTimes,
            disabled: !marked,
            busy,
          }}
        />
      </div>
    );
  }

  const statusLine = plan.me.status === 'no' ? 'Вы ответили: не сможете' : answered ? `Вы отметили ${Object.keys(plan.me.slots).length} ${plural(Object.keys(plan.me.slots).length, ['вариант', 'варианта', 'вариантов'])}` : null;

  return (
    <div className="screen">
      <main className="content">
        <div className="stack" style={{ gap: 10 }}>
          <span className="row-flex note">
            {plan.isOwner ? (
              'Вы организатор'
            ) : (
              <>
                <Avatar name={plan.ownerName} photo={plan.ownerPhoto} size={24} />
                Зовёт {plan.ownerName}
              </>
            )}
          </span>
          <h1 className="h1">{plan.title}</h1>
          {plan.deadline && <span className="note">Ответьте до {deadlineLabel(plan.deadline)}</span>}
        </div>

        <div className="group">
          <div className="row">
            <span className="row-icon">
              <IconCalendar size={20} />
            </span>
            <span className="lbl">
              <span>{daysRangeLabel(plan.days)}</span>
            </span>
          </div>
          <div className="row">
            <span className="row-icon">
              <IconClock size={20} />
            </span>
            <span className="lbl">
              <span>
                {plan.times.join(', ')} · {DURATION_LABELS[plan.duration]}
              </span>
            </span>
          </div>
          {budgetLabel(plan.budget) && (
            <div className="row">
              <span className="row-icon">
                <IconWallet size={20} />
              </span>
              <span className="lbl">
                <span>{budgetLabel(plan.budget)} на человека</span>
              </span>
            </div>
          )}
        </div>

        <section className="stack">
          <div className="row-flex" style={{ justifyContent: 'space-between' }}>
            <h2 className="section-title">Уже ответили</h2>
            <span className="note">
              {responded.length} из {plan.members.length}
            </span>
          </div>
          <div className="row-flex" style={{ gap: 12 }}>
            <AvatarStack people={responded} waiting={waiting} />
            <span className="note grow ellipsis">{joinNames(responded.map((m) => m.name)) || 'Пока никто'}</span>
          </div>
        </section>

        {plan.isOwner && (
          <div className="group">
            <button type="button" className="row" onClick={() => nav.push({ name: 'results', id: plan.id })}>
              <span className="lbl">
                <span>Итоги и выбор времени</span>
                <span className="sub">Лучшие варианты и подтверждение</span>
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
          </div>
        )}

        {answered && plan.me.status !== 'no' && (plan.votePlace || plan.middle) && (
          <div className="group">
            {plan.votePlace && (
              <button type="button" className="row" onClick={() => nav.push({ name: 'places', id: plan.id })}>
                <span className="lbl">
                  <span>Голосование за место</span>
                  <span className="sub">{plan.places.some((p) => p.liked) ? 'Вы проголосовали' : 'Вы ещё не голосовали'}</span>
                </span>
                <IconChevron size={16} className="chev" />
              </button>
            )}
            {plan.middle && (
              <button type="button" className="row" onClick={() => nav.push({ name: 'area', id: plan.id })}>
                <span className="lbl">
                  <span>Откуда поедете</span>
                  <span className="sub">{plan.me.area ? 'Район отмечен' : 'Район не отмечен'}</span>
                </span>
                <IconChevron size={16} className="chev" />
              </button>
            )}
          </div>
        )}

        {statusLine && <span className="note">{statusLine}</span>}
        {plan.isOwner && <DeletePlanButton id={plan.id} />}
      </main>

      <ActionBar
        main={{ label: answered ? 'Изменить ответ' : 'Отметить, когда удобно', onClick: () => setStep('times') }}
        secondary={plan.me.status === 'no' ? undefined : { label: 'Не смогу', onClick: decline, disabled: busy }}
      />
    </div>
  );
}
