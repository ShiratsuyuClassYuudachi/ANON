import { useState, type FormEvent } from 'react';
import { Check, ChevronDown, ChevronUp, Circle, Layers, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import type { ProjectDetail, StageItem } from '../../types';
import { FormOverlay } from '@/components/FormOverlay';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  project: ProjectDetail;
  myPermissions: string[];
  onChanged: () => Promise<void>;
}

export function StageManager({ project, myPermissions, onChanged }: Props) {
  const canManage = myPermissions.includes('project:manage');
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [noteTarget, setNoteTarget] = useState<StageItem | null>(null);
  const [noteText, setNoteText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<StageItem | null>(null);

  const stages = [...project.stages].sort((a, b) => a.order - b.order);
  const currentId = stages.find((s) => !s.completedAt)?.id;

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleComplete = (s: StageItem) =>
    run(async () => {
      await api(`/api/projects/${project.id}/stages/${s.id}`, {
        method: 'PATCH',
        body: { completedAt: s.completedAt ? null : new Date().toISOString() },
      });
      toast.success('已更新');
      await onChanged();
    });

  const move = (s: StageItem, dir: -1 | 1) =>
    run(async () => {
      const idx = stages.findIndex((x) => x.id === s.id);
      const swapWith = idx + dir;
      if (idx < 0 || swapWith < 0 || swapWith >= stages.length) return;
      const orderedIds = stages.map((x) => x.id);
      [orderedIds[idx], orderedIds[swapWith]] = [orderedIds[swapWith], orderedIds[idx]];
      await api(`/api/projects/${project.id}/stages/reorder`, { method: 'PATCH', body: { orderedIds } });
      await onChanged();
    });

  const addStage = () =>
    run(async () => {
      if (!newName.trim()) return;
      await api(`/api/projects/${project.id}/stages`, { body: { name: newName.trim() } });
      setNewName('');
      toast.success('阶段已添加');
      await onChanged();
    });

  const saveNote = (e: FormEvent) => {
    e.preventDefault();
    if (!noteTarget) return;
    void run(async () => {
      await api(`/api/projects/${project.id}/stages/${noteTarget.id}`, {
        method: 'PATCH',
        body: { note: noteText },
      });
      setNoteTarget(null);
      await onChanged();
    });
  };

  const removeStage = () =>
    run(async () => {
      if (!deleteTarget) return;
      await api(`/api/projects/${project.id}/stages/${deleteTarget.id}`, { method: 'DELETE' });
      toast.success('已删除');
      setDeleteTarget(null);
      await onChanged();
    });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="size-4 text-muted-foreground" />
          阶段管理
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          {stages.map((s, idx) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5">
              {s.completedAt ? (
                <Check className="size-4 shrink-0 text-green-600 dark:text-green-400" />
              ) : (
                <Circle className="size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1 basis-40">
                <div className="flex items-center gap-2">
                  <p className={`truncate text-sm ${s.completedAt ? 'text-muted-foreground line-through' : 'font-medium'}`}>
                    {s.name}
                  </p>
                  {s.id === currentId && <Badge variant="secondary" className="shrink-0 text-xs">当前</Badge>}
                </div>
                {s.note && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{s.note}</p>}
              </div>
              {canManage && (
                <div className="ml-auto flex shrink-0 items-center gap-0.5 max-md:w-full max-md:justify-end">
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void toggleComplete(s)}>
                    {s.completedAt ? '取消完成' : '标记完成'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="编辑备注"
                    disabled={busy}
                    onClick={() => {
                      setNoteTarget(s);
                      setNoteText(s.note);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="上移"
                    disabled={busy || idx === 0}
                    onClick={() => void move(s, -1)}
                  >
                    <ChevronUp className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="下移"
                    disabled={busy || idx === stages.length - 1}
                    onClick={() => void move(s, 1)}
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="删除阶段"
                    disabled={busy || stages.length <= 1}
                    onClick={() => setDeleteTarget(s)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="新阶段名称"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void addStage();
                }
              }}
            />
            <Button disabled={busy || !newName.trim()} onClick={() => void addStage()}>
              添加
            </Button>
          </div>
        )}
      </CardContent>

      <FormOverlay open={!!noteTarget} onOpenChange={(o) => !o && setNoteTarget(null)} title="阶段备注">
        <form onSubmit={saveNote} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="stage-note">备注（{noteTarget?.name}）</Label>
            <Textarea
              id="stage-note"
              rows={3}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="阶段补充说明（可选）"
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            保存
          </Button>
        </form>
      </FormOverlay>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除阶段「{deleteTarget?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>关联里程碑将改为不关联阶段。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void removeStage()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
