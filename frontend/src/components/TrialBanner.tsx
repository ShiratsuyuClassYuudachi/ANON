import { useAuth } from '../auth';
import { Badge } from '@/components/ui/badge';
import { fmtLocal } from '../lib/datetime';

/** 试用环境横幅：明显标注「试用」与数据自动清理时间 */
export default function TrialBanner() {
  const { trialExpiresAt } = useAuth();
  if (!trialExpiresAt) return null;
  return (
    <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2">
      <Badge variant="secondary" className="bg-warning/20 text-warning-soft-foreground">试用</Badge>
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-warning-soft-foreground">
        当前为独立试用环境，全部数据将于 {fmtLocal(trialExpiresAt, true)} 自动清理
      </p>
    </div>
  );
}
