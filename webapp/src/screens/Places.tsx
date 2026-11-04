import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { avgCheckLabel } from '../../../shared/format.ts';
import type { LatLng, NewPlace, PlaceView, PlanView } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { IconHeart, IconPlus, IconStar } from '../components/icons.tsx';
import { MapView } from '../components/MapView.tsx';
import type { Person } from '../components/MapView.tsx';
import { PlacePicker, emptyPlace } from '../components/PlacePicker.tsx';
import { BottomBar, ErrorBox, MainButton, Spinner, useToast } from '../components/ui.tsx';
import { useNav, usePlan } from '../nav.tsx';
import { expandApp, haptic, openLink } from '../telegram.ts';

function people(plan: PlanView): Person[] {
  const list: Person[] = plan.areas.map((a) => ({ ...a }));
  const photo = plan.members.find((m) => m.id === plan.me.id)?.photo ?? null;
  if (plan.me.area) list.push({ ...plan.me.area, name: 'Я', photo, me: true });
  return list;
}

export function Places({ id }: { id: string }) {
  const nav = useNav();
  const toast = useToast();
  const { plan, setPlan, error, reload } = usePlan(id);
  useEffect(expandApp, []);
  const [focus, setFocus] = useState<LatLng | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<NewPlace>(emptyPlace);

  const mapPeople = useMemo(() => (plan ? people(plan) : []), [plan]);

  if (error && !plan) return <ErrorBox message={error} onRetry={reload} />;
  if (!plan) return <Spinner />;

  async function toggleVote(place: PlaceView) {
    if (!plan) return;
    haptic.select();
    // Оптимистично: сразу показываем голос, потом синхронизируем с сервером.
    setPlan({
      ...plan,
      places: plan.places.map((p) =>
        p.id === place.id ? { ...p, liked: !p.liked, votes: p.votes + (p.liked ? -1 : 1) } : p,
      ),
    });
    try {
      setPlan(await api.vote(id, place.id, !place.liked));
    } catch (e) {
      toast((e as Error).message);
      void reload();
    }
  }

  async function suggest(e: FormEvent) {
    e.preventDefault();
    try {
      setPlan(await api.suggest(id, { ...draft, name: draft.name.trim() }));
      setAdding(false);
      setDraft(emptyPlace());
      toast('Место добавлено');
    } catch (err) {
      toast((err as Error).message);
    }
  }

  const voters = plan.members.filter((m) => m.status !== null && m.status !== 'no').length;
  const firstPoint = plan.places.find((p) => p.lat !== null && p.lng !== null);
  const near = plan.center ?? plan.me.area ?? (firstPoint ? { lat: firstPoint.lat as number, lng: firstPoint.lng as number } : null);

  return (
    <div className="screen">
      <MapView places={plan.places} people={mapPeople} center={plan.middle ? plan.center : null} focus={focus} />

      <section className="sheet">
        <div className="handle" aria-hidden="true" />
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', padding: '14px 4px 4px' }}>
          <h1 className="h1" style={{ fontSize: 22 }}>
            Где встретимся
          </h1>
          {plan.votePlace && <span className="caption">Участников: {voters}</span>}
        </div>
        <div className="caption" style={{ padding: '0 4px 8px' }}>
          {plan.votePlace
            ? 'Отметьте все места, которые вам нравятся'
            : plan.placeId
              ? 'Место выбрал организатор'
              : 'Место выберет организатор'}
        </div>

        <div>
          {plan.places.map((p, i) => (
            <div key={p.id} className="place-row">
              <span className="place-num" aria-hidden="true">
                {i + 1}
              </span>
              <button
                type="button"
                className="grow"
                style={{ border: 'none', background: 'none', padding: 0, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 3 }}
                onClick={() => {
                  if (p.lat !== null && p.lng !== null) setFocus({ lat: p.lat, lng: p.lng });
                  else if (p.url) openLink(p.url);
                }}
              >
                <span style={{ fontSize: 16, fontWeight: 600 }}>{p.name}</span>
                <span className="row caption" style={{ gap: 4 }}>
                  {[p.kind, avgCheckLabel(p.avgCheck)].filter(Boolean).join(' · ')}
                  {p.rating !== null && (
                    <>
                      {' · '}
                      <IconStar size={13} style={{ color: 'var(--amber)' }} />
                      {p.rating.toFixed(1).replace('.', ',')}
                    </>
                  )}
                </span>
                {p.travel && <span className="caption">{p.travel}</span>}
                {p.custom && p.url && <span className="caption" style={{ color: 'var(--accent)' }}>Открыть ссылку</span>}
                {p.promo && (
                  <span className="row" style={{ gap: 6, paddingTop: 2 }}>
                    <span className="pill amber">{p.promo}</span>
                    {p.partner && <span className="muted" style={{ fontSize: 11 }}>Партнёр</span>}
                  </span>
                )}
              </button>
              {plan.votePlace && (
                <button
                  type="button"
                  className="vote"
                  aria-pressed={p.liked}
                  aria-label={`${p.liked ? 'Убрать голос' : 'Голосовать'}: ${p.name}`}
                  onClick={() => toggleVote(p)}
                >
                  <IconHeart size={20} fill={p.liked ? 'currentColor' : 'none'} />
                  {p.votes}
                </button>
              )}
            </div>
          ))}
        </div>

        {plan.votePlace &&
          (adding ? (
            <form className="card" style={{ padding: '12px 0 16px' }} onSubmit={suggest}>
              <h2 className="h2" style={{ fontSize: 18 }}>
                Своё место
              </h2>
              <PlacePicker id="suggest" value={draft} onChange={setDraft} format={plan.format} near={near} />
              <div className="row">
                <button type="submit" className="btn-small" disabled={!draft.name.trim() || draft.lat === null}>
                  Добавить
                </button>
                <button type="button" className="btn-small outline" onClick={() => setAdding(false)}>
                  Отмена
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="btn-text" onClick={() => setAdding(true)}>
              <IconPlus size={18} strokeWidth={2.5} />
              Предложить своё место
            </button>
          ))}
      </section>

      <BottomBar>
        <MainButton onClick={() => nav.pop()}>Готово</MainButton>
      </BottomBar>
    </div>
  );
}
