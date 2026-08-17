import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft, CalendarClock, ClipboardCheck, ExternalLink, MoreHorizontal, PackageSearch, Pencil, Plus, Puzzle, Trash2,
} from 'lucide-react';
import { api } from '../../api/client';
import { fetchLaunchToken, registerLaunchTarget } from '../../lib/toolLaunch';
import type { CustomTool, ProjectDetail } from '../../types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import CustomToolDialog from './tools/CustomToolDialog';
import CustomToolEmbed from './tools/CustomToolEmbed';
import StageRundownTool from './tools/StageRundownTool';
import StageSignupTool from './tools/StageSignupTool';
import LostFoundTool from './tools/LostFoundTool';

interface Props {
  project: ProjectDetail;
  myPermissions: string[];
}

/** 实用工具容器：内置工具卡片 + 项目自定义工具卡片 → 具体工具。 */
export default function ToolsTab({ project, myPermissions }: Props) {
  const [builtin, setBuiltin] = useState<'stage-rundown' | 'stage-signup' | 'lost-found' | null>(null);
  const [custom, setCustom] = useState<{ tool: CustomTool; launchToken: string | null } | null>(null);
  const [tools, setTools] = useState<CustomTool[]>([]);
  const [editing, setEditing] = useState<CustomTool | 'new' | null>(null);
  const [deleting, setDeleting] = useState<CustomTool | null>(null);

  const canManage = myPermissions.includes('project:manage') || myPermissions.includes('tools:manage');

  const loadTools = () =>
    api<{ tools: CustomTool[] }>(`/api/projects/${project.id}/custom-tools`)
      .then((r) => setTools(r.tools))
      .catch((e) => toast.error((e as Error).message));

  useEffect(() => {
    loadTools();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  /**
   * 打开自定义工具。passToken 工具先取启动令牌，经 postMessage 握手投递（令牌不进 URL）。
   * link 形态 handshake 需 opener 通道，故 passToken 工具不能带 noreferrer（其实现隐含 noopener）——
   * tabnabbing 面由「工具 URL 本身即管理端登记可信组件」这一既有信任前提覆盖
   * （与 iframe embed 的 allow-same-origin 同级）；非 passToken 工具仍 noreferrer 防 Referer 落第三方日志。
   */
  const openTool = async (tool: CustomTool) => {
    const launchToken = tool.passToken ? await fetchLaunchToken(project.id, tool.id) : null;
    if (tool.passToken && !launchToken) return; // 失败已 toast
    if (tool.mode === 'link') {
      const w = window.open(tool.url, '_blank', launchToken ? undefined : 'noreferrer');
      if (!w) {
        toast.error('浏览器拦截了弹出窗口，请允许弹窗后重试');
        return;
      }
      if (launchToken) registerLaunchTarget(w, tool.url, launchToken);
    } else {
      setCustom({ tool, launchToken });
    }
  };

  const toolHost = (tool: CustomTool) => {
    try {
      return new URL(tool.url).host;
    } catch {
      return tool.url;
    }
  };

  if (builtin === 'stage-rundown') {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setBuiltin(null)}>
          <ArrowLeft className="size-4" /> 全部工具
        </Button>
        <StageRundownTool project={project} myPermissions={myPermissions} />
      </div>
    );
  }

  if (builtin === 'lost-found') {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setBuiltin(null)}>
          <ArrowLeft className="size-4" /> 全部工具
        </Button>
        <LostFoundTool project={project} myPermissions={myPermissions} />
      </div>
    );
  }

  if (builtin === 'stage-signup') {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setBuiltin(null)}>
          <ArrowLeft className="size-4" /> 全部工具
        </Button>
        <StageSignupTool project={project} myPermissions={myPermissions} />
      </div>
    );
  }

  if (custom) {
    return <CustomToolEmbed tool={custom.tool} launchToken={custom.launchToken} onBack={() => setCustom(null)} />;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Card
        role="button"
        tabIndex={0}
        className="cursor-pointer transition-colors hover:border-primary/50"
        onClick={() => setBuiltin('stage-rundown')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setBuiltin('stage-rundown');
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
        onClick={() => setBuiltin('stage-signup')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setBuiltin('stage-signup');
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
        onClick={() => setBuiltin('lost-found')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setBuiltin('lost-found');
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

      {tools.map((t) => (
        <Card
          key={t.id}
          role="button"
          tabIndex={0}
          className="cursor-pointer transition-colors hover:border-primary/50"
          onClick={() => openTool(t)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') openTool(t);
          }}
        >
          <CardContent className="flex items-start gap-3 p-4">
            {t.mode === 'link' ? (
              <ExternalLink className="mt-0.5 size-6 shrink-0 text-primary" />
            ) : (
              <Puzzle className="mt-0.5 size-6 shrink-0 text-primary" />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-medium">{t.name}</p>
              <p className="text-sm text-muted-foreground">{t.description || toolHost(t)}</p>
            </div>
            {canManage && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`工具操作 ${t.name}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(t);
                    }}
                  >
                    <Pencil className="size-4" /> 编辑
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleting(t);
                    }}
                  >
                    <Trash2 className="size-4" /> 删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </CardContent>
        </Card>
      ))}

      {canManage && (
        <Card
          role="button"
          tabIndex={0}
          className="cursor-pointer border-dashed transition-colors hover:border-primary/50"
          onClick={() => setEditing('new')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setEditing('new');
          }}
        >
          <CardContent className="flex items-start gap-3 p-4">
            <Plus className="mt-0.5 size-6 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium">添加自定义工具</p>
              <p className="text-sm text-muted-foreground">接入自研组件：页内 iframe 嵌入或新标签页打开</p>
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除自定义工具</AlertDialogTitle>
            <AlertDialogDescription>
              删除后该工具签发的所有 API 密钥将一并失效，且不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleting) return;
                api(`/api/projects/${project.id}/custom-tools/${deleting.id}`, { method: 'DELETE' })
                  .then(() => loadTools())
                  .catch((e) => toast.error((e as Error).message));
                setDeleting(null);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CustomToolDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        projectId={project.id}
        tool={editing === 'new' ? null : editing}
        onSaved={() => {
          setEditing(null);
          loadTools();
        }}
      />
    </div>
  );
}
