import { useEffect, useState } from 'react';
import { BUDGET_LABELS, DURATION_LABELS, FORMAT_LABELS, budgetLabel, daysRangeLabel, plural } from '../../../shared/format.ts';
import type { Budget, Duration, Format, NewPlace, NewPlan } from '../../../shared/types.ts';
import { api, enableReminders } from '../api.ts';
import { IconArrowRight, IconSend } from '../components/icons.tsx';
import { MonthCalendar } from '../components/MonthCalendar.tsx';
import { PlacePicker, emptyPlace, placePoint } from '../components/PlacePicker.tsx';
import { BottomBar, MainButton, Segmented, ToggleRow, useToast } from '../components/ui.tsx';
import { weekend } from '../lib/links.ts';
import { useNav } from '../nav.tsx';
import { haptic, shareToChat } from '../telegram.ts';

const TIMES = ['09:00', '11:00', '13:00', '15:00', '17:00', '19:00', '21:00'];
/** Столько же разрешает сервер (server/app/plans.py). */
const MAX_DAYS = 14;
const DEADLINES = [
  { value: '24', label: '24 часа' },
  { value: '48', label: '2 дня' },
  { value: 'none', label: 'Без срока' },
] as const;

const opts = <T extends string>(labels: Record<T, string>) =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

export function Create({ template, chatId }: { template?: Partial<NewPlan>; chatId?: number }) {
  const nav = useNav();
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState(template?.title ?? 'Встреча на выходных');
  const [format, setFormat] = useState<Format>(template?.format ?? 'eat');
  const [budget, setBudget] = useState<Budget>(template?.budget ?? '2');
  const [duration, setDuration] = useState<Duration>(template?.duration ?? '2-3');
  const [days, setDays] = useState<string[]>(template?.days ?? weekend());
  const [times, setTimes] = useState<string[]>(template?.times ?? ['17:00', '19:00', '21:00']);
  const [deadline, setDeadline] = useState<(typeof DEADLINES)[number]['value']>('48');
  const [votePlace, setVotePlace] = useState(template?.votePlace ?? true);
  const [middle, setMiddle] = useState(template?.middle ?? true);
  const [place, setPlace] = useState<NewPlace>(template?.place ?? emptyPlace());

  // Кнопка «Назад» Telegram на шагах 2–3 возвращает на предыдущий шаг.
  useEffect(() => {
    nav.setBackOverride(
      step > 1
        ? () => {
            setStep((s) => s - 1);
            return true;
          }
        : null,
    );
    return () => nav.setBackOverride(null);
  }, [step, nav]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

  const toggle = (list: string[], item: string) =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item].sort();

  // Без голосования и без поиска середины место встречи называет организатор — сразу.
  const needsPlace = !votePlace && !middle;
  const placeReady = place.name.trim().length > 0 && placePoint(place) !== null;
  const canNext = step === 1 ? title.trim().length > 0 : step === 2 ? days.length > 0 && times.length > 0 : true;

  async function submit() {
    setBusy(true);
    try {
      const { id, posted } = await api.create({
        title: title.trim(),
        format,
        budget,
        duration,
        days,
        times,
        deadlineHours: deadline === 'none' ? null : Number(deadline),
        votePlace,
        middle,
        placeId: null,
        place: needsPlace ? { ...place, name: place.name.trim() } : null,
        chatId: chatId ?? null,
      });
      haptic.success();
      nav.reset([{ name: 'home' }, { name: 'plan', id }]);
      void enableReminders();
      if (posted) toast('Карточка отправлена в группу');
      else if (!shareToChat(id)) toast('Сходка создана — отправьте ссылку друзьям');
    } catch (e) {
      haptic.error();
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div className="head" style={{ padding: '20px 20px 0', gap: 10 }}>
        <div className="steps" aria-hidden="true">
          {[1, 2, 3].map((s) => (
            <span key={s} className={s <= step ? 'on' : ''} />
          ))}
        </div>
        <div className="caption">Шаг {step} из 3</div>
        <h1 className="h1">{step === 1 ? 'Что делаем?' : step === 2 ? 'Когда?' : 'Где?'}</h1>
      </div>

      <main className="content" style={{ gap: 22 }}>
        {step === 1 && (
          <>
            <div className="field">
              <label className="label" htmlFor="plan-title">
                Название
              </label>
              <input id="plan-title" className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <fieldset>
              <legend className="label">Формат</legend>
              <div className="chips">
                {opts(FORMAT_LABELS).map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className="chip"
                    aria-pressed={format === o.value}
                    onClick={() => {
                      haptic.select();
                      setFormat(o.value);
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="label">Бюджет на человека, сум</legend>
              <div className="chips">
                {opts(BUDGET_LABELS).map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className="chip"
                    aria-pressed={budget === o.value}
                    onClick={() => {
                      haptic.select();
                      setBudget(o.value);
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="label">Сколько по времени</legend>
              <Segmented label="Сколько по времени" options={opts(DURATION_LABELS)} value={duration} onChange={setDuration} />
            </fieldset>
          </>
        )}

        {step === 2 && (
          <>
            <fieldset>
              <legend className="label">Дни</legend>
              <div className="chips" style={{ marginBottom: 10 }}>
                <button type="button" className="chip sm" onClick={() => setDays(weekend())}>
                  Эти выходные
                </button>
                <button type="button" className="chip sm" onClick={() => setDays(weekend(1))}>
                  Следующие
                </button>
                <button type="button" className="chip sm" onClick={() => setDays([])}>
                  Сбросить
                </button>
              </div>
              <MonthCalendar value={days} onChange={setDays} max={MAX_DAYS} onLimit={() => toast(`Можно выбрать до ${MAX_DAYS} дней`)} />
              {days.length > 0 && (
                <div className="caption" style={{ marginTop: 8 }}>
                  Выбрано {days.length} {plural(days.length, ['день', 'дня', 'дней'])}: {daysRangeLabel(days)}
                </div>
              )}
            </fieldset>
            <fieldset>
              <legend className="label">Во сколько можно начать</legend>
              <div className="chips">
                {TIMES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="chip sm"
                    aria-pressed={times.includes(t)}
                    onClick={() => {
                      haptic.select();
                      setTimes(toggle(times, t));
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="label">Ответить до</legend>
              <Segmented label="Ответить до" options={[...DEADLINES]} value={deadline} onChange={setDeadline} />
            </fieldset>
          </>
        )}

        {step === 3 && (
          <>
            <div className="list">
              <ToggleRow
                id="t-vote"
                title="Место выберем голосованием"
                hint="Каждый сможет предложить своё"
                checked={votePlace}
                onChange={setVotePlace}
              />
              <ToggleRow
                id="t-middle"
                title="Подобрать место посередине"
                hint="Учтём, кому откуда ехать"
                checked={middle}
                onChange={setMiddle}
              />
            </div>
            {needsPlace && (
              <section className="section">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <h2 className="h2">Где встречаемся</h2>
                  <div className="caption">Найдите заведение или поставьте точку на карте.</div>
                </div>
                <PlacePicker id="meet" value={place} onChange={setPlace} format={format} />
              </section>
            )}
            <div className="card">
              <div style={{ fontSize: 18, fontWeight: 600 }}>{title.trim() || 'Без названия'}</div>
              <div className="caption">
                {[FORMAT_LABELS[format], budgetLabel(budget), DURATION_LABELS[duration]]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              <div className="caption">
                {daysRangeLabel(days)} · {times.join(', ')}
              </div>
              {needsPlace && place.name.trim() && <div className="caption">{place.name.trim()}</div>}
            </div>
            <p className="caption" style={{ margin: '0 4px', lineHeight: 1.5 }}>
              {chatId
                ? 'После создания бот пришлёт карточку в группу, и все ответят в пару касаний.'
                : 'После создания выберите чат — бот пришлёт туда карточку, и друзья ответят в пару касаний.'}
            </p>
          </>
        )}
      </main>

      <BottomBar>
        {step < 3 ? (
          <MainButton onClick={() => setStep(step + 1)} disabled={!canNext}>
            {step === 1 ? 'Далее — когда' : 'Далее — где'}
            <IconArrowRight size={20} strokeWidth={2.5} />
          </MainButton>
        ) : (
          <>
            {needsPlace && !placeReady && (
              <div className="caption" style={{ textAlign: 'center' }}>
                Выберите место на карте
              </div>
            )}
            <MainButton onClick={submit} busy={busy} disabled={needsPlace && !placeReady}>
              <IconSend size={20} />
              {chatId ? 'Создать и отправить в группу' : 'Создать и отправить в чат'}
            </MainButton>
          </>
        )}
      </BottomBar>
    </div>
  );
}
