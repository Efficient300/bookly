import { useState } from 'react';
import {
  DURATION_LABELS,
  FORMAT_LABELS,
  budgetLabel,
  daysRangeLabel,
  deadlineLabel,
  joinNames,
  plural,
} from '../../../shared/format.ts';
import type { MemberStatus, PlanView, SlotValue } from '../../../shared/types.ts';
import { api, enableReminders, planLink } from '../api.ts';
import { DeletePlanButton } from '../components/DeletePlanButton.tsx';
import { IconChevron, IconHeart, IconPin, IconSend } from '../components/icons.tsx';
import { SlotGrid, SlotLegend } from '../components/SlotGrid.tsx';
import { Avatar, AvatarStack, BottomBar, MainButton, Segmented, useToast } from '../components/ui.tsx';
import { useNav } from '../nav.tsx';
import { haptic, shareToChat } from '../telegram.ts';

const STATUS_OPTIONS: { value: MemberStatus; label: string }[] = [
  { value: 'go', label: 'Иду' },
  { value: 'maybe', label: 'Может быть' },
  { value: 'no', label: 'Не могу' },
];

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

  const meta = [
    FORMAT_LABELS[plan.format],
    budgetLabel(plan.budget),
    DURATION_LABELS[plan.duration],
  ].filter(Boolean) as string[];

  return (
    <div className="screen">
      <main className="content">
        <div className="head">
          <div className="row caption">
            {plan.isOwner ? (
              'Вы организатор'
            ) : (
              <>
                <Avatar name={plan.ownerName} size={22} />
                {plan.ownerName} зовёт вас
              </>
            )}
          </div>
          <h1 className="h1">{plan.title}</h1>
          <div className="row wrap" style={{ gap: 6 }}>
            {meta.map((m) => (
              <span key={m} className="pill">
                {m}
              </span>
            ))}
            <span className="pill">{daysRangeLabel(plan.days)}</span>
          </div>
        </div>

        {plan.isOwner && (
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="row" style={{ gap: 10 }}>
                <AvatarStack people={plan.members.filter((m) => m.status !== null)} size={24} />
                <span className="small">
                  Ответили {plan.responded}
                  {pending.length > 0 && <span className="muted"> · без ответа: {joinNames(pending.map((m) => m.name))}</span>}
                </span>
              </div>
            </div>
            <div className="row">
              <button type="button" className="btn-small" onClick={() => nav.push({ name: 'results', id: plan.id })}>
                Итоги и выбор
              </button>
              <button type="button" className="btn-small outline row" onClick={share}>
                <IconSend size={16} />В чат
              </button>
            </div>
          </div>
        )}

        <Segmented label="Ваш статус" options={STATUS_OPTIONS} value={status} onChange={setStatus} />

        {status !== 'no' && (
          <section className="card" style={{ padding: '16px 14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h2 className="h2" style={{ fontSize: 18 }}>
                Когда вам удобно?
              </h2>
              <div className="caption">Нажимайте или ведите пальцем: удобно → если надо → нет</div>
            </div>
            <SlotLegend />
            <SlotGrid days={plan.days} times={plan.times} value={slots} onChange={setSlots} />
            <div className="chips">
              <button type="button" className="chip sm" onClick={() => fillAll(() => true)}>
                Всё время
              </button>
              <button type="button" className="chip sm" onClick={() => fillAll((t) => evenings.includes(t))}>
                Только вечер
              </button>
              <button type="button" className="chip sm" onClick={() => setSlots({})}>
                Сбросить
              </button>
            </div>
          </section>
        )}

        {status !== 'no' && (plan.middle || plan.votePlace || meeting) && (
          <div className="list">
            {meeting && (
              <button type="button" className="list-row" onClick={() => nav.push({ name: 'places', id: plan.id })}>
                <IconPin size={22} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>{meeting.name}</span>
                  <span className="caption">{meeting.travel ?? 'Место встречи'}</span>
                </span>
                <span style={{ color: 'var(--accent)', fontSize: 14, fontWeight: 600 }}>На карте</span>
              </button>
            )}
            {plan.middle && (
              <button type="button" className="list-row" onClick={() => nav.push({ name: 'area', id: plan.id })}>
                <IconPin size={22} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>{plan.me.area ? 'Район отмечен' : 'Откуда поедете?'}</span>
                  <span className="caption">
                    {plan.me.area ? 'Точный адрес никто не увидит' : 'Подберём место посередине'}
                  </span>
                </span>
                <span style={{ color: 'var(--accent)', fontSize: 14, fontWeight: 600 }}>{plan.me.area ? 'Изменить' : 'Отметить'}</span>
              </button>
            )}
            {plan.votePlace && (
              <button type="button" className="list-row" onClick={() => nav.push({ name: 'places', id: plan.id })}>
                <IconHeart size={22} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>Голосование за место</span>
                  <span className="caption">
                    {leadingPlace
                      ? `Впереди ${leadingPlace.name}`
                      : `${plan.places.length} ${plural(plan.places.length, ['вариант', 'варианта', 'вариантов'])} на выбор`}
                  </span>
                </span>
                <IconChevron size={18} style={{ color: 'var(--muted)' }} />
              </button>
            )}
          </div>
        )}

        {plan.deadline && <div className="caption" style={{ padding: '0 4px' }}>Ответить до {deadlineLabel(plan.deadline)}</div>}
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
