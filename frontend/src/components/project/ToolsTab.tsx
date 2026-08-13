import { useState } from 'react';
import { ArrowLeft, CalendarClock, ClipboardCheck, PackageSearch } from 'lucide-react';
import type { ProjectDetail } from '../../types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import StageRundownTool from './tools/StageRundownTool';
import StageSignupTool from './tools/StageSignupTool';
import LostFoundTool from './tools/LostFoundTool';

interface Props {
  project: ProjectDetail;
  myPermissions: string[];
}

/** 实用工具容器：工具卡片列表 → 具体工具。只渲染真实存在的工具。 */
export default function ToolsTab({ project, myPermissions }: Props) {
  const [tool, setTool] = useState<'stage-rundown' | 'stage-signup' | 'lost-found' | null>(null);

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

  if (tool === 'lost-found') {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setTool(null)}>
          <ArrowLeft className="size-4" /> 全部工具
        </Button>
        <LostFoundTool project={project} myPermissions={myPermissions} />
      </div>
    );
  }

  if (tool === 'stage-signup') {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setTool(null)}>
          <ArrowLeft className="size-4" /> 全部工具
        </Button>
        <StageSignupTool project={project} myPermissions={myPermissions} />
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
      <Card
        role="button"
        tabIndex={0}
        className="cursor-pointer transition-colors hover:border-primary/50"
        onClick={() => setTool('stage-signup')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setTool('stage-signup');
        }}
      >
        <CardContent className="flex items-start gap-3 p-4">
          <ClipboardCheck className="mt-0.5 size-6 shrink-0 text-primary" />
          <div className="space-y-1">
            <p className="font-medium">舞台报名审核</p>
            <p className="text-sm text-muted-foreground">
              录入报名节目与时长，按名称排序排查撞名，勾选预览总时长，投票与拍板审核，通过后可导入 Rundown
            </p>
          </div>
        </CardContent>
      </Card>
      <Card
        role="button"
        tabIndex={0}
        className="cursor-pointer transition-colors hover:border-primary/50"
        onClick={() => setTool('lost-found')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setTool('lost-found');
        }}
      >
        <CardContent className="flex items-start gap-3 p-4">
          <PackageSearch className="mt-0.5 size-6 shrink-0 text-primary" />
          <div className="space-y-1">
            <p className="font-medium">失物招领</p>
            <p className="text-sm text-muted-foreground">
              登记捡到的物品与照片，按认领状态跟踪；可生成免登录公开查找页给观众自行查询
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
