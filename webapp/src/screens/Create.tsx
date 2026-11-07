import { useRef, useState } from 'react';
import { BUDGET_LABELS, DURATION_LABELS, FORMAT_LABELS, daysRangeLabel, plural } from '../../../shared/format.ts';
import type { Budget, Duration, Format, NewPlace, NewPlan } from '../../../shared/types.ts';
import { api, enableReminders } from '../api.ts';
import { IconPencil } from '../components/icons.tsx';
import { MonthCalendar } from '../components/MonthCalendar.tsx';
import { PlacePicker, emptyPlace, placePoint } from '../components/PlacePicker.tsx';
import { PlanCover } from '../components/PlanCover.tsx';
import { ActionBar, ChoiceChips, ExpandRow, Segmented, useToast } from '../components/ui.tsx';
import { weekdays, weekend } from '../lib/links.ts';
import { FORMAT_ICON } from '../lib/themes.tsx';
import { useNav } from '../nav.tsx';
import { haptic } from '../telegram.ts';

const HOURS = Array.from({ length: 15 }, (_, i) => `${String(i + 9).padStart(2, '0')}:00`);
const MAX_DAYS = 7;
/** Столько же разрешает сервер (server/app/plans.py). */
const MAX_TIMES = 12;

type PlaceMode = 'vote' | 'middle' | 'own';
const PLACE_MODES: { value: PlaceMode; label: string }[] = [
  { value: 'vote', label: 'Голосуем' },
  { value: 'middle', label: 'Посередине' },
  { value: 'own', label: 'Выберу я' },
];
const PLACE_HINTS: Record<PlaceMode, string> = {
  vote: 'Друзья отметят места из подборки и смогут добавить свои.',
  middle: 'Друзья отметят, откуда поедут. Когда все ответят, вы выберете место посередине.',
  own: 'Вы выбираете место сейчас — друзья сразу увидят, куда идти.',
};

type Section = 'days' | 'times' | 'duration' | 'deadline' | 'budget';

const opts = <T extends string>(labels: Record<T, string>) =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

const deadlineFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Срок ответа — конкретный вечер: через столько-то дней в 20:00, но не раньше чем через 12 часов. */
function deadlineAt(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(20, 0, 0, 0);
  if (d.getTime() - Date.now() < 12 * 3_600_000) d.setDate(d.getDate() + 1);
  return d;
}
const DEADLINES = [1, 2, 3];

function modeOf(template?: Partial<NewPlan>): PlaceMode {
  if (!template || template.votePlace) return 'vote';
  return template.middle ? 'middle' : 'own';
}

/** Новая сходка на одном экране: всё заполнено заранее, строки раскрываются чипами. */
export function Create({ template, chatId }: { template?: Partial<NewPlan>; chatId?: number }) {
  const nav = useNav();
  const toast = useToast();
  const titleInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Section | null>(null);
  const [customTime, setCustomTime] = useState(false);

  const [title, setTitle] = useState(template?.title ?? '');
  const [format, setFormat] = useState<Format>(template?.format ?? 'eat');
  const [budget, setBudget] = useState<Budget>(template?.budget ?? '2');
  const [duration, setDuration] = useState<Duration>(template?.duration ?? '2-3');
  const [days, setDays] = useState<string[]>(template?.days ?? weekend());
  const [times, setTimes] = useState<string[]>(template?.times ?? ['18:00', '19:00', '20:00']);
  const [deadline, setDeadline] = useState<number | null>(2);
  const [mode, setMode] = useState<PlaceMode>(() => modeOf(template));
  const [place, setPlace] = useState<NewPlace>(template?.place ?? emptyPlace());

  const toggle = (section: Section) => setOpen(open === section ? null : section);
  const needsPlace = mode === 'own';
  const placeReady = place.name.trim().length > 0 && placePoint(place) !== null;
  const variants = days.length * times.length;

  let blocker: string | null = null;
  if (!days.length) blocker = 'Выберите хотя бы один день';
  else if (!times.length) blocker = 'Выберите время начала';
  else if (needsPlace && !placeReady) blocker = 'Выберите место на карте';

  function toggleTime(t: string) {
    haptic.select();
    if (times.includes(t)) setTimes(times.filter((x) => x !== t));
    else if (times.length >= MAX_TIMES) toast(`Можно выбрать до ${MAX_TIMES} вариантов времени`);
    else setTimes([...times, t].sort());
  }

  async function submit() {
    setBusy(true);
    try {
      const hours = deadline === null ? null : (deadlineAt(deadline).getTime() - Date.now()) / 3_600_000;
      const { id, posted } = await api.create({
        title: title.trim() || FORMAT_LABELS[format],
        format,
        budget,
        duration,
        days,
        times,
        deadlineHours: hours,
        votePlace: mode === 'vote',
        middle: mode !== 'own',
        placeId: null,
        place: needsPlace ? { ...place, name: place.name.trim() } : null,
        chatId: chatId ?? null,
      });
      haptic.success();
      void enableReminders();
      nav.reset([{ name: 'home' }, { name: 'ready', id, posted }]);
    } catch (e) {
      haptic.error();
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <main className="content">
        <div className="stack" style={{ gap: 4 }}>
          <h1 className="section-title">Новая сходка</h1>
          <span className="note">
            {days.length ? daysRangeLabel(days) : 'Дни не выбраны'} · {variants} {plural(variants, ['вариант', 'варианта', 'вариантов'])}
          </span>
        </div>

        <PlanCover
          format={format}
          action={
            <button type="button" className="cover-edit" aria-label="Изменить название" onClick={() => titleInput.current?.focus()}>
              <IconPencil size={18} />
            </button>
          }
        >
          <label className="sr-only" htmlFor="plan-title">
            Название сходки
          </label>
          <input
            id="plan-title"
            ref={titleInput}
            className="cover-input"
            value={title}
            maxLength={80}
            placeholder={FORMAT_LABELS[format]}
            onChange={(e) => setTitle(e.target.value)}
          />
          <span className="cover-sub">Так сходку увидят друзья в чате</span>
        </PlanCover>

        <div className="tiles" role="group" aria-label="Категория">
          {opts(FORMAT_LABELS).map((o) => {
            const Icon = FORMAT_ICON[o.value];
            return (
              <button
                key={o.value}
                type="button"
                className="tile"
                aria-pressed={format === o.value}
                onClick={() => {
                  haptic.select();
                  setFormat(o.value);
                }}
              >
                <span className="sq">
                  <Icon size={28} />
                </span>
                <span>{o.label}</span>
              </button>
            );
          })}
        </div>

        <section className="stack">
          <h2 className="section-title">Когда</h2>
          <div className="group">
            <ExpandRow
              label="Дни"
              value={days.length ? daysRangeLabel(days) : 'Не выбраны'}
              warn={!days.length}
              open={open === 'days'}
              onToggle={() => toggle('days')}
            >
              <div className="chips">
                <button type="button" className="chip" onClick={() => setDays(weekend())}>
                  Эти выходные
                </button>
                <button type="button" className="chip" onClick={() => setDays(weekend(1))}>
                  Следующие
                </button>
                <button type="button" className="chip" onClick={() => setDays(weekdays())}>
                  Будни
                </button>
              </div>
              <MonthCalendar value={days} onChange={setDays} max={MAX_DAYS} onLimit={() => toast(`Можно выбрать до ${MAX_DAYS} дней`)} />
              <span className="note">Можно выбрать до {MAX_DAYS} дней. Сегодня обведено.</span>
            </ExpandRow>
            <ExpandRow
              label="Начало"
              value={times.length ? times.join(', ') : 'Не выбрано'}
              warn={!times.length}
              open={open === 'times'}
              onToggle={() => toggle('times')}
            >
              <div className="chips strip">
                {[...new Set([...HOURS, ...times])].sort().map((t) => (
                  <button key={t} type="button" className="chip" aria-pressed={times.includes(t)} onClick={() => toggleTime(t)}>
                    {t}
                  </button>
                ))}
                {customTime ? (
                  <input
                    className="chip-input"
                    type="time"
                    aria-label="Своё время"
                    autoFocus
                    onChange={(e) => {
                      const t = e.target.value;
                      if (/^\d{2}:\d{2}$/.test(t) && !times.includes(t)) toggleTime(t);
                    }}
                    onBlur={() => setCustomTime(false)}
                  />
                ) : (
                  <button type="button" className="chip add" onClick={() => setCustomTime(true)}>
                    Своё
                  </button>
                )}
              </div>
              <span className="note">
                Выбрано {times.length} {plural(times.length, ['вариант', 'варианта', 'вариантов'])}. Друзья отметят, какие им подходят.
              </span>
            </ExpandRow>
            <ExpandRow label="Длительность" value={DURATION_LABELS[duration]} open={open === 'duration'} onToggle={() => toggle('duration')}>
              <ChoiceChips label="Длительность" options={opts(DURATION_LABELS)} value={duration} onChange={setDuration} />
            </ExpandRow>
            <ExpandRow
              label="Ответить до"
              value={deadline === null ? 'Без срока' : deadlineFmt.format(deadlineAt(deadline))}
              open={open === 'deadline'}
              onToggle={() => toggle('deadline')}
            >
              <ChoiceChips
                label="Ответить до"
                options={[
                  ...DEADLINES.map((h) => ({ value: String(h), label: deadlineFmt.format(deadlineAt(h)) })),
                  { value: 'none', label: 'Без срока' },
                ]}
                value={deadline === null ? 'none' : String(deadline)}
                onChange={(v) => setDeadline(v === 'none' ? null : Number(v))}
              />
            </ExpandRow>
          </div>
        </section>

        <section className="stack">
          <h2 className="section-title">Где</h2>
          <Segmented label="Как выбираем место" options={PLACE_MODES} value={mode} onChange={setMode} />
          <span className="note" style={{ padding: '0 4px' }}>
            {PLACE_HINTS[mode]}
          </span>
          {needsPlace && <PlacePicker id="meet" value={place} onChange={setPlace} format={format} />}
          <div className="group">
            <ExpandRow
              label="Бюджет"
              value={budget === 'any' ? 'Любой' : `${BUDGET_LABELS[budget]} сум`}
              open={open === 'budget'}
              onToggle={() => toggle('budget')}
            >
              <ChoiceChips label="Бюджет на человека" options={opts(BUDGET_LABELS)} value={budget} onChange={setBudget} />
              <span className="note">На человека. Подборка мест учтёт бюджет.</span>
            </ExpandRow>
          </div>
        </section>
      </main>

      <ActionBar
        note={blocker}
        main={{ label: chatId ? 'Создать и отправить в группу' : 'Создать и отправить', onClick: submit, disabled: !!blocker, busy }}
      />
    </div>
  );
}
