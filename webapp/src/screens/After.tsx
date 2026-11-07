import { useState } from 'react';
import { dayLabel } from '../../../shared/format.ts';
import type { PlanView, Review } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { DeletePlanButton } from '../components/DeletePlanButton.tsx';
import { IconCheck, IconStar } from '../components/icons.tsx';
import { PlanCover } from '../components/PlanCover.tsx';
import { ActionBar, Avatar, useToast } from '../components/ui.tsx';
import { useNav } from '../nav.tsx';
import { haptic } from '../telegram.ts';

const TAGS = ['Вкусно', 'Уютно', 'Шумно', 'Дорого', 'Долго несли'];
const sums = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const money = (sum: number) => `${sums.format(sum)} сум`;
/** «1 200 000» или «1200000,5» → число. */
const parseSum = (text: string) => Number(text.replace(/\s/g, '').replace(',', '.'));

/** После встречи: состоялась ли, оценка места, делёж счёта, повтор. */
export function After({ plan, setPlan }: { plan: PlanView; setPlan: (p: PlanView) => void }) {
  const nav = useNav();
  const myId = plan.me.id;
  const toast = useToast();
  const [total, setTotal] = useState('');
  const review: Review = plan.me.review ?? { happened: true, rating: null, tags: [] };
  const place = plan.places.find((p) => p.id === plan.chosen?.placeId) ?? null;
  const going = plan.members.filter((m) => m.status === 'go');
  const bill = plan.bill;
  const payer = bill ? plan.members.find((m) => m.id === bill.payerId) : null;
  const share = bill && going.length > 0 ? bill.total / going.length : 0;

  async function run(action: () => Promise<PlanView>) {
    try {
      setPlan(await action());
      haptic.select();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const saveReview = (next: Partial<Review>) => run(() => api.review(plan.id, { ...review, ...next }));

  function repeat() {
    nav.push({
      name: 'create',
      template: {
        title: plan.title,
        format: plan.format,
        budget: plan.budget,
        duration: plan.duration,
        votePlace: plan.votePlace,
        middle: plan.middle,
      },
    });
  }

  return (
    <div className="screen">
      <main className="content">
        <PlanCover format={plan.format}>
          <span className="cover-sub">{plan.title}</span>
          <h1 className="cover-title">Как прошло?</h1>
          <span className="cover-sub">
            {[place?.name, plan.chosen ? dayLabel(plan.chosen.date) : null].filter(Boolean).join(' · ')}
          </span>
        </PlanCover>

        <div className="card row-flex" style={{ flexDirection: 'row', alignItems: 'center' }}>
          <span className="grow" style={{ fontSize: 15, fontWeight: 500 }}>
            Встреча состоялась?
          </span>
          <button type="button" className="chip" aria-pressed={review.happened} onClick={() => saveReview({ happened: true })}>
            Да
          </button>
          <button type="button" className="chip" aria-pressed={!review.happened} onClick={() => saveReview({ happened: false })}>
            Нет
          </button>
        </div>

        {review.happened && place && (
          <section className="card">
            <h2 className="h2" style={{ fontSize: 15, fontWeight: 500 }}>
              Оцените место
            </h2>
            <div className="stars" role="group" aria-label="Оценка места">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={review.rating !== null && n <= review.rating ? 'on' : ''}
                  aria-label={`${n} из 5`}
                  aria-pressed={review.rating === n}
                  onClick={() => saveReview({ rating: n })}
                >
                  <IconStar size={32} />
                </button>
              ))}
            </div>
            <div className="chips">
              {TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="chip"
                  aria-pressed={review.tags.includes(tag)}
                  onClick={() =>
                    saveReview({ tags: review.tags.includes(tag) ? review.tags.filter((t) => t !== tag) : [...review.tags, tag] })
                  }
                >
                  {tag}
                </button>
              ))}
            </div>
          </section>
        )}

        {review.happened && (
          <section className="card">
            <h2 className="h2" style={{ fontSize: 15, fontWeight: 500 }}>
              Поделить счёт
            </h2>
            {!bill ? (
              <form
                className="row-flex"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => api.setBill(plan.id, parseSum(total)));
                }}
              >
                <label className="sr-only" htmlFor="bill-total">
                  Общий счёт
                </label>
                <input
                  id="bill-total"
                  className="input grow"
                  inputMode="numeric"
                  placeholder="Общий счёт, сум"
                  value={total}
                  onChange={(e) => setTotal(e.target.value)}
                />
                <button type="submit" className="btn small ink" style={{ height: 44, borderRadius: 12 }} disabled={!parseSum(total)}>
                  Счёт на мне
                </button>
              </form>
            ) : (
              <>
                <div className="row-flex" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span className="caption">Общий счёт</span>
                    <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>{money(bill.total)}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                    <span className="caption">Кто платил</span>
                    <span className="row-flex" style={{ fontSize: 15, fontWeight: 500 }}>
                      {payer && <Avatar name={payer.name} photo={payer.photo} size={22} />}
                      {payer?.name ?? '—'}
                    </span>
                  </div>
                </div>
                <div className="caption">
                  Поровну на {going.length}: по <b style={{ color: 'var(--ink)' }}>{money(share)}</b> с человека
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {going
                    .filter((m) => m.id !== bill.payerId)
                    .map((m) => {
                      const paid = bill.paid.includes(m.id);
                      const canMark = myId === bill.payerId || myId === m.id;
                      return (
                        <div key={m.id} className="row-flex" style={{ height: 44, gap: 10 }}>
                          <Avatar name={m.name} photo={m.photo} />
                          <span className="grow" style={{ fontSize: 15, fontWeight: 500 }}>
                            {m.name}
                          </span>
                          {paid ? (
                            <button
                              type="button"
                              className="tag on"
                              style={{ border: 'none', height: 30, borderRadius: 10 }}
                              disabled={!canMark}
                              onClick={() => run(() => api.markPaid(plan.id, m.id, false))}
                            >
                              <IconCheck size={14} strokeWidth={2.5} />
                              Отдано
                            </button>
                          ) : canMark ? (
                            <button
                              type="button"
                              className="btn small secondary"
                              style={{ height: 30, fontSize: 13 }}
                              onClick={() => run(() => api.markPaid(plan.id, m.id, true))}
                            >
                              Отметить
                            </button>
                          ) : (
                            <span className="caption">ждём</span>
                          )}
                        </div>
                      );
                    })}
                </div>
              </>
            )}
          </section>
        )}
        {plan.isOwner && <DeletePlanButton id={plan.id} />}
      </main>

      <ActionBar main={{ label: 'Повторить в том же составе', onClick: repeat }} />
    </div>
  );
}
