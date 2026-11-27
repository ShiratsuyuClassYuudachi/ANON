import { Check, ChevronRight } from 'lucide-react';
import type { StageItem } from '../../types';

export function StageStepper({ stages }: { stages: StageItem[] }) {
  const sorted = [...stages].sort((a, b) => a.order - b.order);
  const current = sorted.find((stage) => !stage.completedAt);

  return (
    <ol aria-label="筹备阶段" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {sorted.map((stage, index) => (
        <li key={stage.id} aria-current={stage.id === current?.id ? 'step' : undefined} className="flex min-w-0 items-center gap-1.5">
          {index > 0 && <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />}
          {stage.completedAt && <><Check aria-hidden="true" className="size-3 shrink-0 text-success" /><span className="sr-only">已完成：</span></>}
          <span className={stage.id === current?.id ? 'wrap-anywhere font-semibold text-primary' : 'wrap-anywhere text-muted-foreground'}>{stage.name}</span>
        </li>
      ))}
    </ol>
  );
}
