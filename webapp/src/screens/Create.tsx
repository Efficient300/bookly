import { useState } from 'react';
import { BUDGET_LABELS, DURATION_LABELS, FORMAT_LABELS, daysRangeLabel } from '../../../shared/format.ts';
import type { Budget, Duration, Format, NewPlace, NewPlan } from '../../../shared/types.ts';
import { api, enableReminders } from '../api.ts';
import { PlanCover } from '../components/PlanCover.tsx';
import { IconChevron, IconSend } from '../components/icons.tsx';
import { MonthCalendar } from '../components/MonthCalendar.tsx';
import { PlacePicker, emptyPlace, placePoint } from '../components/PlacePicker.tsx';
import { BottomBar, MainButton, Segmented, SelectRow, useToast } from '../components/ui.tsx';
import { weekend } from '../lib/links.ts';
import { FORMAT_THEME } from '../lib/themes.tsx';
import { useNav } from '../nav.tsx';
import { haptic, shareToChat } from '../telegram.ts';

const TIMES = ['09:00', '11:00', '13:00', '15:00', '17:00', '19:00', '21:00'];
/** Столько же разрешает сервер (server/app/plans.py). */
const MAX_DAYS = 14;
const DEADLINES = { '24': '24 часа', '48': '2 дня', none: 'Без срока' } as const;
type Deadline = keyof typeof DEADLINES;

type PlaceMode = 'vote' | 'middle' | 'own';
const PLACE_MODES: { value: PlaceMode; label: string }[] = [
  { value: 'vote', label: 'Голосуем' },
  { value: 'middle', label: 'Посередине' },
  { value: 'own', label: 'Выберу я' },
];
const PLACE_HINTS: Record<PlaceMode, string> = {
  vote: 'Участники отметят понравившиеся места и смогут предложить свои.',
  middle: 'Участники укажут район, а вы выберете место посередине.',
  own: 'Участники сразу увидят, куда идти.',
};

const opts = <T extends string>(labels: Record<T, string>) =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

function modeOf(template?: Partial<NewPlan>): PlaceMode {
  if (!template || template.votePlace) return 'vote';
  return template.middle ? 'middle' : 'own';
}

/** Новая сходка на одном экране: всё заполнено заранее, менять нужно только то, что важно. */
export function Create({ template, chatId }: { template?: Partial<NewPlan>; chatId?: number }) {
  const nav = useNav();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<'days' | 'times' | null>(null);

  const [title, setTitle] = useState(template?.title ?? '');
  const [format, setFormat] = useState<Format>(template?.format ?? 'eat');
  const [budget, setBudget] = useState<Budget>(template?.budget ?? '2');
  const [duration, setDuration] = useState<Duration>(template?.duration ?? '2-3');
  const [days, setDays] = useState<string[]>(template?.days ?? weekend());
  const [times, setTimes] = useState<string[]>(template?.times ?? ['17:00', '19:00', '21:00']);
  const [deadline, setDeadline] = useState<Deadline>('48');
  const [mode, setMode] = useState<PlaceMode>(() => modeOf(template));
  const [place, setPlace] = useState<NewPlace>(template?.place ?? emptyPlace());

  const needsPlace = mode === 'own';
  const placeReady = place.name.trim().length > 0 && placePoint(place) !== null;
  const ready = days.length > 0 && times.length > 0 && (!needsPlace || placeReady);
  const toggleOpen = (section: 'days' | 'times') => setOpen(open === section ? null : section);

  async function submit() {
    setBusy(true);
    try {
      const { id, posted } = await api.create({
        title: title.trim() || FORMAT_LABELS[format],
        format,
        budget,
        duration,
        days,
        times,
        deadlineHours: deadline === 'none' ? null : Number(deadline),
        votePlace: mode === 'vote',
        middle: mode !== 'own',
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
      <main className="content">
        <PlanCover format={format}>
          <label className="sr-only" htmlFor="plan-title">
            Название сходки
          </label>
          <input
            id="plan-title"
            className="cover-input"
            value={title}
            maxLength={80}
            placeholder={FORMAT_LABELS[format]}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="cover-sub">Название можно не менять</div>
        </PlanCover>

        <div className="format-picker" role="group" aria-label="Формат">
          {opts(FORMAT_LABELS).map((o) => {
            const { Icon, from, to } = FORMAT_THEME[o.value];
            return (
              <button
                key={o.value}
                type="button"
                className="format-item"
                aria-pressed={format === o.value}
                onClick={() => {
                  haptic.select();
                  setFormat(o.value);
                }}
              >
                <span className="tile" style={{ background: `linear-gradient(145deg, ${from}, ${to})` }}>
                  <Icon size={24} />
                </span>
                {o.label}
              </button>
            );
          })}
        </div>

        <section className="section">
          <h2 className="h2">Когда</h2>
          <div className="list">
            <button type="button" className="list-row" aria-expanded={open === 'days'} onClick={() => toggleOpen('days')}>
              <span className="grow list-title">Дни</span>
              <span className={days.length ? 'row-value' : 'row-value warn'}>{days.length ? daysRangeLabel(days) : 'Не выбраны'}</span>
              <IconChevron size={16} className="row-chevron" />
            </button>
            {open === 'days' && (
              <div className="list-panel">
                <div className="chips">
                  <button type="button" className="chip sm" onClick={() => setDays(weekend())}>
                    Эти выходные
                  </button>
                  <button type="button" className="chip sm" onClick={() => setDays(weekend(1))}>
                    Следующие
                  </button>
                  <button type="button" className="chip sm" onClick={() => setDays([])}>
                    Очистить
                  </button>
                </div>
                <MonthCalendar value={days} onChange={setDays} max={MAX_DAYS} onLimit={() => toast(`Можно выбрать до ${MAX_DAYS} дней`)} />
              </div>
            )}
            <button type="button" className="list-row" aria-expanded={open === 'times'} onClick={() => toggleOpen('times')}>
              <span className="grow list-title">Время начала</span>
              <span className={times.length ? 'row-value' : 'row-value warn'}>{times.length ? times.join(', ') : 'Не выбрано'}</span>
              <IconChevron size={16} className="row-chevron" />
            </button>
            {open === 'times' && (
              <div className="list-panel">
                <div className="chips">
                  {TIMES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="chip sm"
                      aria-pressed={times.includes(t)}
                      onClick={() => {
                        haptic.select();
                        setTimes(times.includes(t) ? times.filter((x) => x !== t) : [...times, t].sort());
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <SelectRow label="Сколько по времени" options={opts(DURATION_LABELS)} value={duration} onChange={setDuration} />
            <SelectRow label="Ответить до" options={opts(DEADLINES)} value={deadline} onChange={setDeadline} />
          </div>
        </section>

        <section className="section">
          <h2 className="h2">Где</h2>
          <Segmented label="Как выбираем место" options={PLACE_MODES} value={mode} onChange={setMode} />
          <div className="caption section-note">{PLACE_HINTS[mode]}</div>
          {needsPlace && <PlacePicker id="meet" value={place} onChange={setPlace} format={format} />}
          <div className="list">
            <SelectRow label="Бюджет на человека" options={opts(BUDGET_LABELS)} value={budget} onChange={setBudget} suffix={budget === 'any' ? '' : ' сум'} />
          </div>
        </section>
      </main>

      <BottomBar>
        <MainButton onClick={submit} busy={busy} disabled={!ready}>
          <IconSend size={20} />
          {needsPlace && !placeReady ? 'Сначала выберите место' : chatId ? 'Создать и отправить в группу' : 'Создать и отправить в чат'}
        </MainButton>
      </BottomBar>
    </div>
  );
}
