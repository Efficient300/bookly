import { useState } from 'react';
import { avgCheckLabel, plural } from '../../../shared/format.ts';
import type { NewPlace, PlaceView } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { IconCheck, IconPlus } from '../components/icons.tsx';
import { MapPicker } from '../components/MapPicker.tsx';
import { ActionBar, AvatarStack, ErrorBox, Spinner, useToast } from '../components/ui.tsx';
import { useNav, usePlan } from '../nav.tsx';
import { haptic } from '../telegram.ts';

/** Голосование за место: карточки с адресом, ценой и аватарами проголосовавших. */
export function Places({ id }: { id: string }) {
  const nav = useNav();
  const toast = useToast();
  const { plan, setPlan, error, reload } = usePlan(id);
  const [picking, setPicking] = useState(false);

  if (error && !plan) return <ErrorBox message={error} onRetry={reload} />;
  if (!plan) return <Spinner />;

  const done = () => nav.reset([{ name: 'home' }, { name: 'plan', id }]);

  async function toggleVote(place: PlaceView) {
    if (!plan || !plan.votePlace) return;
    haptic.select();
    // Сразу показываем голос, потом сверяемся с сервером.
    setPlan({
      ...plan,
      places: plan.places.map((p) => (p.id === place.id ? { ...p, liked: !p.liked, votes: p.votes + (p.liked ? -1 : 1) } : p)),
    });
    try {
      setPlan(await api.vote(id, place.id, !place.liked));
    } catch (e) {
      toast((e as Error).message);
      void reload();
    }
  }

  async function suggest(place: NewPlace) {
    setPicking(false);
    try {
      setPlan(await api.suggest(id, place));
      toast('Место добавлено');
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const firstPoint = plan.places.find((p) => p.lat !== null && p.lng !== null);
  const near = plan.center ?? plan.me.area ?? (firstPoint ? { lat: firstPoint.lat as number, lng: firstPoint.lng as number } : null);
  const liked = plan.places.filter((p) => p.liked).length;

  return (
    <div className="screen">
      <main className="content">
        <div className="stack" style={{ gap: 8 }}>
          <span className="note">{plan.title}</span>
          <h1 className="h1">{plan.votePlace ? 'Куда пойдём?' : 'Где встречаемся'}</h1>
          <p className="note" style={{ margin: 0 }}>
            {plan.votePlace
              ? 'Можно выбрать несколько мест или предложить своё.'
              : plan.placeId
                ? 'Место выбрал организатор.'
                : 'Место выберет организатор.'}
          </p>
        </div>

        <div className="stack">
          {plan.places.map((p) => {
            const facts = [p.address ?? p.kind, avgCheckLabel(p.avgCheck)].filter(Boolean).join(' · ');
            return (
              <button
                key={p.id}
                type="button"
                className="place-card"
                aria-pressed={plan.votePlace ? p.liked : undefined}
                disabled={!plan.votePlace}
                onClick={() => toggleVote(p)}
              >
                <span className="grow stack" style={{ gap: 6 }}>
                  <span style={{ fontSize: 17, fontWeight: 500 }} className="ellipsis">
                    {p.name}
                  </span>
                  {facts && <span className="note ellipsis">{facts}</span>}
                  {plan.votePlace && (
                    <span className="row-flex" style={{ gap: 8 }}>
                      {p.voters.length > 0 && <AvatarStack people={p.voters} size={24} />}
                      <span className="note">
                        {p.votes ? `${p.votes} ${plural(p.votes, ['голос', 'голоса', 'голосов'])}` : 'Пока без голосов'}
                      </span>
                    </span>
                  )}
                  {p.travel && <span className="note">{p.travel}</span>}
                </span>
                {plan.votePlace && (
                  <span className="check" aria-hidden="true">
                    <IconCheck size={16} strokeWidth={2} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {plan.votePlace && (
          <button type="button" className="chip add" style={{ alignSelf: 'flex-start', height: 44, display: 'inline-flex', alignItems: 'center', gap: 8 }} onClick={() => setPicking(true)}>
            <IconPlus size={18} />
            Предложить своё место
          </button>
        )}
      </main>

      {picking && (
        <MapPicker
          format={plan.format}
          near={near}
          initial={null}
          onClose={() => setPicking(false)}
          onSelect={(p) => void suggest({ name: p.name.slice(0, 60), url: null, lat: p.lat, lng: p.lng })}
        />
      )}

      <ActionBar
        main={{
          label: plan.votePlace ? (liked ? `Отправить ответ · ${liked} ${plural(liked, ['место', 'места', 'мест'])}` : 'Отправить ответ') : 'Готово',
          onClick: () => {
            if (plan.middle && !plan.me.area) nav.push({ name: 'area', id });
            else {
              toast('Ответ отправлен');
              done();
            }
          },
        }}
      />
    </div>
  );
}
