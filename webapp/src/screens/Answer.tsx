import { useState } from 'react';
import { DURATION_LABELS, FORMAT_LABELS, budgetLabel, daysRangeLabel, deadlineLabel, joinNames, plural } from '../../../shared/format.ts';
import type { MemberStatus, PlanView, SlotValue } from '../../../shared/types.ts';
import { api, enableReminders, planLink } from '../api.ts';
import { DeletePlanButton } from '../components/DeletePlanButton.tsx';
import { IconChevron, IconHeart, IconPin, IconSend } from '../components/icons.tsx';
import { PlanCover } from '../components/PlanCover.tsx';
import { BrushPicker, SlotGrid } from '../components/SlotGrid.tsx';
import type { Brush } from '../components/SlotGrid.tsx';
import { Avatar, AvatarStack, BottomBar, MainButton, StatusPicker, useToast } from '../components/ui.tsx';
import { useNav } from '../nav.tsx';
import { haptic, shareToChat } from '../telegram.ts';

const same = (a: Record<string, SlotValue>, b: Record<string, SlotValue>) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

type Draft = { status: MemberStatus | null; slots: Record<string, SlotValue> };
// Неотправленный ответ переживает переход на карту или к голосованию и обратно.
const drafts = new Map<string, Draft>();

/** Экран участника, пока идёт сбор: статус, сетка слотов, район, голосование. */
export function Answer({ plan, setPlan }: { plan: PlanView; setPlan: (p: PlanView) => void }) {
  const nav = useNav();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(() => drafts.get(plan.id) ?? null);
  const [busy, setBusy] = useState(false);
  const [brush, setBrush] = useState<Brush>(1);
  const status = draft ? draft.status : plan.me.status;
  const slots = draft ? draft.slots : plan.me.slots;
  const change = (next: Draft) => {
    drafts.set(plan.id, next);
    setDraft(next);
  };
  const setStatus = (next: MemberStatus) => change({ status: next, slots });
  const setSlots = (next: Record<string, SlotValue>) => change({ status, slots: next });

  const answered = plan.me.status !== null;
  const dirty = status !== plan.me.status || !same(slots, plan.me.slots);
  const evenings = ['17:00', '19:00', '21:00'];
  const fillAll = (pick: (time: string) => boolean) =>
    setSlots(
      Object.fromEntries(
        plan.days.flatMap((d) => plan.times.filter(pick).map((t) => [`${d}T${t}`, 1 as SlotValue])),
      ),
    );

  const leadingPlace = plan.places.find((p) => p.votes > 0);
  // Место, которое организатор назвал сразу, без голосования.
  const meeting = !plan.votePlace && plan.placeId ? (plan.places.find((p) => p.id === plan.placeId) ?? null) : null;
  const pending = plan.members.filter((m) => m.status === null && !m.isOwner);

  async function submit() {
    if (!status) {
      toast('Выберите: иду, может быть или не могу');
      return;
    }
    setBusy(true);
    try {
      const next = await api.updateMe(plan.id, { status, slots: status === 'no' ? {} : slots });
      setPlan(next);
      drafts.delete(plan.id);
      setDraft(null);
      haptic.success();
      toast(answered ? 'Ответ обновлён' : 'Ответ отправлен');
      void enableReminders();
      if (!answered && next.votePlace && status !== 'no' && !next.places.some((p) => p.liked)) {
        nav.push({ name: 'places', id: plan.id });
      }
    } catch (e) {
      haptic.error();
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function share() {
    if (shareToChat(plan.id)) return;
    void navigator.clipboard?.writeText(planLink(plan.id));
    toast('Ссылка скопирована');
  }

  const meta = [FORMAT_LABELS[plan.format], budgetLabel(plan.budget), DURATION_LABELS[plan.duration]].filter(Boolean).join(' · ');

  return (
    <div className="screen">
      <main className="content">
        <PlanCover format={plan.format}>
          <span className="row cover-sub" style={{ gap: 6 }}>
            {!plan.isOwner && <Avatar name={plan.ownerName} photo={plan.ownerPhoto} size={22} />}
            {plan.isOwner ? 'Вы организатор' : `${plan.ownerName} зовёт вас`}
          </span>
          <h1 className="cover-title">{plan.title}</h1>
          <span className="cover-sub">{daysRangeLabel(plan.days)}</span>
          <span className="cover-sub">{meta}</span>
        </PlanCover>

        {plan.isOwner && (
          <div className="card">
            <div className="row" style={{ gap: 10 }}>
              <AvatarStack people={plan.members.filter((m) => m.status !== null)} size={26} />
              <span className="small grow">
                Ответили: {plan.responded}
                {pending.length > 0 && <span className="muted"> · ждём {joinNames(pending.map((m) => m.name))}</span>}
              </span>
            </div>
            <div className="row">
              <button type="button" className="btn-small grow" onClick={() => nav.push({ name: 'results', id: plan.id })}>
                Итоги и выбор
              </button>
              <button type="button" className="btn-small outline row" onClick={share}>
                <IconSend size={16} />В чат
              </button>
            </div>
          </div>
        )}

        <section className="section">
          <h2 className="h2">Вы идёте?</h2>
          <StatusPicker value={status} onChange={setStatus} />
        </section>

        {status !== 'no' && (
          <section className="section">
            <h2 className="h2">Когда удобно?</h2>
            <div className="card">
              <BrushPicker value={brush} onChange={setBrush} />
              <SlotGrid days={plan.days} times={plan.times} value={slots} brush={brush} onChange={setSlots} />
              <div className="row quick-row">
                <button type="button" className="btn-link" onClick={() => fillAll(() => true)}>
                  Всё время
                </button>
                <button type="button" className="btn-link" onClick={() => fillAll((t) => evenings.includes(t))}>
                  Только вечер
                </button>
                <button type="button" className="btn-link" onClick={() => setSlots({})}>
                  Очистить
                </button>
              </div>
            </div>
          </section>
        )}

        {status !== 'no' && (plan.middle || plan.votePlace || meeting) && (
          <section className="section">
            <h2 className="h2">Где</h2>
            <div className="list">
              {meeting && (
                <button type="button" className="list-row" onClick={() => nav.push({ name: 'places', id: plan.id })}>
                  <span className="icon-box">
                    <IconPin size={20} />
                  </span>
                  <span className="grow row-text">
                    <span className="list-title">{meeting.name}</span>
                    <span className="caption">{meeting.travel ?? 'Место встречи'}</span>
                  </span>
                  <IconChevron size={16} className="row-chevron" />
                </button>
              )}
              {plan.votePlace && (
                <button type="button" className="list-row" onClick={() => nav.push({ name: 'places', id: plan.id })}>
                  <span className="icon-box pink">
                    <IconHeart size={20} />
                  </span>
                  <span className="grow row-text">
                    <span className="list-title">Голосование за место</span>
                    <span className="caption">
                      {leadingPlace
                        ? `Впереди ${leadingPlace.name}`
                        : `${plan.places.length} ${plural(plan.places.length, ['вариант', 'варианта', 'вариантов'])} на выбор`}
                    </span>
                  </span>
                  <IconChevron size={16} className="row-chevron" />
                </button>
              )}
              {plan.middle && (
                <button type="button" className="list-row" onClick={() => nav.push({ name: 'area', id: plan.id })}>
                  <span className="icon-box">
                    <IconPin size={20} />
                  </span>
                  <span className="grow row-text">
                    <span className="list-title">{plan.me.area ? 'Район отмечен' : 'Откуда поедете?'}</span>
                    <span className="caption">{plan.me.area ? 'Точный адрес никто не увидит' : 'Подберём место посередине'}</span>
                  </span>
                  <IconChevron size={16} className="row-chevron" />
                </button>
              )}
            </div>
          </section>
        )}

        {plan.deadline && <div className="caption section-note">Ответить до {deadlineLabel(plan.deadline)}</div>}
        {plan.isOwner && <DeletePlanButton id={plan.id} />}
      </main>

      <BottomBar>
        <MainButton onClick={submit} busy={busy} disabled={answered && !dirty}>
          {answered ? (dirty ? 'Сохранить ответ' : 'Ответ сохранён') : 'Отправить ответ'}
        </MainButton>
      </BottomBar>
    </div>
  );
}
