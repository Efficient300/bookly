import { useState } from 'react';
import { api } from '../api.ts';
import { forgetPlan, useNav } from '../nav.tsx';
import { confirmDialog, haptic } from '../telegram.ts';
import { useToast } from './ui.tsx';

/** Удаление сходки организатором. Карточка в чате станет «отменена», участники получат сообщение. */
export function DeletePlanButton({ id }: { id: string }) {
  const nav = useNav();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!(await confirmDialog('Удалить сходку? Ответы участников пропадут, отменить это нельзя.'))) return;
    setBusy(true);
    try {
      await api.remove(id);
      forgetPlan(id);
      haptic.success();
      toast('Сходка удалена');
      nav.reset([{ name: 'home' }]);
    } catch (e) {
      haptic.error();
      toast((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <button type="button" className="btn-text danger" disabled={busy} onClick={remove}>
      Удалить сходку
    </button>
  );
}
