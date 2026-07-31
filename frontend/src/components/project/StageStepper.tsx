import { Check, ChevronRight } from 'lucide-react';
import type { StageItem } from '../../types';

export function StageStepper({ stages }: { stages: StageItem[] }) {
  if (!stages.length) return null;
  const sorted = [...stages].sort((a, b) => a.order - b.order);
  const completed = sorted.filter((s) => s.completedAt).length;
  const current = sorted.find((s) => !s.completedAt);
  const pct = sorted.length > 0 ? Math.round((completed / sorted.length) * 100) : 0;

  return (
    <>
      {/* Desktop stepper */}
      <div className="hidden items-center gap-1 text-xs md:flex">
        {sorted.map((s, i) => (
          <span key={s.id} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3 text-muted-foreground" />}
            <span
              className={
                s.completedAt
                  ? 'text-muted-foreground line-through'
                  : s.id === current?.id
                    ? 'font-medium text-primary'
                    : 'text-muted-foreground'
              }
            >
              {s.completedAt && <Check className="mr-0.5 inline size-3" />}
              {s.name}
            </span>
          </span>
        ))}
      </div>
      {/* Mobile compact */}
      <div className="space-y-1 md:hidden">
        <p className="text-xs text-muted-foreground">
          阶段 {completed + (current ? 1 : 0)}/{sorted.length} · {current?.name ?? '全部完成'}
        </p>
        <div className="h-1.5 w-full rounded-full bg-muted">
          <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </>
  );
}
