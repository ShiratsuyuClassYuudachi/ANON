import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Loader2, Pin, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import { fmtLocal } from '../../lib/datetime';
import type {
  AnnouncementConfirmations,
  AnnouncementItem,
  AnnouncementListResponse,
  Member,
  Visibility,
} from '../../types';
import { FormOverlay } from '@/components/FormOverlay';
import { VisibilityPicker } from './VisibilityPicker';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  projectId: string;
  members: Member[];
  roles: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void>;
}

const TYPE_BADGE: Record<AnnouncementItem['type'], { label: string; variant: 'secondary' | 'outline' | 'destructive' }> = {
  normal: { label: '普通', variant: 'secondary' },
  important: { label: '重要', variant: 'outline' },
  emergency: { label: '紧急', variant: 'destructive' },
};

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AnnouncementManager({ projectId, members, roles, open, onOpenChange, onChanged }: Props) {
  const [items, setItems] = useState<AnnouncementItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AnnouncementItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AnnouncementItem | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<AnnouncementItem | null>(null);
  const [confirmations, setConfirmations] = useState<AnnouncementConfirmations | null>(null);

  // Form fields
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState<AnnouncementItem['type']>('normal');
  const [isPinned, setIsPinned] = useState(false);
  const [requireConfirmation, setRequireConfirmation] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>({ userIds: [], roleNames: [] });
  const [visibilityDirty, setVisibilityDirty] = useState(false);
  const [expiresInput, setExpiresInput] = useState('');

  const loadList = useCallback(
    async (p: number, append: boolean) => {
      const d = await api<AnnouncementListResponse>(
        `/api/projects/${projectId}/announcements?includeExpired=true&limit=50&page=${p}`,
      );
      setItems((prev) => (append && prev ? [...prev, ...d.announcements] : d.announcements));
      setTotal(d.total);
      setPage(d.page);
    },
    [projectId],
  );

  useEffect(() => {
    if (open) loadList(1, false).catch((e) => toast.error((e as Error).message));
  }, [open, loadList]);

  useEffect(() => {
    if (!confirmTarget) return;
    setConfirmations(null);
    api<AnnouncementConfirmations>(`/api/projects/${projectId}/announcements/${confirmTarget.id}/confirmations`)
      .then(setConfirmations)
      .catch((e) => toast.error((e as Error).message));
  }, [confirmTarget, projectId]);

  const openForm = (a: AnnouncementItem | null) => {
    setEditing(a);
    setTitle(a?.title ?? '');
    setContent(a?.content ?? '');
    setType(a?.type ?? 'normal');
    setIsPinned(a?.isPinned ?? false);
    setRequireConfirmation(a?.requireConfirmation ?? false);
    setVisibility({ userIds: [], roleNames: [] });
    setVisibilityDirty(false);
    setExpiresInput(toLocalInput(a?.expiresAt ?? null));
    setFormOpen(true);
  };

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      await loadList(page + 1, true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        content,
        type,
        isPinned,
        requireConfirmation,
        expiresAt: expiresInput ? new Date(expiresInput).toISOString() : null,
      };
      // 列表响应不含 visibility：编辑时仅当用户改动过才提交，避免静默清除原可见范围
      if (!editing || visibilityDirty) body.visibility = visibility;
      if (editing) {
        await api(`/api/projects/${projectId}/announcements/${editing.id}`, { method: 'PATCH', body });
      } else {
        await api(`/api/projects/${projectId}/announcements`, { body });
      }
      toast.success(editing ? '已保存' : '已发布');
      setFormOpen(false);
      await loadList(1, false);
      await onChanged();
    } catch (e2) {
      toast.error((e2 as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await api(`/api/projects/${projectId}/announcements/${deleteTarget.id}`, { method: 'DELETE' });
      toast.success('已删除');
      setDeleteTarget(null);
      await loadList(1, false);
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2 pr-6">
              <DialogTitle>公告管理</DialogTitle>
              <Button size="sm" onClick={() => openForm(null)}>
                <Plus className="size-4" /> 发布公告
              </Button>
            </div>
          </DialogHeader>
          {items === null ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">暂无公告</p>
          ) : (
            <div className="space-y-2">
              {items.map((a) => {
                const badge = TYPE_BADGE[a.type] ?? TYPE_BADGE.normal;
                const expired = a.expiresAt !== null && new Date(a.expiresAt).getTime() <= Date.now();
                return (
                  <div key={a.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {a.isPinned && <Pin className="size-3.5 shrink-0 text-muted-foreground" />}
                      <Badge variant={badge.variant} className="shrink-0">{badge.label}</Badge>
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">{a.title}</p>
                      <div className="flex shrink-0 gap-1">
                        {a.requireConfirmation && (
                          <Button variant="outline" size="sm" onClick={() => setConfirmTarget(a)}>
                            确认名单
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => openForm(a)}>
                          编辑
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(a)}>
                          删除
                        </Button>
                      </div>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      {a.publishedBy.name} · {fmtLocal(a.publishedAt)}
                      {a.expiresAt &&
                        (expired ? (
                          <Badge variant="destructive" className="ml-1">已过期</Badge>
                        ) : (
                          <span> · 将于 {fmtLocal(a.expiresAt)} 过期</span>
                        ))}
                    </p>
                  </div>
                );
              })}
              {items.length < total && (
                <Button variant="outline" className="w-full" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? <Loader2 className="size-4 animate-spin" /> : '加载更多'}
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <FormOverlay open={formOpen} onOpenChange={setFormOpen} title={editing ? '编辑公告' : '发布公告'}>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ann-title">标题</Label>
            <Input
              id="ann-title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="公告标题"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ann-content">内容</Label>
            <Textarea
              id="ann-content"
              rows={4}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="公告正文（可选）"
            />
          </div>
          <div className="space-y-2">
            <Label>类型</Label>
            <RadioGroup
              value={type}
              onValueChange={(v) => setType(v as AnnouncementItem['type'])}
              className="flex gap-4"
            >
              {(['normal', 'important', 'emergency'] as const).map((v) => (
                <div key={v} className="flex items-center gap-2">
                  <RadioGroupItem value={v} id={`ann-type-${v}`} />
                  <Label htmlFor={`ann-type-${v}`} className="cursor-pointer font-normal">
                    {TYPE_BADGE[v].label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="ann-pinned" checked={isPinned} onCheckedChange={setIsPinned} />
            <Label htmlFor="ann-pinned">置顶</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="ann-confirm" checked={requireConfirmation} onCheckedChange={setRequireConfirmation} />
            <Label htmlFor="ann-confirm">需要成员确认（我已知悉）</Label>
          </div>
          <div className="space-y-2">
            <Label>可见范围</Label>
            <VisibilityPicker
              members={members}
              roles={roles}
              value={visibility}
              onChange={(v) => {
                setVisibility(v);
                setVisibilityDirty(true);
              }}
            />
            {editing && !visibilityDirty && (
              <p className="text-xs text-muted-foreground">未改动将保留原可见范围</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="ann-expires">过期时间</Label>
            <Input
              id="ann-expires"
              type="datetime-local"
              value={expiresInput}
              onChange={(e) => setExpiresInput(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">留空 = 长期有效</p>
          </div>
          <Button type="submit" className="w-full" disabled={submitting || !title.trim()}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {editing ? '保存' : '发布'}
          </Button>
        </form>
      </FormOverlay>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除公告「{deleteTarget?.title}」？</AlertDialogTitle>
            <AlertDialogDescription>该操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!confirmTarget} onOpenChange={(o) => !o && setConfirmTarget(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>确认名单 - {confirmTarget?.title}</DialogTitle>
          </DialogHeader>
          {confirmations === null ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">已确认（{confirmations.confirmed.length}）</p>
                <div className="flex flex-wrap gap-1.5">
                  {confirmations.confirmed.length === 0 ? (
                    <p className="text-xs text-muted-foreground">暂无</p>
                  ) : (
                    confirmations.confirmed.map((m) => (
                      <Badge key={m.userId} variant="secondary">{m.name}</Badge>
                    ))
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">未确认（{confirmations.unconfirmed.length}）</p>
                <div className="flex flex-wrap gap-1.5">
                  {confirmations.unconfirmed.length === 0 ? (
                    <p className="text-xs text-muted-foreground">暂无</p>
                  ) : (
                    confirmations.unconfirmed.map((m) => (
                      <Badge key={m.userId} variant="secondary">{m.name}</Badge>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
