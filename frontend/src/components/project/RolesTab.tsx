import { useState } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import { PERMISSIONS } from '../../lib/permissions';
import type { ProjectDetail } from '../../types';
import { Button } from '@/components/ui/button';
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
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {PERMISSIONS.map((p) => (
        <label key={p.key} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm md:min-h-8">
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
      <h1 className="editorial-heading">角色</h1>
      {canManage && (
        <section className="editorial-section">
          <h2 className="editorial-subheading">新建自定义角色</h2>
          <div className="space-y-3">
            <Input aria-label="角色名称" placeholder="输入角色名称（如：宣传组长、摊位审核）" value={newName} onChange={(e) => setNewName(e.target.value)} />
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
              创建角色
            </Button>
          </div>
        </section>
      )}

      {project.roles.map((r) => (
        <section key={r.name} className="editorial-section">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="editorial-subheading min-w-0 wrap-anywhere">{r.name}</h2>
            <div className="flex items-center gap-1">
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
                    保存权限
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
            </div>
          </header>
          <div>
            <PermissionChecks
              value={permsOf(r.name, r.permissions)}
              onChange={(v) => setEditPerms({ ...editPerms, [r.name]: v })}
            />
          </div>
        </section>
      ))}

      <AlertDialog open={!!deletingName} onOpenChange={(o) => !o && setDeletingName(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除角色「{deletingName}」？</AlertDialogTitle>
            <AlertDialogDescription>仍有成员使用该角色时将无法删除。</AlertDialogDescription>
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
