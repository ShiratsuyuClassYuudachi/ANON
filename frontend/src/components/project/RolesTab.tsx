import { useState } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import { PERMISSIONS } from '../../lib/permissions';
import type { ProjectDetail } from '../../types';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
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

interface Props {
  project: ProjectDetail;
  myPermissions: string[];
  onChanged: () => Promise<void>;
}

function PermissionChecks({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {PERMISSIONS.map((p) => (
        <label key={p.key} className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={value.includes(p.key)}
            onCheckedChange={(c) =>
              onChange(c ? [...value, p.key] : value.filter((x) => x !== p.key))
            }
          />
          {p.label}
        </label>
      ))}
    </div>
  );
}

export default function RolesTab({ project, myPermissions, onChanged }: Props) {
  const canManage = myPermissions.includes('project:manage') || myPermissions.includes('role:manage');
  const [newName, setNewName] = useState('');
  const [newPerms, setNewPerms] = useState<string[]>([]);
  const [editPerms, setEditPerms] = useState<Record<string, string[]>>({});
  const [deletingName, setDeletingName] = useState<string | null>(null);

  const run = (fn: () => Promise<void>) => fn().catch((e) => toast.error(e.message));
  const permsOf = (name: string, fallback: string[]) => editPerms[name] ?? fallback;

  return (
    <div className="space-y-3">
      {canManage && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">新建角色</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="角色名" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <PermissionChecks value={newPerms} onChange={setNewPerms} />
            <Button
              onClick={() =>
                run(async () => {
                  await api(`/api/projects/${project.id}/roles`, {
                    body: { name: newName, permissions: newPerms },
                  });
                  setNewName('');
                  setNewPerms([]);
                  await onChanged();
                })
              }
            >
              创建
            </Button>
          </CardContent>
        </Card>
      )}

      {project.roles.map((r) => (
        <Card key={r.name}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{r.name}</CardTitle>
            <CardAction className="flex items-center gap-1">
              {canManage && (
                <>
                  <Button
                    size="sm"
                    onClick={() =>
                      run(async () => {
                        await api(`/api/projects/${project.id}/roles/${encodeURIComponent(r.name)}`, {
                          method: 'PATCH',
                          body: { permissions: permsOf(r.name, r.permissions) },
                        });
                        toast.success('已保存');
                        await onChanged();
                      })
                    }
                  >
                    保存
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="删除角色"
                    onClick={() => setDeletingName(r.name)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </>
              )}
            </CardAction>
          </CardHeader>
          <CardContent>
            <PermissionChecks
              value={permsOf(r.name, r.permissions)}
              onChange={(v) => setEditPerms({ ...editPerms, [r.name]: v })}
            />
          </CardContent>
        </Card>
      ))}

      <AlertDialog open={!!deletingName} onOpenChange={(o) => !o && setDeletingName(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除角色「{deletingName}」？</AlertDialogTitle>
            <AlertDialogDescription>该操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deletingName)
                  run(async () => {
                    await api(`/api/projects/${project.id}/roles/${encodeURIComponent(deletingName)}`, {
                      method: 'DELETE',
                    });
                    await onChanged();
                  });
                setDeletingName(null);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
