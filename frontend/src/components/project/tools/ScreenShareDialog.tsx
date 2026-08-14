import { useEffect, useState } from 'react';
import { ClipboardCopy, ExternalLink, MonitorPlay, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../api/client';
import type { StageScreenShareInfo } from '../../../types';
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
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `/api/projects/:id/stage-rundowns` */
  base: string;
  rundownId: string;
}

/** 现场大屏公开链接管理（免登录只读投屏；无输入框，用 Dialog 而非 FormOverlay） */
export default function ScreenShareDialog({ open, onOpenChange, base, rundownId }: Props) {
  const [share, setShare] = useState<StageScreenShareInfo | null>(null);
  const [regenConfirm, setRegenConfirm] = useState(false);

  useEffect(() => {
    if (!open) return;
    setShare(null);
    api<{ share: StageScreenShareInfo }>(`${base}/${rundownId}/screen-share`)
      .then((r) => setShare(r.share))
      .catch((e) => toast.error((e as Error).message));
  }, [open, base, rundownId]);

  const put = async (body: { enabled?: boolean; regenerate?: boolean }, okText: string) => {
    try {
      const res = await api<{ share: StageScreenShareInfo }>(`${base}/${rundownId}/screen-share`, {
        method: 'PUT',
        body,
      });
      setShare(res.share);
      toast.success(okText);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const link = share ? `${location.origin}/screen/${share.token}` : '';

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('链接已复制');
    } catch {
      toast.error('复制失败，请手动复制');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MonitorPlay className="size-5" /> 现场大屏
          </DialogTitle>
          <DialogDescription>
            开启后任何人无需登录即可查看大屏：当前节目、接下来安排与紧急公告（联系方式、备注与附件不公开），每 10 秒自动刷新。
          </DialogDescription>
        </DialogHeader>
        {share === null ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">公开大屏链接</p>
              <Switch
                checked={share.enabled}
                onCheckedChange={(enabled) =>
                  void put({ enabled }, enabled ? '现场大屏已开启' : '现场大屏已关闭')
                }
                aria-label="开关现场大屏"
              />
            </div>
            {share.enabled && (
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{link}</code>
                <Button type="button" variant="outline" size="sm" onClick={() => void copyLink()}>
                  <ClipboardCopy className="size-4" /> 复制链接
                </Button>
                <Button type="button" variant="outline" size="sm" asChild>
                  <a href={link} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" /> 打开大屏
                  </a>
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setRegenConfirm(true)}>
                  <RotateCcw className="size-4" /> 重置链接
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>

      <AlertDialog open={regenConfirm} onOpenChange={setRegenConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重置大屏链接</AlertDialogTitle>
            <AlertDialogDescription>重置后旧链接立即失效，需要重新分发新链接。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void put({ regenerate: true }, '链接已重置，旧链接已失效')}>
              重置链接
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
