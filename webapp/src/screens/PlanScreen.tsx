import { ErrorBox, Spinner } from '../components/ui.tsx';
import { usePlan } from '../nav.tsx';
import { After } from './After.tsx';
import { Answer } from './Answer.tsx';
import { Confirmed } from './Confirmed.tsx';

/** Один адрес для сходки: экран зависит от её стадии. */
export function PlanScreen({ id }: { id: string }) {
  const { plan, setPlan, error, reload } = usePlan(id);
  if (error && !plan) return <ErrorBox message={error} onRetry={reload} />;
  if (!plan) return <Spinner />;
  if (plan.status === 'collecting') return <Answer plan={plan} setPlan={setPlan} />;
  if (plan.status === 'confirmed') return <Confirmed plan={plan} setPlan={setPlan} />;
  return <After plan={plan} setPlan={setPlan} />;
}
