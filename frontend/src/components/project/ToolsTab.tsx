import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft, CalendarClock, ClipboardCheck, ExternalLink, MoreHorizontal, PackageSearch, Pencil, Plus, Puzzle, Trash2,
} from 'lucide-react';
import { api } from '../../api/client';
import { fetchLaunchToken, registerLaunchTarget, canDeliverViaOpener, appendLaunchTokenToUrl } from '../../lib/toolLaunch';
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
  /** standalone PWA 下 link+passToken 的 fragment 兜底确认（无 opener 握手通道） */
  const [pendingLink, setPendingLink] = useState<{ tool: CustomTool; launchToken: string } | null>(null);

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
   *
   * 移动端两点适配：
   * - link + passToken 在点击手势内同步直开干净 URL（await 令牌后再 window.open 会丢 transient
   *   activation，iOS 全系浏览器必拦弹窗；about:blank 占位再 location.replace 跨域导航会换进程、
   *   断 WindowProxy 同一性导致握手 source 校验失败，故只能直开）。插件可能先于令牌就绪加载完，
   *   其首发 anon:launch-request 由 registerLaunchTarget 的早到请求队列暂存重放。
   *   取令牌失败则关掉已打开的工具页（失败 toast 已在 fetchLaunchToken 内发出）。
   * - standalone PWA（canDeliverViaOpener() === false）下 window.open 跨域被甩给系统浏览器，
   *   opener 必断、握手无解 → 弹确认框改走 fragment 兜底（appendLaunchTokenToUrl）。
   */
  const openTool = async (tool: CustomTool) => {
    if (tool.mode !== 'link') {
      const launchToken = tool.passToken ? await fetchLaunchToken(project.id, tool.id) : null;
      if (tool.passToken && !launchToken) return; // 失败已 toast
      setCustom({ tool, launchToken });
      return;
    }
    if (!tool.passToken) {
      window.open(tool.url, '_blank', 'noreferrer'); // 无令牌，同步直开
      return;
    }
    if (!canDeliverViaOpener()) {
      const launchToken = await fetchLaunchToken(project.id, tool.id);
      if (!launchToken) return; // 失败已 toast
      setPendingLink({ tool, launchToken });
      return;
    }
    const w = window.open(tool.url, '_blank');
    if (!w) {
      toast.error('浏览器拦截了弹出窗口，请允许弹窗后重试');
      return;
    }
    const launchToken = await fetchLaunchToken(project.id, tool.id);
    if (!launchToken || w.closed) {
      if (!w.closed) w.close();
      return;
    }
    registerLaunchTarget(w, tool.url, launchToken);
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
          <ArrowLeft className="size-4" /> 返回全部工具
        </Button>
        <StageRundownTool project={project} myPermissions={myPermissions} />
      </div>
    );
  }

  if (builtin === 'lost-found') {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setBuiltin(null)}>
          <ArrowLeft className="size-4" /> 返回全部工具
        </Button>
        <LostFoundTool project={project} myPermissions={myPermissions} />
      </div>
    );
  }

  if (builtin === 'stage-signup') {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setBuiltin(null)}>
          <ArrowLeft className="size-4" /> 返回全部工具
        </Button>
        <StageSignupTool project={project} myPermissions={myPermissions} />
      </div>
    );
  }

  if (custom) {
    return <CustomToolEmbed tool={custom.tool} launchToken={custom.launchToken} onBack={() => setCustom(null)} />;
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="editorial-heading">工具</h1>
        <p className="text-sm text-muted-foreground">面向舞台演出、现场服务与外部扩展的专项协作工具</p>
      </header>
      <div className="grid gap-3 lg:grid-cols-2">
      <Card
        role="button"
        tabIndex={0}
        className="editorial-card cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:hover:-translate-y-0.5"
        onClick={() => setBuiltin('stage-rundown')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setBuiltin('stage-rundown');
          }
        }}
      >
        <CardContent className="flex items-start gap-3 p-4">
          <CalendarClock className="mt-0.5 size-6 shrink-0 text-primary" />
          <div className="space-y-1">
            <p className="font-medium">舞台时间编排</p>
            <p className="text-sm text-muted-foreground">
              编排节目单与预计时长，自动推算起止时刻；支持现场控台推进、顺延重算与免登录投屏大屏。
            </p>
          </div>
        </CardContent>
      </Card>
      <Card
        role="button"
        tabIndex={0}
        className="editorial-card cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:hover:-translate-y-0.5"
        onClick={() => setBuiltin('stage-signup')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setBuiltin('stage-signup');
          }
        }}
      >
        <CardContent className="flex items-start gap-3 p-4">
          <ClipboardCheck className="mt-0.5 size-6 shrink-0 text-primary" />
          <div className="space-y-1">
            <p className="font-medium">舞台报名审核</p>
            <p className="text-sm text-muted-foreground">
              收集待审节目批次，排查撞名与总时长，团队内部投票拍板后一键导入时间编排。
            </p>
          </div>
        </CardContent>
      </Card>
      <Card
        role="button"
        tabIndex={0}
        className="editorial-card cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:hover:-translate-y-0.5"
        onClick={() => setBuiltin('lost-found')}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setBuiltin('lost-found');
          }
        }}
      >
        <CardContent className="flex items-start gap-3 p-4">
          <PackageSearch className="mt-0.5 size-6 shrink-0 text-primary" />
          <div className="space-y-1">
            <p className="font-medium">失物招领</p>
            <p className="text-sm text-muted-foreground">
              拍照登记现场拾获物品并跟踪认领状态，支持开启免登录公开查找页供观众自助核对。
            </p>
          </div>
        </CardContent>
      </Card>

      {tools.map((t) => (
        <Card
          key={t.id}
          role="button"
          tabIndex={0}
          className="editorial-card cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:hover:-translate-y-0.5"
          onClick={() => openTool(t)}
          onKeyDown={(e) => {
            if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              void openTool(t);
            }
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
          className="editorial-card cursor-pointer border-dashed outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setEditing('new')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setEditing('new');
          }
          }}
        >
          <CardContent className="flex items-start gap-3 p-4">
            <Plus className="mt-0.5 size-6 shrink-0 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium">添加自定义工具</p>
              <p className="text-sm text-muted-foreground">通过页内嵌入或新窗口接入外部网页组件，支持按权限安全传递成员身份。</p>
            </div>
          </CardContent>
        </Card>
      )}

      </div>

      <AlertDialog open={!!pendingLink} onOpenChange={(o) => !o && setPendingLink(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              在外部浏览器打开{pendingLink ? `「${pendingLink.tool.name}」` : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>
              当前处于主屏幕独立应用模式，本次将在链接末尾片段中一次性附带 5 分钟启动令牌（不经过服务器日志，组件读取后立即清除）。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                // 手势内同步打开（令牌已就位，无 await）；fragment 仅随本次打开携带
                if (pendingLink) {
                  window.open(appendLaunchTokenToUrl(pendingLink.tool.url, pendingLink.launchToken), '_blank');
                }
                setPendingLink(null);
              }}
            >
              确认打开
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除自定义工具「{deleting?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后该工具已签发的所有访问密钥将立即失效，不可恢复。
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
