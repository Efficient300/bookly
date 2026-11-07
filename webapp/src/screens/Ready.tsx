import { useEffect, useState } from 'react';
import { daysRangeLabel, deadlineLabel } from '../../../shared/format.ts';
import { api, planLink } from '../api.ts';
import { IconCopy } from '../components/icons.tsx';
import { PlanCover } from '../components/PlanCover.tsx';
import { ActionBar, ErrorBox, Spinner, useToast } from '../components/ui.tsx';
import { useNav, usePlan } from '../nav.tsx';
import { shareToChat } from '../telegram.ts';

/** Шаг между созданием и отправкой: превью карточки, ссылка и выбор чата. */
export function Ready({ id, posted }: { id: string; posted: boolean }) {
  const nav = useNav();
  const toast = useToast();
  const { plan, error, reload } = usePlan(id);
  const [bot, setBot] = useState<string | null>(null);

  useEffect(() => {
    api.me().then((m) => setBot(m.bot)).catch(() => {});
  }, []);

  if (error && !plan) return <ErrorBox message={error} onRetry={reload} />;
  if (!plan) return <Spinner />;

  const open = () => nav.reset([{ name: 'home' }, { name: 'plan', id }]);
  const placeLine = plan.votePlace ? 'Голосуем за место' : plan.middle ? 'Место посередине' : (plan.places[0]?.name ?? 'Место выбрано');

  async function copy() {
    const link = planLink(id, bot);
    try {
      await navigator.clipboard.writeText(link);
      toast('Ссылка скопирована');
    } catch {
      toast(link);
    }
  }

  function share() {
    if (!shareToChat(id)) void copy();
  }

  return (
    <div className="screen">
      <main className="content">
        <div className="stack" style={{ gap: 8 }}>
          <h1 className="h1">{posted ? 'Сходка в группе' : 'Сходка готова'}</h1>
          <p className="note" style={{ margin: 0 }}>
            {posted
              ? 'Бот уже отправил карточку в группу. Как только кто-то ответит, бот напишет вам.'
              : 'Выберите чат с друзьями. Как только кто-то ответит, бот напишет вам.'}
          </p>
        </div>

        <PlanCover
          format={plan.format}
          action={plan.deadline ? <span className="cover-sub">Ответить до {deadlineLabel(plan.deadline)}</span> : null}
        >
          <span className="cover-title" style={{ fontSize: 28 }}>
            {plan.title}
          </span>
          <span className="cover-sub">
            {daysRangeLabel(plan.days)} · {plan.times.join(', ')}
          </span>
          <span className="cover-sub">{placeLine}</span>
        </PlanCover>
        <span className="note" style={{ padding: '0 4px', marginTop: -12 }}>
          Так сходка выглядит у друзей.
        </span>

        <div className="group">
          <button type="button" className="row" onClick={copy}>
            <span className="row-icon">
              <IconCopy size={20} />
            </span>
            <span className="lbl">
              <span>Скопировать ссылку</span>
              <span className="sub">Если чат не в Telegram</span>
            </span>
          </button>
          <button type="button" className="row" onClick={open}>
            <span className="lbl">
              <span>Открыть сходку</span>
            </span>
          </button>
        </div>
      </main>

      <ActionBar main={posted ? { label: 'Готово', onClick: open } : { label: 'Выбрать чат', onClick: share }} />
    </div>
  );
}
