import { FlaskConical, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** 演示环境横幅：标注数据为示例 + 一键还原种子数据（版式复制 TrialBanner） */
export default function DemoBanner() {
  if (import.meta.env.VITE_DEMO !== 'true') return null;
  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
      <FlaskConical className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <Badge variant="secondary" className="bg-amber-500/20 text-amber-700 dark:text-amber-300">演示</Badge>
      <p className="flex-1 text-sm text-foreground">演示环境 · 数据为示例，修改保留于本会话</p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          sessionStorage.removeItem('anon-demo-db');
          location.reload();
        }}
      >
        <RotateCcw className="size-3.5" /> 还原示例数据
      </Button>
    </div>
  );
}
