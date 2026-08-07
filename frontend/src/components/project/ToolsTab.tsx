import { useState } from 'react';
import { ArrowLeft, CalendarClock } from 'lucide-react';
import type { ProjectDetail } from '../../types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import StageRundownTool from './tools/StageRundownTool';

interface Props {
  project: ProjectDetail;
  myPermissions: string[];
}

/** 实用工具容器：工具卡片列表 → 具体工具。只渲染真实存在的工具。 */
export default function ToolsTab({ project, myPermissions }: Props) {
  const [tool, setTool] = useState<'stage-rundown' | null>(null);

  if (tool === 'stage-rundown') {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setTool(null)}>
          <ArrowLeft className="size-4" /> 全部工具
        </Button>
        <StageRundownTool project={project} myPermissions={myPermissions} />
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Card
        role="button"
        tabIndex={0}
        className="cursor-pointer transition-colors hover:border-primary/50"
        onClick={() => setTool('stage-rundown')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setTool('stage-rundown');
        }}
      >
        <CardContent className="flex items-start gap-3 p-4">
          <CalendarClock className="mt-0.5 size-6 shrink-0 text-primary" />
          <div className="space-y-1">
            <p className="font-medium">舞台时间编排助手</p>
            <p className="text-sm text-muted-foreground">
              录入节目与时长，自动推算每个节目的起止时间；拖动排序，一键导出图片/文本 rundown
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
