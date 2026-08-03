import { Timer } from 'lucide-react';
import { useAuth } from '../auth';
import { Badge } from '@/components/ui/badge';
import { fmtLocal } from '../lib/datetime';

/** 试用环境横幅：明显标注「试用」与数据自动销毁时间 */
export default function TrialBanner() {
  const { trialExpiresAt } = useAuth();
  if (!trialExpiresAt) return null;
  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
      <Timer className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <Badge variant="secondary" className="bg-amber-500/20 text-amber-700 dark:text-amber-300">试用</Badge>
      <p className="flex-1 text-sm text-foreground">
        当前为试用环境，全部数据将于 {fmtLocal(trialExpiresAt, true)} 自动销毁
      </p>
    </div>
  );
}
