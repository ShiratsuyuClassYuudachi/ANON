import { FlaskConical, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** 演示环境横幅：标注数据为示例 + 一键还原种子数据（版式复制 TrialBanner） */
export default function DemoBanner() {
  if (import.meta.env.VITE_DEMO !== 'true') return null;
  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2">
      <FlaskConical className="size-4 shrink-0 text-warning" />
      <Badge variant="secondary" className="bg-warning/20 text-warning">演示</Badge>
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
