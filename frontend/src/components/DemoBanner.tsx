import { FlaskConical, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** 演示环境横幅：标注数据为示例 + 一键还原种子数据（版式复制 TrialBanner） */
export default function DemoBanner() {
  const [resetting, setResetting] = useState(false);
  if (import.meta.env.VITE_DEMO !== 'true') return null;
  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2">
      <FlaskConical className="size-4 shrink-0 text-warning" />
      <Badge variant="secondary" className="bg-warning/20 text-warning">演示</Badge>
      <p className="flex-1 text-sm text-foreground">演示环境 · 数据为示例，修改保留于本会话</p>
      <Button
        size="sm"
        variant="outline"
        disabled={resetting}
        onClick={async () => {
          if (import.meta.env.VITE_DEMO !== 'true' || resetting) return;
          setResetting(true);
          try {
            const { resetDemo } = await import('../demo/install');
            await resetDemo();
            location.reload();
          } catch {
            toast.error('演示文件清理失败，请重试还原示例数据');
            setResetting(false);
          }
        }}
      >
        <RotateCcw className="size-3.5" /> {resetting ? '正在还原…' : '还原示例数据'}
      </Button>
    </div>
  );
}
