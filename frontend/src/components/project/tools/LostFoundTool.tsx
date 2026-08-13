import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, ClipboardCopy, Link2, MoreHorizontal, PackageSearch, Plus, RotateCcw, Search, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../api/client';
import { fmtLocal } from '../../../lib/datetime';
import type { LostFoundItem, LostFoundShareInfo, ProjectDetail } from '../../../types';
import AuthImg from '../../AuthImg';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import LostFoundClaimDialog from './LostFoundClaimDialog';
import LostFoundItemDialog from './LostFoundItemDialog';

interface Props {
  project: ProjectDetail;
  myPermissions: string[];
}

type StatusFilter = '' | 'pending' | 'claimed';

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'pending', label: '待认领' },
  { key: 'claimed', label: '已认领' },
];

/** 失物招领：登记/认领跟踪 + 免登录公开查找页管理 */
export default function LostFoundTool({ project, myPermissions }: Props) {
  const canManage = myPermissions.includes('project:manage') || myPermissions.includes('lostfound:manage');
  const base = `/api/projects/${project.id}/lostfound`;

  const [items, setItems] = useState<LostFoundItem[] | null>(null);
  const [q, setQ] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [editTarget, setEditTarget] = useState<LostFoundItem | null | undefined>(undefined); // undefined=关闭 null=新建
  const [claimTarget, setClaimTarget] = useState<LostFoundItem | null>(null);
  const [unclaimTarget, setUnclaimTarget] = useState<LostFoundItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LostFoundItem | null>(null);

  const [share, setShare] = useState<LostFoundShareInfo | null>(null);
  const [regenConfirm, setRegenConfirm] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (appliedQ) params.set('q', appliedQ);
      if (statusFilter) params.set('status', statusFilter);
      const qs = params.toString();
      const res = await api<{ items: LostFoundItem[] }>(`${base}${qs ? `?${qs}` : ''}`);
      setItems(res.items);
    } catch (err) {
      toast.error((err as Error).message);
      setItems([]);
    }
  }, [base, appliedQ, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canManage) return;
    api<{ share: LostFoundShareInfo }>(`${base}/share`)
      .then((r) => setShare(r.share))
      .catch(() => {});
  }, [base, canManage]);

  const search = (e: FormEvent) => {
    e.preventDefault();
    setAppliedQ(q.trim());
  };

  const toggleShare = async (enabled: boolean) => {
    try {
      const res = await api<{ share: LostFoundShareInfo }>(`${base}/share`, { method: 'PUT', body: { enabled } });
      setShare(res.share);
      toast.success(enabled ? '公开查找页已开启' : '公开查找页已关闭');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const regenerate = async () => {
    try {
      const res = await api<{ share: LostFoundShareInfo }>(`${base}/share`, { method: 'PUT', body: { regenerate: true } });
      setShare(res.share);
      toast.success('链接已重置，旧链接已失效');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const copyLink = async () => {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(`${location.origin}/lf/${share.token}`);
      toast.success('链接已复制');
    } catch {
      toast.error('复制失败，请手动复制');
    }
  };

  const unclaim = async () => {
    if (!unclaimTarget) return;
    try {
      await api(`${base}/${unclaimTarget.id}/status`, { method: 'PATCH', body: { status: 'pending' } });
      toast.success('已撤销认领');
      setUnclaimTarget(null);
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await api(`${base}/${deleteTarget.id}`, { method: 'DELETE' });
      toast.success('物品已删除');
      setDeleteTarget(null);
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <form className="flex flex-wrap items-center gap-2" onSubmit={search}>
        <Input
          className="w-full sm:w-64"
          placeholder="搜索名称 / 描述 / 地点"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button type="submit" variant="outline" size="sm">
          <Search className="size-4" /> 搜索
        </Button>
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.key}
              type="button"
              size="sm"
              variant={statusFilter === f.key ? 'default' : 'outline'}
              onClick={() => setStatusFilter(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        {canManage && (
          <Button type="button" size="sm" className="ml-auto" onClick={() => setEditTarget(null)}>
            <Plus className="size-4" /> 登记物品
          </Button>
        )}
      </form>

      {items === null ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <PackageSearch className="size-8" />
            {appliedQ || statusFilter ? '没有匹配的物品' : '暂无失物登记'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <Card key={it.id}>
              <CardContent className="flex items-start gap-3 p-3">
                {it.hasPhoto && (
                  <AuthImg src={`${base}/${it.id}/photo`} alt={it.name} style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{it.name}</span>
                    {it.status === 'pending' ? (
                      <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-400">待认领</Badge>
                    ) : (
                      <Badge className="bg-green-600 text-white hover:bg-green-600">已认领</Badge>
                    )}
                  </div>
                  {it.note && <p className="text-sm text-muted-foreground">{it.note}</p>}
                  <p className="text-xs text-muted-foreground">
                    {fmtLocal(it.foundAt, true)} 捡到{it.foundLocation ? ` · ${it.foundLocation}` : ''}
                  </p>
                  {it.status === 'claimed' && canManage && it.claimNote && (
                    <p className="text-xs text-muted-foreground">认领备注：{it.claimNote}</p>
                  )}
                </div>
                {canManage && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`物品操作 ${it.name}`}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditTarget(it)}>编辑</DropdownMenuItem>
                      {it.status === 'pending' ? (
                        <DropdownMenuItem onSelect={() => setClaimTarget(it)}>
                          <CheckCircle2 className="size-4" /> 标记认领
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => setUnclaimTarget(it)}>
                          <Undo2 className="size-4" /> 撤销认领
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem className="text-destructive" onSelect={() => setDeleteTarget(it)}>
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {canManage && share && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Link2 className="size-4 text-primary" />
                <p className="font-medium">对外公开查找页</p>
              </div>
              <Switch checked={share.enabled} onCheckedChange={toggleShare} aria-label="开关公开查找页" />
            </div>
            <p className="text-xs text-muted-foreground">
              开启后任何人无需登录即可按名称/地点搜索待认领物品（认领备注等内部信息不公开）
            </p>
            {share.enabled && (
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">
                  {`${location.origin}/lf/${share.token}`}
                </code>
                <Button type="button" variant="outline" size="sm" onClick={copyLink}>
                  <ClipboardCopy className="size-4" /> 复制链接
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setRegenConfirm(true)}>
                  <RotateCcw className="size-4" /> 重置链接
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <LostFoundItemDialog
        open={editTarget !== undefined}
        onOpenChange={(o) => !o && setEditTarget(undefined)}
        base={base}
        item={editTarget ?? null}
        onSaved={load}
      />
      <LostFoundClaimDialog
        open={claimTarget !== null}
        onOpenChange={(o) => !o && setClaimTarget(null)}
        base={base}
        item={claimTarget}
        onSaved={load}
      />

      <AlertDialog open={unclaimTarget !== null} onOpenChange={(o) => !o && setUnclaimTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>撤销认领？</AlertDialogTitle>
            <AlertDialogDescription>「{unclaimTarget?.name}」将回到待认领状态，认领备注会被清空。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={unclaim}>撤销认领</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除物品？</AlertDialogTitle>
            <AlertDialogDescription>「{deleteTarget?.name}」及其照片将被删除，不可恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={regenConfirm} onOpenChange={setRegenConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重置公开链接？</AlertDialogTitle>
            <AlertDialogDescription>重置后旧链接立即失效，已分发的二维码/海报需更新为新链接。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={regenerate}>重置链接</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
